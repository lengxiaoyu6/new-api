package controller

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Recharge schema from v1.0.0-rc.47, published on 2026-10-25.
type perPayReleasedTopUp struct {
	Id              int
	UserId          int `gorm:"index"`
	Amount          int64
	Money           float64
	TradeNo         string `gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string `gorm:"type:varchar(50)"`
	PaymentProvider string `gorm:"type:varchar(50);default:''"`
	CreateTime      int64
	CompleteTime    int64
	Status          string
}

func (perPayReleasedTopUp) TableName() string { return "top_ups" }

func perPayTestSettings(t *testing.T, endpoint string) {
	t.Helper()
	previous := service.GetPerPayConfig()
	previousPrice, previousMin := operation_setting.Price, operation_setting.MinTopUp
	previousDisplay := operation_setting.GetGeneralSetting().QuotaDisplayType
	previousQuota := common.QuotaPerUnit
	previousRatios := common.TopupGroupRatio2JSONString()
	previousDiscounts := operation_setting.GetPaymentSetting().AmountDiscount
	previousCompliance := *operation_setting.GetPaymentSetting()
	previousCallback := operation_setting.CustomCallbackAddress
	previousRebate := common.InviterTopupRebatePercent
	t.Cleanup(func() {
		setting.PerPayEnabled, setting.PerPayURL, setting.PerPayClientID = previous.Enabled, previous.URL, previous.ClientID
		setting.PerPayAPISecret, setting.PerPayWebhookSecret = previous.APISecret, previous.WebhookSecret
		operation_setting.Price, operation_setting.MinTopUp = previousPrice, previousMin
		operation_setting.GetGeneralSetting().QuotaDisplayType = previousDisplay
		operation_setting.GetPaymentSetting().AmountDiscount = previousDiscounts
		*operation_setting.GetPaymentSetting() = previousCompliance
		operation_setting.CustomCallbackAddress = previousCallback
		common.QuotaPerUnit, common.InviterTopupRebatePercent = previousQuota, previousRebate
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(previousRatios))
	})
	setting.PerPayEnabled, setting.PerPayURL, setting.PerPayClientID = true, endpoint, "fixture-client"
	setting.PerPayAPISecret = base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x11}, 32))
	setting.PerPayWebhookSecret = base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x22}, 32))
	operation_setting.Price, operation_setting.MinTopUp = 1, 1
	common.QuotaPerUnit, common.InviterTopupRebatePercent = 500000, 0
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	operation_setting.GetPaymentSetting().AmountDiscount = map[string]float64{}
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	operation_setting.CustomCallbackAddress = "https://gateway.example"
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1}`))
}

func perPaySignedWebhook(t *testing.T, eventID, tradeNo string, version int64) *http.Request {
	t.Helper()
	body, err := common.Marshal(map[string]any{
		"schema": "perpay:outbox-event:v2", "event_id": eventID,
		"event_type": "PAYMENT_CONFIRMED", "order_id": "provider-order",
		"merchant_order_no": tradeNo, "order_version": version,
		"payment_status": "CONFIRMED",
	})
	require.NoError(t, err)
	request := httptest.NewRequest(http.MethodPost, "/api/perpay/webhook", bytes.NewReader(body))
	request.Header.Set("X-PerPay-Webhook-Version", "1")
	request.Header.Set("X-PerPay-Webhook-Key-Id", "key-1")
	request.Header.Set("X-PerPay-Webhook-Timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10))
	request.Header.Set("X-PerPay-Webhook-Delivery-Id", "delivery-1")
	request.Header.Set("X-PerPay-Webhook-Event-Id", eventID)
	request.Header.Set("X-PerPay-Webhook-Attempt", "1")
	digest := sha256.Sum256(body)
	signingText := strings.Join([]string{
		"perpay:webhook:v1", "key-1", request.Header.Get("X-PerPay-Webhook-Timestamp"),
		"delivery-1", eventID, "1", hex.EncodeToString(digest[:]),
	}, "\n")
	key, err := base64.RawURLEncoding.DecodeString(setting.PerPayWebhookSecret)
	require.NoError(t, err)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(signingText))
	request.Header.Set("X-PerPay-Webhook-Signature", "v1="+hex.EncodeToString(mac.Sum(nil)))
	return request
}

func TestPerPayWebhookVerification(t *testing.T) {
	perPayTestSettings(t, "https://pay.example")
	config := service.GetPerPayConfig()
	for _, test := range []struct {
		name   string
		mutate func(*http.Request, *[]byte)
	}{
		{"valid", func(_ *http.Request, _ *[]byte) {}},
		{"tampered body", func(_ *http.Request, body *[]byte) { *body = append(*body, ' ') }},
		{"seconds instead of milliseconds", func(r *http.Request, _ *[]byte) {
			r.Header.Set("X-PerPay-Webhook-Timestamp", strconv.FormatInt(time.Now().Unix(), 10))
		}},
		{"expired delivery", func(r *http.Request, _ *[]byte) {
			r.Header.Set("X-PerPay-Webhook-Timestamp", strconv.FormatInt(time.Now().Add(-10*time.Minute).UnixMilli(), 10))
		}},
		{"header event mismatch", func(r *http.Request, _ *[]byte) { r.Header.Set("X-PerPay-Webhook-Event-Id", "different-event") }},
		{"missing delivery", func(r *http.Request, _ *[]byte) { r.Header.Del("X-PerPay-Webhook-Delivery-Id") }},
		{"unknown version", func(r *http.Request, _ *[]byte) { r.Header.Set("X-PerPay-Webhook-Version", "2") }},
		{"duplicate timestamp", func(r *http.Request, _ *[]byte) {
			r.Header.Add("X-PerPay-Webhook-Timestamp", r.Header.Get("X-PerPay-Webhook-Timestamp"))
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := perPaySignedWebhook(t, "event-1", "order-1", 2)
			body, err := io.ReadAll(request.Body)
			require.NoError(t, err)
			test.mutate(request, &body)
			event, err := config.VerifyWebhook(request.Header, body, time.Now())
			if test.name == "valid" {
				require.NoError(t, err)
				assert.Equal(t, "event-1", event.EventID)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestPerPayConfiguredPaymentMethod(t *testing.T) {
	perPayTestSettings(t, "https://pay.example")
	previousMethods := operation_setting.PayMethods
	t.Cleanup(func() { operation_setting.PayMethods = previousMethods })
	for _, identifier := range []string{"perpay", "PerPay", " PerPay "} {
		t.Run(identifier, func(t *testing.T) {
			method := map[string]string{
				"name": "Configured Alipay", "type": identifier,
				"icon": "SiAlipay", "color": "#0070C0", "min_topup": "20",
			}
			operation_setting.PayMethods = []map[string]string{method}
			var response struct {
				Success bool
				Data    struct {
					PayMethods []map[string]string `json:"pay_methods"`
				}
			}
			modelManagementRequest(t, GetTopUpInfo, http.MethodGet, "/api/user/topup/info", nil, &response)
			require.True(t, response.Success)
			assert.Equal(t, []map[string]string{{
				"name": "Configured Alipay", "type": "perpay",
				"icon": "SiAlipay", "color": "#0070C0", "min_topup": "20",
			}}, response.Data.PayMethods)
			assert.Equal(t, identifier, method["type"], "response normalization must preserve stored configuration")

			setting.PerPayEnabled = false
			modelManagementRequest(t, GetTopUpInfo, http.MethodGet, "/api/user/topup/info", nil, &response)
			assert.Empty(t, response.Data.PayMethods)
			setting.PerPayEnabled = true
		})
	}
}

func TestPerPayRechargeDatabaseMatrix(t *testing.T) {
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env + " to run this database")
			}
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%t", upgrade), func(t *testing.T) {
					db := modelManagementDB(t, dialect.kind, os.Getenv(dialect.env))
					require.NoError(t, db.AutoMigrate(&model.Log{}))
					if upgrade {
						require.NoError(t, db.AutoMigrate(&perPayReleasedTopUp{}))
						require.NoError(t, db.Create(&perPayReleasedTopUp{
							TradeNo: "existing-order", Amount: 9, Money: 7.25,
							PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess,
						}).Error)
					}
					for range 2 {
						common.IsMasterNode = true
						require.NoError(t, model.InitDB())
						migratedDB, err := model.DB.DB()
						require.NoError(t, err)
						model.DB = db
						common.IsMasterNode = false
						require.NoError(t, migratedDB.Close())
					}
					if upgrade {
						existing := model.GetTopUpByTradeNo("existing-order")
						require.NotNil(t, existing)
						assert.Equal(t, 9.0, existing.Amount)
						assert.Equal(t, 7.25, existing.Money)
						assert.Equal(t, model.PaymentProviderEpay, existing.PaymentProvider)
						assert.Error(t, db.Create(&model.TopUp{TradeNo: "existing-order"}).Error)
					}
					var createBody []byte
					var createRequest service.PerPayCreateRequest
					version, status, refund := int64(1), "UNPAID", "NONE"
					requested, payable, received := int64(999), int64(1001), int64(0)
					failCreate := true
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						body, err := io.ReadAll(r.Body)
						require.NoError(t, err)
						assert.Equal(t, "fixture-client", r.Header.Get("X-PerPay-Client-Id"))
						assert.Equal(t, "v1", r.Header.Get("X-PerPay-Signature-Version"))
						nonce, err := base64.RawURLEncoding.DecodeString(r.Header.Get("X-PerPay-Nonce"))
						require.NoError(t, err)
						assert.Len(t, nonce, 32)
						timestamp, err := strconv.ParseInt(r.Header.Get("X-PerPay-Timestamp"), 10, 64)
						require.NoError(t, err)
						assert.InDelta(t, time.Now().Unix(), timestamp, 30)
						digest := sha256.Sum256(body)
						text := strings.Join([]string{
							"PERPAY-HMAC-SHA256", "v1", r.Method, r.URL.RequestURI(),
							r.Header.Get("X-PerPay-Timestamp"), r.Header.Get("X-PerPay-Nonce"),
							"fixture-client", hex.EncodeToString(digest[:]),
						}, "\n")
						key, _ := base64.RawURLEncoding.DecodeString(setting.PerPayAPISecret)
						mac := hmac.New(sha256.New, key)
						mac.Write([]byte(text))
						assert.Equal(t, hex.EncodeToString(mac.Sum(nil)), r.Header.Get("X-PerPay-Signature"))
						if r.Method == http.MethodPost {
							assert.Equal(t, "/api/v1/orders", r.URL.Path)
							if createBody == nil {
								createBody = body
							} else {
								assert.Equal(t, createBody, body, "ambiguous create retry must preserve the full request")
							}
							require.NoError(t, common.Unmarshal(body, &createRequest))
							assert.Equal(t, createRequest.MerchantOrderNo, createRequest.IdempotencyKey)
							assert.EqualValues(t, 999, createRequest.AmountCents)
							assert.Equal(t, "https://gateway.example/api/perpay/webhook", createRequest.NotifyURL)
							if failCreate {
								w.WriteHeader(http.StatusServiceUnavailable)
								return
							}
						} else {
							assert.Equal(t, "/api/v1/orders/provider-order", r.URL.Path)
						}
						var receivedValue any
						if status != "UNPAID" {
							receivedValue = received
						}
						payload, err := common.Marshal(map[string]any{"data": map[string]any{
							"order_id": "provider-order", "merchant_order_no": createRequest.MerchantOrderNo,
							"requested_amount_cents": requested, "payable_amount_cents": payable,
							"received_amount_cents": receivedValue, "currency": "CNY", "version": version,
							"payment":  map[string]any{"status": status, "received_amount_cents": receivedValue},
							"refund":   map[string]any{"status": refund},
							"checkout": map[string]any{"status": "OPEN", "checkout_url": "https://pay.example/checkout/token"},
						}})
						require.NoError(t, err)
						w.Header().Set("Content-Type", "application/json")
						_, err = w.Write(payload)
						require.NoError(t, err)
					}))
					defer server.Close()
					perPayTestSettings(t, server.URL)
					previousMethods := operation_setting.PayMethods
					t.Cleanup(func() { operation_setting.PayMethods = previousMethods })
					operation_setting.PayMethods = []map[string]string{{
						"name": "Alipay", "type": "PerPay", "min_topup": "9.99",
					}}
					config := service.GetPerPayConfig()
					for _, option := range []struct{ key, value string }{
						{"PerPayURL", config.URL}, {"PerPayClientID", config.ClientID},
						{"PerPayAPISecret", config.APISecret}, {"PerPayWebhookSecret", config.WebhookSecret},
					} {
						var saved struct{ Success bool }
						modelManagementRequest(t, UpdateOption, http.MethodPut, "/api/option/",
							map[string]string{"key": option.key, "value": option.value}, &saved)
						require.True(t, saved.Success)
					}
					setting.PerPayEnabled = false
					var enabled struct{ Success bool }
					modelManagementRequest(t, UpdateOption, http.MethodPut, "/api/option/",
						map[string]any{"key": "PerPayEnabled", "value": true}, &enabled)
					require.True(t, enabled.Success)
					require.True(t, isPerPayTopUpEnabled())
					options := modelManagementRequest(t, GetOptions, http.MethodGet, "/api/option/", nil, nil)
					assert.NotContains(t, options.Body.String(), config.APISecret)
					assert.NotContains(t, options.Body.String(), config.WebhookSecret)
					user := model.User{Username: "perpay_fixture", Group: "default", Status: common.UserStatusEnabled}
					require.NoError(t, db.Create(&user).Error)
					var belowMinimum struct {
						Message       string         `json:"message"`
						MessageKey    string         `json:"message_key"`
						MessageParams map[string]any `json:"message_params"`
					}
					modelManagementRequest(t, func(c *gin.Context) {
						c.Set("id", user.Id)
						RequestPerPay(c)
					}, http.MethodPost, "/api/user/perpay/pay", map[string]any{"amount": 9.98}, &belowMinimum)
					require.Equal(t, "Top-up amount cannot be less than {{min}}", belowMinimum.MessageKey)
					assert.Equal(t, 9.99, belowMinimum.MessageParams["min"])
					var prematureOrders int64
					require.NoError(t, db.Model(&model.TopUp{}).Where("user_id = ?", user.Id).Count(&prematureOrders).Error)
					assert.Zero(t, prematureOrders, "below-minimum requests must not create payment orders")
					var checkout struct{ Message string }
					modelManagementRequest(t, func(c *gin.Context) {
						c.Set("id", user.Id)
						RequestPerPay(c)
					}, http.MethodPost, "/api/user/perpay/pay", map[string]any{"amount": 9.99}, &checkout)
					assert.Equal(t, "error", checkout.Message)
					topUp := model.GetTopUpByTradeNo(createRequest.MerchantOrderNo)
					require.NotNil(t, topUp)
					assert.Equal(t, common.TopUpStatusPending, topUp.Status, "a failed response cannot abandon a possibly accepted order")
					failCreate = false
					_, err := service.SyncPerPayOrder(context.Background(), topUp.TradeNo, nil, "", "")
					require.NoError(t, err)
					order, err := model.GetPerPayOrder(topUp.TradeNo)
					require.NoError(t, err)
					assert.EqualValues(t, 999, order.RequestedAmountCents)
					assert.EqualValues(t, 1001, order.PayableAmountCents)
					assert.Equal(t, "provider-order", order.OrderID)
					require.NoError(t, db.First(&user, user.Id).Error)
					assert.Zero(t, user.Quota)

					version, status, received = 2, "CONFIRMED", 1000
					callWebhook := func(eventID string, eventVersion int64) *httptest.ResponseRecorder {
						recorder := httptest.NewRecorder()
						c, _ := gin.CreateTestContext(recorder)
						c.Request = perPaySignedWebhook(t, eventID, topUp.TradeNo, eventVersion)
						PerPayWebhook(c)
						c.Writer.WriteHeaderNow()
						return recorder
					}
					assert.Equal(t, http.StatusServiceUnavailable, callWebhook("event-paid", 2).Code)
					var eventCount int64
					require.NoError(t, db.Model(&model.PerPayEvent{}).Count(&eventCount).Error)
					assert.Zero(t, eventCount, "a rejected amount must not consume the event ID")
					received = 1001
					requested = 998
					assert.Equal(t, http.StatusServiceUnavailable, callWebhook("event-paid", 2).Code)
					requested = 999
					require.NoError(t, db.Model(&user).Update("quota", common.MaxWalletQuota).Error)
					assert.Equal(t, http.StatusServiceUnavailable, callWebhook("event-paid", 2).Code)
					require.NoError(t, db.Model(&user).Update("quota", 0).Error)
					assert.Equal(t, common.TopUpStatusPending, model.GetTopUpByTradeNo(topUp.TradeNo).Status)
					setting.PerPayEnabled = false
					ack := callWebhook("event-paid", 2)
					require.Equal(t, http.StatusOK, ack.Code)
					var acknowledgement map[string]any
					require.NoError(t, common.Unmarshal(ack.Body.Bytes(), &acknowledgement))
					assert.Equal(t, map[string]any{
						"schema": "perpay:webhook-ack:v1", "ack": true, "event_id": "event-paid", "delivery_id": "delivery-1",
					}, acknowledgement)
					assert.Equal(t, http.StatusOK, callWebhook("event-paid", 2).Code)
					require.NoError(t, db.First(&user, user.Id).Error)
					assert.Equal(t, 4_995_000, user.Quota, "the two-cent surcharge must not add wallet credit")
					assert.Equal(t, 10.01, model.GetTopUpByTradeNo(topUp.TradeNo).Money)
					require.NoError(t, db.Model(&model.PerPayEvent{}).Count(&eventCount).Error)
					assert.EqualValues(t, 1, eventCount)

					version, status = 3, "DISPUTED"
					assert.Equal(t, http.StatusOK, callWebhook("event-disputed", 3).Code)
					assert.Equal(t, model.TopUpStatusDisputed, model.GetTopUpByTradeNo(topUp.TradeNo).Status)
					version, status = 2, "CONFIRMED"
					assert.Equal(t, http.StatusOK, callWebhook("event-late-paid", 2).Code)
					assert.Equal(t, model.TopUpStatusDisputed, model.GetTopUpByTradeNo(topUp.TradeNo).Status)
					version, status, refund = 4, "CONFIRMED", "FULL"
					assert.Equal(t, http.StatusOK, callWebhook("event-refund", 4).Code)
					assert.Equal(t, model.TopUpStatusDisputed, model.GetTopUpByTradeNo(topUp.TradeNo).Status)
					version, refund = 5, "NONE"
					assert.Equal(t, http.StatusOK, callWebhook("event-reconfirmed", 5).Code)
					require.NoError(t, db.First(&user, user.Id).Error)
					assert.Equal(t, 4_995_000, user.Quota)
					assert.Equal(t, common.TopUpStatusSuccess, model.GetTopUpByTradeNo(topUp.TradeNo).Status)
					assert.Error(t, db.Create(&model.PerPayEvent{EventID: "event-paid"}).Error)
					assert.ErrorIs(t, model.ApplyPerPaySnapshot("wrong-client", server.URL, model.PerPaySnapshot{
						OrderID: "provider-order", MerchantOrderNo: topUp.TradeNo,
					}, nil, ""), model.ErrPerPayOrderMismatch)
					unowned := httptest.NewRecorder()
					c, _ := gin.CreateTestContext(unowned)
					c.Request = httptest.NewRequest(http.MethodPost, "/check", nil)
					c.Params = gin.Params{{Key: "trade_no", Value: topUp.TradeNo}}
					c.Set("id", user.Id+1)
					CheckPerPayOrder(c)
					c.Writer.WriteHeaderNow()
					assert.Equal(t, http.StatusNotFound, unowned.Code)
				})
			}
		})
	}
}
