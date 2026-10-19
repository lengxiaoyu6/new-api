package controller

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
)

func TestPaymentReturnPathUsesDefaultDashboardRoutes(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	system_setting.ServerAddress = "https://dashboard.example.com/"
	t.Cleanup(func() { system_setting.ServerAddress = previousAddress })

	assert.Equal(
		t,
		"https://dashboard.example.com/wallet?pay=success",
		paymentReturnPath("/wallet?pay=success"),
	)
	assert.Equal(
		t,
		"https://dashboard.example.com/usage-logs",
		paymentReturnPath("/usage-logs"),
	)
}

type checkoutReturnTransport func(*http.Request) (*http.Response, error)

func (transport checkoutReturnTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestStripeSubscriptionCheckoutReturnsToSubscriptionUsage(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	previousSecret := setting.StripeApiSecret
	previousKey := stripe.Key
	previousBackend := stripe.GetBackend(stripe.APIBackend)
	t.Cleanup(func() {
		system_setting.ServerAddress = previousAddress
		setting.StripeApiSecret = previousSecret
		stripe.Key = previousKey
		stripe.SetBackend(stripe.APIBackend, previousBackend)
	})
	system_setting.ServerAddress = "https://dashboard.example.com/"
	setting.StripeApiSecret = "sk_test_subscription_return"
	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{
		MaxNetworkRetries: stripe.Int64(0),
		HTTPClient: &http.Client{
			Transport: checkoutReturnTransport(func(request *http.Request) (*http.Response, error) {
				require.NoError(t, request.ParseForm())
				assert.Equal(t, "https://dashboard.example.com/subscription-usage", request.Form.Get("success_url"))
				assert.Equal(t, "https://dashboard.example.com/subscription-usage", request.Form.Get("cancel_url"))
				assert.Equal(t, "subscription", request.Form.Get("mode"))
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(`{"id":"cs_test","url":"https://checkout.example.com/session"}`)),
				}, nil
			}),
		},
	}))

	link, err := genStripeSubscriptionLink("subscription-order", "", "buyer@example.com", "price_test")
	require.NoError(t, err)
	assert.Equal(t, "https://checkout.example.com/session", link)
}

func TestSubscriptionEpayInvalidReturnOpensSubscriptionUsage(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	previousPayAddress := operation_setting.PayAddress
	t.Cleanup(func() {
		system_setting.ServerAddress = previousAddress
		operation_setting.PayAddress = previousPayAddress
	})
	system_setting.ServerAddress = "https://dashboard.example.com/"
	operation_setting.PayAddress = ""

	for _, tc := range []struct {
		name   string
		method string
		url    string
		body   string
	}{
		{name: "empty query", method: http.MethodGet, url: "/return"},
		{name: "unconfigured gateway", method: http.MethodGet, url: "/return?out_trade_no=subscription-order"},
		{name: "invalid form", method: http.MethodPost, url: "/return", body: "invalid=%zz"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(tc.method, tc.url, strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			router := gin.New()
			router.Any("/return", SubscriptionEpayReturn)
			router.ServeHTTP(response, request)
			assert.Equal(t, http.StatusFound, response.Code)
			assert.Equal(t, "https://dashboard.example.com/subscription-usage?pay=fail", response.Header().Get("Location"))
		})
	}
}
