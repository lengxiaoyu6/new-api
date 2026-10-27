package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/bytedance/gopkg/util/gopool"
)

type PerPayConfig struct {
	Enabled       bool
	URL           string
	ClientID      string
	APISecret     string
	WebhookSecret string
}

func GetPerPayConfig() PerPayConfig {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return PerPayConfig{
		Enabled: setting.PerPayEnabled, URL: strings.TrimRight(setting.PerPayURL, "/"),
		ClientID: setting.PerPayClientID, APISecret: setting.PerPayAPISecret,
		WebhookSecret: setting.PerPayWebhookSecret,
	}
}

func (config PerPayConfig) Validate() error {
	u, err := url.Parse(config.URL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") ||
		strings.TrimSpace(config.ClientID) == "" || len(config.ClientID) > 128 ||
		strings.ContainsAny(config.ClientID, "\r\n") {
		return errors.New("invalid PerPay endpoint or client ID")
	}
	if u.Scheme == "http" && u.Hostname() != "localhost" {
		ip := net.ParseIP(u.Hostname())
		if ip == nil || !ip.IsLoopback() {
			return errors.New("PerPay requires HTTPS outside loopback")
		}
	}
	for _, secret := range []string{config.APISecret, config.WebhookSecret} {
		key, err := base64.RawURLEncoding.Strict().DecodeString(secret)
		if err != nil || len(key) != 32 {
			return errors.New("PerPay secrets must be 32-byte base64url values")
		}
	}
	return nil
}

type PerPayCreateRequest struct {
	IdempotencyKey  string `json:"idempotency_key"`
	MerchantOrderNo string `json:"merchant_order_no"`
	AmountCents     int64  `json:"amount_cents"`
	ProductName     string `json:"product_name"`
	NotifyURL       string `json:"notify_url"`
	ReturnURL       string `json:"return_url"`
}

type PerPayOrderResponse struct {
	OrderID              string `json:"order_id"`
	MerchantOrderNo      string `json:"merchant_order_no"`
	RequestedAmountCents int64  `json:"requested_amount_cents"`
	PayableAmountCents   int64  `json:"payable_amount_cents"`
	ReceivedAmountCents  *int64 `json:"received_amount_cents"`
	Currency             string `json:"currency"`
	Version              int64  `json:"version"`
	Checkout             struct {
		Status      string `json:"status"`
		CheckoutURL string `json:"checkout_url"`
	} `json:"checkout"`
	Payment struct {
		Status              string `json:"status"`
		ReceivedAmountCents *int64 `json:"received_amount_cents"`
	} `json:"payment"`
	Refund struct {
		Status string `json:"status"`
	} `json:"refund"`
}

func (config PerPayConfig) request(ctx context.Context, method, target string, body []byte) (*PerPayOrderResponse, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	nonceBytes := make([]byte, 32)
	if _, err := rand.Read(nonceBytes); err != nil {
		return nil, err
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	digest := sha256.Sum256(body)
	text := strings.Join([]string{"PERPAY-HMAC-SHA256", "v1", method, target, timestamp, nonce, config.ClientID, hex.EncodeToString(digest[:])}, "\n")
	key, _ := base64.RawURLEncoding.DecodeString(config.APISecret)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(text))
	req, err := http.NewRequestWithContext(ctx, method, config.URL+target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-PerPay-Client-Id", config.ClientID)
	req.Header.Set("X-PerPay-Timestamp", timestamp)
	req.Header.Set("X-PerPay-Nonce", nonce)
	req.Header.Set("X-PerPay-Signature-Version", "v1")
	req.Header.Set("X-PerPay-Signature", hex.EncodeToString(mac.Sum(nil)))
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(req)
	if err != nil {
		// Do not include the request URL or transport error, which may carry
		// credentials or response fragments from an upstream proxy.
		return nil, errors.New("PerPay request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("PerPay returned HTTP %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 128*1024+1))
	if err != nil || len(payload) > 128*1024 {
		return nil, errors.New("invalid PerPay response body")
	}
	var envelope struct {
		Data *PerPayOrderResponse `json:"data"`
	}
	if err := common.Unmarshal(payload, &envelope); err != nil || envelope.Data == nil {
		return nil, errors.New("invalid PerPay order response")
	}
	return envelope.Data, nil
}

type PerPayWebhookEvent struct {
	Schema          string `json:"schema"`
	EventID         string `json:"event_id"`
	EventType       string `json:"event_type"`
	OrderID         string `json:"order_id"`
	MerchantOrderNo string `json:"merchant_order_no"`
	PaymentStatus   string `json:"payment_status"`
	OrderVersion    int64  `json:"order_version"`
}

func (config PerPayConfig) VerifyWebhook(headers http.Header, body []byte, now time.Time) (*PerPayWebhookEvent, error) {
	key, err := base64.RawURLEncoding.Strict().DecodeString(config.WebhookSecret)
	if err != nil || len(key) != 32 || headers.Get("X-PerPay-Webhook-Version") != "1" {
		return nil, errors.New("invalid PerPay webhook configuration or version")
	}
	names := []string{"Key-Id", "Timestamp", "Delivery-Id", "Event-Id", "Attempt"}
	parts := []string{"perpay:webhook:v1"}
	for _, name := range names {
		values := headers.Values("X-PerPay-Webhook-" + name)
		if len(values) != 1 || values[0] == "" || len(values[0]) > 128 || strings.ContainsAny(values[0], "\r\n") {
			return nil, errors.New("invalid PerPay webhook headers")
		}
		parts = append(parts, values[0])
	}
	timestamp, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || timestamp < now.Add(-5*time.Minute).UnixMilli() || timestamp > now.Add(5*time.Minute).UnixMilli() {
		return nil, errors.New("PerPay webhook timestamp outside allowed window")
	}
	attempt, err := strconv.ParseInt(parts[5], 10, 64)
	if err != nil || attempt < 1 {
		return nil, errors.New("invalid PerPay webhook attempt")
	}
	digest := sha256.Sum256(body)
	parts = append(parts, hex.EncodeToString(digest[:]))
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(strings.Join(parts, "\n")))
	signature := headers.Get("X-PerPay-Webhook-Signature")
	if !hmac.Equal([]byte("v1="+hex.EncodeToString(mac.Sum(nil))), []byte(signature)) {
		return nil, errors.New("invalid PerPay webhook signature")
	}
	var event PerPayWebhookEvent
	if err := common.Unmarshal(body, &event); err != nil {
		return nil, errors.New("invalid PerPay webhook JSON")
	}
	if event.Schema != "perpay:outbox-event:v2" || event.EventID != parts[4] ||
		event.OrderID == "" || len(event.OrderID) > 64 ||
		event.MerchantOrderNo == "" || len(event.MerchantOrderNo) > 255 ||
		len(event.EventID) > 64 || event.OrderVersion < 1 {
		return nil, errors.New("invalid PerPay event")
	}
	switch event.EventType {
	case "PAYMENT_CONFIRMED", "PAYMENT_DISPUTED", "REFUND_UPDATED":
	default:
		return nil, errors.New("unsupported PerPay event type")
	}
	return &event, nil
}

// SyncPerPayOrder always queries the server. A notification's payment status and
// the browser return parameters alone can never authorize a balance credit.
func SyncPerPayOrder(ctx context.Context, tradeNo string, event *PerPayWebhookEvent, fingerprint, callerIP string) (*PerPayOrderResponse, error) {
	config := GetPerPayConfig()
	order, err := model.GetPerPayOrder(tradeNo)
	if err != nil {
		return nil, err
	}
	if order.ClientID != config.ClientID || order.Endpoint != config.URL {
		return nil, model.ErrPerPayOrderMismatch
	}
	if event != nil && order.OrderID != "" && order.OrderID != event.OrderID {
		return nil, model.ErrPerPayOrderMismatch
	}
	var response *PerPayOrderResponse
	if order.OrderID == "" && event == nil {
		// The persisted body and idempotency key are reused after a timeout.
		response, err = config.request(ctx, http.MethodPost, "/api/v1/orders", []byte(order.RequestBody))
	} else {
		orderID := order.OrderID
		if orderID == "" {
			orderID = event.OrderID
		}
		response, err = config.request(ctx, http.MethodGet, "/api/v1/orders/"+url.PathEscape(orderID), nil)
	}
	if err != nil {
		return nil, err
	}
	if response.MerchantOrderNo != tradeNo || (event != nil && response.OrderID != event.OrderID) {
		return nil, model.ErrPerPayOrderMismatch
	}
	received := int64(0)
	if response.ReceivedAmountCents != nil {
		received = *response.ReceivedAmountCents
	}
	if response.Payment.Status == "CONFIRMED" &&
		(response.ReceivedAmountCents == nil || response.Payment.ReceivedAmountCents == nil ||
			received != *response.Payment.ReceivedAmountCents) {
		return nil, model.ErrPerPayOrderMismatch
	}
	var record *model.PerPayEvent
	if event != nil {
		record = &model.PerPayEvent{
			EventID: event.EventID, TradeNo: tradeNo, Fingerprint: fingerprint,
			Version: event.OrderVersion, CreateTime: common.GetTimestamp(),
		}
	}
	err = model.ApplyPerPaySnapshot(config.ClientID, config.URL, model.PerPaySnapshot{
		OrderID: response.OrderID, MerchantOrderNo: response.MerchantOrderNo,
		RequestedAmountCents: response.RequestedAmountCents, PayableAmountCents: response.PayableAmountCents,
		ReceivedAmountCents: received, Currency: response.Currency, Version: response.Version,
		PaymentStatus: response.Payment.Status, RefundStatus: response.Refund.Status,
		CheckoutStatus: response.Checkout.Status,
	}, record, callerIP)
	if err != nil {
		return nil, err
	}
	return response, nil
}

var perPayReconciliationOnce sync.Once

func StartPerPayReconciliation() {
	perPayReconciliationOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(runPerPayReconciliation)
	})
}

func runPerPayReconciliation() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		config := GetPerPayConfig()
		// Disabling new payments does not abandon existing paid orders.
		if config.Validate() == nil {
			orders, err := model.GetPerPayOrdersToCheck(common.GetTimestamp(), config.ClientID, config.URL)
			if err != nil {
				common.SysError(common.LogText("PerPay reconciliation could not load orders"))
			}
			for _, order := range orders {
				if order.ClientID != config.ClientID || order.Endpoint != config.URL {
					continue
				}
				if _, err := SyncPerPayOrder(context.Background(), order.TradeNo, nil, "", ""); err != nil {
					// Failed orders must not monopolize the next batch.
					model.DB.Model(&model.PerPayOrder{}).Where("trade_no = ?", order.TradeNo).
						Update("last_checked_at", common.GetTimestamp())
					common.SysError(common.LogText("PerPay reconciliation failed trade_no=%s", order.TradeNo))
				}
			}
		}
		<-ticker.C
	}
}
