package controller

import (
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
	"gorm.io/gorm"
)

// The top-up schema in v1.0.0-rc.45, before fractional amounts were supported.
type legacyRechargeTopUp struct {
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

func TestRechargePresetsKeepFractionalAmounts(t *testing.T) {
	paymentSetting := operation_setting.GetPaymentSetting()
	originalAmounts := slices.Clone(paymentSetting.AmountOptions)
	t.Cleanup(func() { paymentSetting.AmountOptions = originalAmounts })

	require.NoError(t, config.UpdateConfigFromMap(paymentSetting, map[string]string{
		"amount_options": `[9.99,19.99,29.99,49.99,99.99]`,
	}))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	GetTopUpInfo(ctx)
	var response struct {
		Data struct {
			AmountOptions []float64 `json:"amount_options"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, []float64{9.99, 19.99, 29.99, 49.99, 99.99}, response.Data.AmountOptions)
}

func TestFractionalTopUpDiscountsUseExactAmounts(t *testing.T) {
	previousDiscounts := operation_setting.GetPaymentSetting().AmountDiscount
	previousDisplay := operation_setting.GetGeneralSetting().QuotaDisplayType
	previousEpay, previousStripe := operation_setting.Price, setting.StripeUnitPrice
	previousWaffo, previousPancake := setting.WaffoUnitPrice, setting.WaffoPancakeUnitPrice
	previousRatios := common.TopupGroupRatio2JSONString()
	t.Cleanup(func() {
		operation_setting.GetPaymentSetting().AmountDiscount = previousDiscounts
		operation_setting.GetGeneralSetting().QuotaDisplayType = previousDisplay
		operation_setting.Price, setting.StripeUnitPrice = previousEpay, previousStripe
		setting.WaffoUnitPrice, setting.WaffoPancakeUnitPrice = previousWaffo, previousPancake
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(previousRatios))
	})
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	operation_setting.Price, setting.StripeUnitPrice = 1, 1
	setting.WaffoUnitPrice, setting.WaffoPancakeUnitPrice = 1, 1
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1}`))
	require.NoError(t, config.UpdateConfigFromMap(operation_setting.GetPaymentSetting(), map[string]string{
		"amount_discount": `{"9":0.5,"9.99":0.8,"10":0.9}`,
	}))
	for name, calculate := range map[string]func(float64, string) float64{
		"epay": getPayMoney, "stripe": getStripePayMoney,
		"waffo": getWaffoPayMoney, "pancake": getWaffoPancakePayMoney,
	} {
		t.Run(name, func(t *testing.T) {
			assert.InDelta(t, 7.992, calculate(9.99, "default"), 0.000001)
			assert.InDelta(t, 9.5, calculate(9.5, "default"), 0.000001)
			assert.InDelta(t, 9, calculate(10, "default"), 0.000001)
		})
	}
}

func TestTopUpQuotaValidation(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	testCases := []struct {
		name        string
		displayType string
		amount      float64
		wantQuota   int
		wantErr     bool
	}{
		{
			name:        "fractional currency amount",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      9.99,
			wantQuota:   4_995_000,
		},
		{
			name:        "currency amount below cent precision is rejected",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      9.999,
			wantErr:     true,
		},
		{
			name:        "fractional tokens are rejected",
			displayType: operation_setting.QuotaDisplayTypeTokens,
			amount:      500000.99,
			wantErr:     true,
		},
		{
			name:        "oversized token amount cannot wrap",
			displayType: operation_setting.QuotaDisplayTypeTokens,
			amount:      1e100,
			wantErr:     true,
		},
		{
			name:        "non-finite amount",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      math.NaN(),
			wantErr:     true,
		},
		{
			name:        "currency amount below limit",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      4294,
			wantQuota:   2_147_000_000,
		},
		{
			name:        "currency amount above limit",
			displayType: operation_setting.QuotaDisplayTypeUSD,
			amount:      4295,
			wantQuota:   2_147_500_000,
		},
		{
			name:        "token amount preserves settlement truncation",
			displayType: operation_setting.QuotaDisplayTypeTokens,
			amount:      2_147_500_000,
			wantQuota:   2_147_500_000,
		},
		{
			name:        "token amount above legacy int32 range",
			displayType: operation_setting.QuotaDisplayTypeTokens,
			amount:      4_294_500_000,
			wantQuota:   4_294_500_000,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			operation_setting.GetGeneralSetting().QuotaDisplayType = tc.displayType
			quota, err := getTopUpQuota(tc.amount)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantQuota, quota)
		})
	}
}

func TestFractionalRechargeDatabase(t *testing.T) {
	previousPayment := *operation_setting.GetPaymentSetting()
	previousPayment.AmountOptions = slices.Clone(previousPayment.AmountOptions)
	previousGeneral := *operation_setting.GetGeneralSetting()
	previousQuota, previousRebate := common.QuotaPerUnit, common.InviterTopupRebatePercent
	previousPrice, previousMinimum := operation_setting.Price, operation_setting.MinTopUp
	previousAddress, previousID, previousKey := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey
	previousMethods := operation_setting.PayMethods
	previousRatios := common.TopupGroupRatio2JSONString()
	t.Cleanup(func() {
		*operation_setting.GetPaymentSetting() = previousPayment
		*operation_setting.GetGeneralSetting() = previousGeneral
		common.QuotaPerUnit, common.InviterTopupRebatePercent = previousQuota, previousRebate
		operation_setting.Price, operation_setting.MinTopUp = previousPrice, previousMinimum
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = previousAddress, previousID, previousKey
		operation_setting.PayMethods = previousMethods
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(previousRatios))
	})
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	common.QuotaPerUnit, common.InviterTopupRebatePercent = 500000, 0
	operation_setting.Price, operation_setting.MinTopUp = 1, 1
	operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = "https://payment.example", "merchant", "fixture-key"
	operation_setting.PayMethods = []map[string]string{{"name": "Alipay", "type": "alipay"}}
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1}`))

	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env + " to run this database")
			}
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%t", upgrade), func(t *testing.T) {
					db := modelManagementDB(t, dialect.kind, os.Getenv(dialect.env))
					require.NoError(t, db.AutoMigrate(&model.Log{}))
					user := model.User{Username: "fractional_recharge", Group: "default", Status: common.UserStatusEnabled}
					require.NoError(t, db.Create(&user).Error)
					if upgrade {
						require.NoError(t, db.Table("top_ups").AutoMigrate(&legacyRechargeTopUp{}))
						require.NoError(t, db.Table("top_ups").Create(&legacyRechargeTopUp{
							UserId: user.Id, Amount: 2, Money: 2, TradeNo: "legacy-order",
							PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay,
							Status: common.TopUpStatusPending,
						}).Error)
						require.NoError(t, db.Table("top_ups").Create(&legacyRechargeTopUp{
							UserId: user.Id, Amount: common.MaxWalletQuota, Money: 1, TradeNo: "legacy-large-quota",
							PaymentMethod: model.PaymentMethodCreem, PaymentProvider: model.PaymentProviderCreem,
							Status: common.TopUpStatusSuccess,
						}).Error)
					}
					for range 2 {
						require.NoError(t, db.AutoMigrate(&model.TopUp{}))
					}
					if upgrade {
						legacy := model.GetTopUpByTradeNo("legacy-order")
						require.NotNil(t, legacy)
						assert.Equal(t, 2.0, legacy.Amount)
						assert.Equal(t, 2.0, legacy.Money)
						assert.Equal(t, model.PaymentProviderEpay, legacy.PaymentProvider)
						largeOrder := model.GetTopUpByTradeNo("legacy-large-quota")
						require.NotNil(t, largeOrder)
						assert.Equal(t, float64(common.MaxWalletQuota), largeOrder.Amount)
						assert.True(t, db.Migrator().HasIndex(&model.TopUp{}, "idx_top_ups_user_id"))
						assert.True(t, db.Migrator().HasIndex(&model.TopUp{}, "idx_top_ups_trade_no"))
						assert.Error(t, db.Create(&model.TopUp{TradeNo: "legacy-order"}).Error)
						alreadyDone, err := model.RechargeEpay("legacy-order", "alipay", "127.0.0.1")
						require.NoError(t, err)
						assert.False(t, alreadyDone)
						require.NoError(t, db.First(&user, user.Id).Error)
						assert.Equal(t, 1_000_000, user.Quota)
					}

					var saved struct{ Success bool }
					modelManagementRequest(t, UpdateOption, http.MethodPut, "/api/option/", map[string]string{
						"key": "payment_setting.amount_options", "value": "[9.99,19.99,29.99,49.99,99.99]",
					}, &saved)
					require.True(t, saved.Success)
					var option model.Option
					require.NoError(t, db.Where(map[string]any{"key": "payment_setting.amount_options"}).First(&option).Error)
					assert.Equal(t, "[9.99,19.99,29.99,49.99,99.99]", option.Value)

					var quote struct{ Message, Data string }
					modelManagementRequest(t, func(c *gin.Context) {
						c.Set("id", user.Id)
						RequestAmount(c)
					}, http.MethodPost, "/api/user/amount", map[string]float64{"amount": 9.99}, &quote)
					require.Equal(t, "success", quote.Message)
					assert.Equal(t, "9.99", quote.Data)

					var payment struct {
						Message string
						Data    map[string]string
					}
					modelManagementRequest(t, func(c *gin.Context) {
						c.Set("id", user.Id)
						RequestEpay(c)
					}, http.MethodPost, "/api/user/pay", map[string]any{
						"amount": 9.99, "payment_method": "alipay",
					}, &payment)
					require.Equal(t, "success", payment.Message)
					assert.Equal(t, "9.99", payment.Data["money"])
					order := model.GetTopUpByTradeNo(payment.Data["out_trade_no"])
					require.NotNil(t, order)
					assert.Equal(t, 9.99, order.Amount)
					assert.Equal(t, 9.99, order.Money)

					for _, manual := range []bool{false, true} {
						require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", 0).Error)
						require.NoError(t, db.Model(order).Update("status", common.TopUpStatusPending).Error)
						for pass := range 2 {
							if manual {
								require.NoError(t, model.ManualCompleteTopUp(order.TradeNo, "127.0.0.1"))
							} else {
								alreadyDone, err := model.RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
								require.NoError(t, err)
								assert.Equal(t, pass > 0, alreadyDone)
							}
						}
						require.NoError(t, db.First(&user, user.Id).Error)
						assert.Equal(t, 4_995_000, user.Quota)
					}
				})
			}
		})
	}
}

func TestStripeCheckoutKeepsFractionalRechargeAmount(t *testing.T) {
	previousBackend := stripe.GetBackend(stripe.APIBackend)
	previousKey, previousSecret, previousPrice := stripe.Key, setting.StripeApiSecret, setting.StripePriceId
	t.Cleanup(func() {
		stripe.SetBackend(stripe.APIBackend, previousBackend)
		stripe.Key, setting.StripeApiSecret, setting.StripePriceId = previousKey, previousSecret, previousPrice
	})
	setting.StripeApiSecret, setting.StripePriceId = "sk_test_fixture", "price_fixture"
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"id":"price_fixture","currency":"usd","product":"prod_fixture","unit_amount":100,"unit_amount_decimal":"100","tax_behavior":"exclusive"}`))
			return
		}
		if !assert.NoError(t, r.ParseForm()) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		assert.Equal(t, "1", r.Form.Get("line_items[0][quantity]"))
		assert.Equal(t, "prod_fixture", r.Form.Get("line_items[0][price_data][product]"))
		assert.Equal(t, "usd", r.Form.Get("line_items[0][price_data][currency]"))
		assert.Equal(t, "999", r.Form.Get("line_items[0][price_data][unit_amount_decimal]"))
		_, _ = w.Write([]byte(`{"id":"cs_fixture","url":"https://checkout.example/fractional"}`))
	}))
	defer server.Close()
	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{
		URL: stripe.String(server.URL),
	}))

	link, err := genStripeLink("fractional-order", "", "", 9.99, "https://app.example/success", "https://app.example/cancel")
	require.NoError(t, err)
	assert.Equal(t, "https://checkout.example/fractional", link)
	assert.Equal(t, []string{"/v1/prices/price_fixture", "/v1/checkout/sessions"}, calls)
}

func TestValidateTopUpQuotaReturnsMaximumAmount(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	maxAmount := decimal.NewFromInt(common.MaxWalletQuota).
		Div(decimal.NewFromFloat(common.QuotaPerUnit)).
		Floor().IntPart()

	_, err := validateTopUpQuota(float64(maxAmount))
	require.NoError(t, err)
	_, err = validateTopUpQuota(float64(maxAmount + 1))
	require.EqualError(t, err, fmt.Sprintf("Top-up amount cannot exceed %d", maxAmount))
}

func TestRequestAmountRejectsTopUpThatCannotBeSettled(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
	})

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	maxAmount := decimal.NewFromInt(common.MaxWalletQuota).
		Div(decimal.NewFromFloat(common.QuotaPerUnit)).
		Floor().IntPart()
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/user/amount",
		strings.NewReader(fmt.Sprintf(`{"amount":%d}`, maxAmount+1)),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	RequestAmount(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"message":"error","data":"Top-up amount cannot exceed %d","message_key":"Top-up amount cannot exceed {{max}}","message_params":{"max":%d}}`, maxAmount, maxAmount), recorder.Body.String())
}

func TestRequestAmountRejectsTopUpThatWouldOverflowWallet(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	oldDB := model.DB
	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplayType
		model.DB = oldDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			require.NoError(t, sqlDB.Close())
		}
	})

	require.NoError(t, model.DB.Create(&model.User{
		Id:       42,
		Username: "topup_capacity_user",
		Quota:    common.MaxWalletQuota - 100_000,
		Status:   common.UserStatusEnabled,
	}).Error)

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 42)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/user/amount",
		strings.NewReader(`{"amount":1}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	RequestAmount(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"message":"error","data":"Top-up quota limit exceeded","message_key":"Top-up quota limit exceeded"}`, recorder.Body.String())
}

func TestValidateCreditedQuotaRejectsOverflow(t *testing.T) {
	_, err := validateCreditedQuota(decimal.NewFromInt(int64(common.MaxWalletQuota / 2)))
	require.NoError(t, err)
	_, err = validateCreditedQuota(decimal.Zero)
	require.EqualError(t, err, "Top-up quota must be greater than 0")
	_, err = validateCreditedQuota(decimal.NewFromInt(common.MaxWalletQuota + 1))
	require.EqualError(
		t,
		err,
		"Top-up quota exceeds the range the system can represent",
	)
}

func TestStripeCreditedQuotaIncludesGroupRatio(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldTopupGroupRatio := common.TopupGroupRatio2JSONString()
	common.QuotaPerUnit = 500000
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"vip":2}`))
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(oldTopupGroupRatio))
	})

	_, err := validateCreditedQuota(getStripeCreditedQuota(2147, "vip"))
	require.NoError(t, err)
	_, err = validateCreditedQuota(getStripeCreditedQuota(2148, "vip"))
	require.NoError(t, err)
	_, err = validateCreditedQuota(getStripeCreditedQuota(float64(common.MaxWalletQuota), "vip"))
	require.Error(t, err)

	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"free":0}`))
	assert.True(t, decimal.NewFromInt(500000).Equal(getStripeCreditedQuota(1, "free")))
}
