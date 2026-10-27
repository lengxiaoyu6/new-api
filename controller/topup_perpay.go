package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func isPerPayTopUpEnabled() bool {
	config := service.GetPerPayConfig()
	return isPaymentComplianceConfirmed() && config.Enabled && config.Validate() == nil
}

func getPerPayMinTopup() float64 {
	minimum := getMinTopup()
	for _, method := range operation_setting.PayMethods {
		if !strings.EqualFold(strings.TrimSpace(method["type"]), model.PaymentProviderPerPay) {
			continue
		}
		configured, err := strconv.ParseFloat(strings.TrimSpace(method["min_topup"]), 64)
		if err == nil && !math.IsNaN(configured) && !math.IsInf(configured, 0) {
			minimum = max(minimum, configured)
		}
	}
	return minimum
}

func RequestPerPay(c *gin.Context) {
	if !isPerPayTopUpEnabled() {
		paymentError(c, common.NewMessage("Payment information has not been configured by administrator"))
		return
	}
	var req AmountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	minimum := getPerPayMinTopup()
	if req.Amount < minimum {
		paymentError(c, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": minimum}))
		return
	}
	userID := c.GetInt("id")
	if rejectInvalidTopUpQuota(c, userID, req.Amount) {
		return
	}
	group, err := model.GetUserGroup(userID, true)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to get the user group"))
		return
	}
	money := getPayMoney(req.Amount, group)
	if math.IsNaN(money) || math.IsInf(money, 0) || money < 0.01 || money > 99_999_999.98 {
		paymentError(c, common.NewMessage("Invalid top-up amount"))
		return
	}
	cents := decimal.NewFromFloat(money).Mul(decimal.NewFromInt(100)).Round(0).IntPart()
	if cents < 1 || cents > 9_999_999_998 {
		paymentError(c, common.NewMessage("Invalid top-up amount"))
		return
	}
	config := service.GetPerPayConfig()
	tradeNo := "PERPAY-" + uuid.NewString()
	request := service.PerPayCreateRequest{
		IdempotencyKey: tradeNo, MerchantOrderNo: tradeNo, AmountCents: cents,
		ProductName: "oaihub wallet recharge",
		NotifyURL:   service.GetCallbackAddress() + "/api/perpay/webhook",
		ReturnURL:   service.GetCallbackAddress() + "/api/perpay/return?order=" + url.QueryEscape(tradeNo),
	}
	body, err := common.Marshal(request)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}
	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		amount = decimal.NewFromFloat(amount).Div(decimal.NewFromFloat(common.QuotaPerUnit)).Truncate(0).InexactFloat64()
	}
	now := common.GetTimestamp()
	topUp := &model.TopUp{
		UserId: userID, Amount: amount, Money: float64(cents) / 100,
		TradeNo: tradeNo, PaymentMethod: model.PaymentProviderPerPay,
		PaymentProvider: model.PaymentProviderPerPay, CreateTime: now, Status: common.TopUpStatusPending,
	}
	order := &model.PerPayOrder{
		TradeNo: tradeNo, ClientID: config.ClientID, Endpoint: config.URL,
		RequestBody: string(body), RequestedAmountCents: cents, CreateTime: now,
	}
	if err := model.CreatePerPayTopUp(topUp, order); err != nil {
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}
	response, err := service.SyncPerPayOrder(c.Request.Context(), tradeNo, nil, "", c.ClientIP())
	if err != nil {
		common.SysError(common.LogText("PerPay checkout creation failed trade_no=%s", tradeNo))
		// Keep the pending order: the provider may have accepted a timed-out
		// request, and reconciliation must reuse its idempotency key.
		paymentError(c, common.NewMessage("Failed to start payment"))
		return
	}
	checkoutURL, err := url.Parse(response.Checkout.CheckoutURL)
	if err != nil || checkoutURL.Host == "" || (checkoutURL.Scheme != "https" && checkoutURL.Scheme != "http") || checkoutURL.User != nil {
		paymentError(c, common.NewMessage("Failed to start payment"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": gin.H{
		"checkout_url": response.Checkout.CheckoutURL,
		"order_id":     tradeNo,
	}})
}

func PerPayWebhook(c *gin.Context) {
	config := service.GetPerPayConfig()
	// Process callbacks for outstanding orders even when new payments are off.
	if config.Validate() != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024))
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	event, err := config.VerifyWebhook(c.Request.Header, body, time.Now())
	if err != nil {
		c.Status(http.StatusUnauthorized)
		return
	}
	digest := sha256.Sum256(body)
	if _, err := service.SyncPerPayOrder(c.Request.Context(), event.MerchantOrderNo, event, hex.EncodeToString(digest[:]), c.ClientIP()); err != nil {
		common.SysError(common.LogText("PerPay webhook could not apply event_id=%s", event.EventID))
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"schema": "perpay:webhook-ack:v1", "ack": true,
		"event_id": event.EventID, "delivery_id": c.GetHeader("X-PerPay-Webhook-Delivery-Id"),
	})
}

func PerPayReturn(c *gin.Context) {
	tradeNo := c.Query("order")
	if len(tradeNo) <= 255 && tradeNo != "" {
		if _, err := service.SyncPerPayOrder(c.Request.Context(), tradeNo, nil, "", c.ClientIP()); err != nil {
			common.SysError(common.LogText("PerPay return query failed"))
		}
	}
	c.Redirect(http.StatusSeeOther, paymentReturnPath("/wallet"))
}

func CheckPerPayOrder(c *gin.Context) {
	tradeNo := c.Param("trade_no")
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil || topUp.UserId != c.GetInt("id") || topUp.PaymentProvider != model.PaymentProviderPerPay {
		c.Status(http.StatusNotFound)
		return
	}
	if _, err := service.SyncPerPayOrder(c.Request.Context(), tradeNo, nil, "", c.ClientIP()); err != nil {
		common.ApiErrorT(c, "Failed to fetch order status")
		return
	}
	order, err := model.GetPerPayOrder(tradeNo)
	if err != nil {
		common.ApiErrorT(c, "Failed to fetch order status")
		return
	}
	common.ApiSuccess(c, order)
}
