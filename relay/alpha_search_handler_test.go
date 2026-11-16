package relay

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func deepSeekASRWAV(seconds int) []byte {
	dataSize := seconds * 8000 * 2
	audio := make([]byte, 44+dataSize)
	copy(audio, "RIFF")
	binary.LittleEndian.PutUint32(audio[4:], uint32(36+dataSize))
	copy(audio[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(audio[16:], 16)
	binary.LittleEndian.PutUint16(audio[20:], 1)
	binary.LittleEndian.PutUint16(audio[22:], 1)
	binary.LittleEndian.PutUint32(audio[24:], 8000)
	binary.LittleEndian.PutUint32(audio[28:], 16000)
	binary.LittleEndian.PutUint16(audio[32:], 2)
	binary.LittleEndian.PutUint16(audio[34:], 16)
	copy(audio[36:], "data")
	binary.LittleEndian.PutUint32(audio[40:], uint32(dataSize))
	return audio
}

func deepSeekASRContext(t *testing.T, writer http.ResponseWriter, audio []byte, baseURL string, extraFields ...string) (*gin.Context, []byte) {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	// Format is determined from content, even with an unrelated extension.
	file, err := form.CreateFormFile("file", "speech.bin")
	require.NoError(t, err)
	_, err = file.Write(audio)
	require.NoError(t, err)
	for _, field := range extraFields {
		require.NoError(t, form.WriteField(field, "unexpected"))
	}
	require.NoError(t, form.Close())
	c := deepSeekOCRContext(t, writer, body.Bytes(), form.FormDataContentType(), baseURL)
	c.Request.URL.Path = "/v1/tools/asr"
	common.SetContextKey(c, constant.ContextKeyOriginalModel, constant.DeepSeekASRModel)
	return c, body.Bytes()
}

func TestDeepSeekASR(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })
	settings := config.GlobalConfig.Get("billing_setting").(*billing_setting.BillingSetting)
	saved, savedPrices := *settings, ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() {
		*settings = saved
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
	})
	tests := []struct {
		name, response, expression, prices string
		status, quota, reservation         int
		wantError                          bool
	}{
		{name: "fractional second rounds up", response: `{"request_id":"req","text":"hello","duration_ms":3200}`, quota: 32, reservation: 967},
		{name: "whole second", response: `{"text":"hello","duration_ms":1000}`, quota: 8, reservation: 967},
		{name: "maximum duration", response: `{"text":"hello","duration_ms":120000}`, quota: 967, reservation: 967},
		{name: "silent transcript still bills audio", response: `{"text":"","duration_ms":1}`, quota: 8, reservation: 967},
		{name: "custom per-second price", response: `{"text":"hello","duration_ms":3200}`, expression: `tier("second", fixed(0.001)) * audio_seconds`, quota: 2000, reservation: 60000},
		{name: "custom per-request price", response: `{"text":"hello","duration_ms":3200}`, expression: `tier("request", fixed(0.01))`, quota: 5000, reservation: 5000},
		{name: "explicit free expression", response: `{"text":"hello","duration_ms":3200}`, expression: `tier("second", fixed(0)) * audio_seconds`},
		{name: "legacy per-request override", response: `{"text":"hello","duration_ms":3200}`, prices: `{"deepseek-asr":0.01}`, quota: 5000, reservation: 5000},
		{name: "legacy free override", response: `{"text":"hello","duration_ms":3200}`, prices: `{"deepseek-asr":0}`},
		{name: "zero duration", response: `{"text":"","duration_ms":0}`, wantError: true},
		{name: "negative duration", response: `{"text":"","duration_ms":-1}`, wantError: true},
		{name: "oversized duration", response: `{"text":"","duration_ms":120001}`, wantError: true},
		{name: "fractional milliseconds", response: `{"text":"","duration_ms":1.5}`, wantError: true},
		{name: "overflow duration", response: `{"text":"","duration_ms":18446744073709551615}`, wantError: true},
		{name: "missing duration", response: `{"text":"hello"}`, wantError: true},
		{name: "missing transcript", response: `{"duration_ms":1000}`, wantError: true},
		{name: "HTTP 200 error", response: `{"error":{"message":"recognition failed","type":"server_error"}}`, wantError: true},
		{name: "busy upstream", status: 503, response: `{"error":{"message":"busy","type":"server_error"}}`, wantError: true},
		{name: "invalid JSON", response: `{"text":`, wantError: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			*settings = billing_setting.BillingSetting{BillingMode: map[string]string{}, BillingExpr: map[string]string{}}
			if tt.expression != "" {
				settings.BillingMode[constant.DeepSeekASRModel] = billing_setting.BillingModeTieredExpr
				settings.BillingExpr[constant.DeepSeekASRModel] = tt.expression
			}
			prices := tt.prices
			if prices == "" {
				prices = `{}`
			}
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(prices))
			var gotBody []byte
			var gotPath, gotContentType, gotAuth string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath, gotContentType, gotAuth = r.URL.Path, r.Header.Get("Content-Type"), r.Header.Get("Authorization")
				gotBody, _ = io.ReadAll(r.Body)
				w.Header().Set("Content-Type", "application/json")
				if tt.status != 0 {
					w.WriteHeader(tt.status)
				}
				_, _ = io.WriteString(w, tt.response)
			}))
			t.Cleanup(upstream.Close)
			recorder := httptest.NewRecorder()
			c, body := deepSeekASRContext(t, recorder, deepSeekASRWAV(1), upstream.URL)
			request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
			require.NoError(t, err)
			assert.Empty(t, request.GetTokenCountMeta().CombineText)
			info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
			require.NoError(t, err)
			price, err := helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
			require.NoError(t, err)
			reservation := tt.reservation
			if tt.wantError {
				reservation = 967
			}
			assert.Equal(t, reservation, price.QuotaToPreConsume)
			assert.Empty(t, info.BillingRequestInput.Body, "file data must stay outside pricing snapshots")
			settlement := &recordedSettlement{}
			info.Billing = settlement
			apiErr := RefundFailedRequestBilling(c, info, DeepSeekFileHelper(c, info))
			assert.Equal(t, "/v1/tools/asr", gotPath)
			assert.Equal(t, c.Request.Header.Get("Content-Type"), gotContentType)
			assert.Equal(t, "Bearer sk-test", gotAuth)
			assert.Equal(t, body, gotBody)
			if tt.wantError {
				require.NotNil(t, apiErr)
				assert.True(t, types.IsSkipRetryError(apiErr))
				assert.True(t, settlement.refunded)
				assert.Empty(t, settlement.settled)
				return
			}
			require.Nil(t, apiErr)
			assert.Equal(t, []int{tt.quota}, settlement.settled)
			assert.False(t, settlement.refunded)
			assert.Equal(t, tt.response, recorder.Body.String())
			other := service.GenerateTextOtherInfo(c, info, 0, 1, 0, 0, 0, info.PriceData.ModelPrice, -1)
			if info.TieredBillingSnapshot != nil {
				if tt.expression == "" || strings.Contains(tt.expression, "audio_seconds") {
					assert.Equal(t, 120, *info.TieredBillingSnapshot.EstimatedAudioSeconds)
				}
				settled, quota, result := service.TryTieredSettle(info, billingexpr.TokenParams{P: 1e12, C: 1e12})
				require.True(t, settled)
				assert.Equal(t, tt.quota, quota)
				service.InjectTieredBillingInfo(other, info, result)
			}
			assert.Equal(t, *info.BillingAudioSeconds, other.Snapshot()["audio_seconds"])
		})
	}
}

func TestDeepSeekASRValidation(t *testing.T) {
	// One second of mono Opus silence, encoded by FFmpeg; no runtime encoder is needed.
	opus, err := base64.StdEncoding.DecodeString("T2dnUwACAAAAAAAAAADrbdE9AAAAAOTU3TwBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAOtt0T0BAAAAtcmVZAE/T3B1c1RhZ3MNAAAATGF2ZjU4Ljc2LjEwMAEAAAAeAAAAZW5jb2Rlcj1MYXZjNTguMTM0LjEwMCBsaWJvcHVzT2dnUwAAgLsAAAAAAADrbdE9AgAAAOb9HAIyBwYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYIC+Y7I6tgCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GCAissw7GT2dnUwAEuLwAAAAAAADrbdE9AwAAANDGIG4BBggIrLMOxg==")
	require.NoError(t, err)
	nonPCM := deepSeekASRWAV(1)
	binary.LittleEndian.PutUint16(nonPCM[20:], 3)
	wrongBits := deepSeekASRWAV(1)
	binary.LittleEndian.PutUint16(wrongBits[34:], 24)
	tests := []struct {
		name   string
		audio  []byte
		fields []string
		valid  bool
	}{
		{name: "Ogg Opus", audio: opus, valid: true},
		{name: "float WAV", audio: nonPCM},
		{name: "24-bit WAV", audio: wrongBits},
		{name: "PCM WAV", audio: deepSeekASRWAV(1), valid: true},
		{name: "maximum duration", audio: deepSeekASRWAV(120), valid: true},
		{name: "too long", audio: deepSeekASRWAV(121)},
		{name: "unsupported content", audio: []byte("not a WAV or Opus file")},
		{name: "empty file"},
		{name: "file too large", audio: make([]byte, dto.MaxASRFileSize+1)},
		{name: "unexpected model", audio: deepSeekASRWAV(1), fields: []string{"model"}},
		{name: "unexpected language", audio: deepSeekASRWAV(1), fields: []string{"language"}},
		{name: "unexpected multiplier", audio: deepSeekASRWAV(1), fields: []string{"audio_seconds"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := deepSeekASRContext(t, httptest.NewRecorder(), tt.audio, "", tt.fields...)
			_, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
			if tt.valid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
	t.Run("bounded audio quantities", func(t *testing.T) {
		expression, ok := billing_setting.GetBillingExpr(constant.DeepSeekASRModel)
		require.True(t, ok)
		for _, seconds := range []int{-1, 0, 1, 120, 121} {
			cost, trace, err := billingexpr.RunExprWithRequest(expression, billingexpr.TokenParams{}, billingexpr.RequestInput{AudioSeconds: &seconds})
			if seconds < 1 || seconds > 120 {
				require.ErrorContains(t, err, "audio_seconds")
				continue
			}
			require.NoError(t, err)
			assert.InDelta(t, float64(seconds)*0.058/3600*1e6, cost, 1e-8)
			assert.Equal(t, &seconds, trace.AudioSeconds)
			assert.Equal(t, billingexpr.BillingUnitRequest, trace.BillingUnit)
		}
		assert.True(t, billingexpr.UsesChatQuantities(expression))
	})
}

func TestBuildAlphaSearchRequestBodyPreservesUnknownFields(t *testing.T) {
	raw := []byte(`{
		"id":"req_1",
		"model":"gpt-5.1",
		"input":[{"role":"user","content":"hi"}],
		"commands":{"search_query":[{"q":"weather","recency":1}]},
		"settings":{"locale":"en"},
		"future_field":{"nested":true}
	}`)

	out, err := buildAlphaSearchRequestBody(raw, "gpt-5.1", "gpt-5.1-mapped")
	require.NoError(t, err)

	var body map[string]any
	require.NoError(t, common.Unmarshal(out, &body))
	assert.Equal(t, "gpt-5.1-mapped", body["model"])
	assert.Equal(t, "req_1", body["id"])
	require.Contains(t, body, "commands")
	require.Contains(t, body, "settings")
	require.Contains(t, body, "future_field")
	require.Contains(t, body, "input")

	commands, ok := body["commands"].(map[string]any)
	require.True(t, ok)
	require.Contains(t, commands, "search_query")

	future, ok := body["future_field"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, future["nested"])
}

func TestBuildAlphaSearchRequestBodyNoMappingKeepsRawBytes(t *testing.T) {
	raw := []byte(`{"model":"gpt-5.1","commands":{"search_query":[{"q":"x"}]},"future_field":1}`)
	out, err := buildAlphaSearchRequestBody(raw, "gpt-5.1", "gpt-5.1")
	require.NoError(t, err)
	assert.Equal(t, raw, out)
}

// A single model is rewritten where it stands. Routing reads the first
// "model" and most upstreams read the last, so a repeated model comes out as
// one member carrying the mapped value.
func TestBuildAlphaSearchRequestBodyRewritesModel(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"single model keeps its place", `{"model":"gpt-5.1","input":[]}`, `{"model":"gpt-5.1-mapped","input":[]}`},
		{"repeated model collapses", `{"model":"gpt-5.1","input":[],"model":"gpt-5.5-pro"}`, `{"input":[],"model":"gpt-5.1-mapped"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := buildAlphaSearchRequestBody([]byte(tt.raw), "gpt-5.1", "gpt-5.1-mapped")
			require.NoError(t, err)
			assert.Equal(t, tt.want, string(out))
		})
	}
}

type recordedSettlement struct {
	settled  []int
	refunded bool
}

func (s *recordedSettlement) Settle(quota int) error {
	s.settled = append(s.settled, quota)
	return nil
}
func (s *recordedSettlement) Refund(*gin.Context)    { s.refunded = true }
func (*recordedSettlement) NeedsRefund() bool        { return false }
func (*recordedSettlement) GetPreConsumedQuota() int { return 0 }
func (*recordedSettlement) Reserve(int) error        { return nil }

func (*recordedSettlement) ReserveBeforeSubmit(int) error { return nil }

// /v1/tools/search and /v1/tools/fetch follow /v1/alpha/search: the raw body
// reaches /v1/tools/* unchanged and the response returns unchanged. With only
// the built-in prices, a response DeepSeek bills (results, page content)
// settles one call at the routing name's request price and no tokens, an
// empty one releases the reservation, an upstream error keeps its status, and
// a channel that cannot relay the endpoint fails retryably without sending
// anything.
func TestDeepSeekToolsHelper(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })

	const search, fetch = "/v1/tools/search", "/v1/tools/fetch"
	const results = `{"results":[{"title":"DeepSeek","url":"https://deepseek.com/","rerank_score":2.1}]}`
	tests := []struct {
		name, path, body, response string
		channelType, status        int
		settled                    []int
		refunded                   bool
	}{
		{name: "search with results", path: search, body: `{"query":"deepseek","count":2,"future_field":{"nested":true}}`,
			response: results, channelType: constant.ChannelTypeDeepSeek, status: http.StatusOK, settled: []int{375}},
		{name: "search without results", path: search, body: `{"query":"site:none.invalid deepseek"}`,
			response: `{"results":[]}`, channelType: constant.ChannelTypeDeepSeek, status: http.StatusOK, refunded: true},
		{name: "fetch with page content", path: fetch, body: `{"url":"https://example.com/"}`,
			response: `{"title":"Example Domain","content":"# Example Domain"}`, channelType: constant.ChannelTypeDeepSeek, status: http.StatusOK, settled: []int{375}},
		{name: "fetch failure keeps its status", path: fetch, body: `{"url":"https://example.com/missing"}`,
			response:    `{"error":{"message":"failed to fetch URL","type":"not_found_error","param":null,"code":"invalid_request_error"}}`,
			channelType: constant.ChannelTypeDeepSeek, status: http.StatusNotFound},
		{name: "search through a New API channel", path: search, body: `{"query":"deepseek"}`,
			response: results, channelType: constant.ChannelTypeNewAPI, status: http.StatusOK, settled: []int{375}},
		{name: "channel without the endpoint", path: search, body: `{"query":"deepseek"}`, channelType: constant.ChannelTypeOpenAI},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var gotPath string
			var gotBody []byte
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotBody, _ = io.ReadAll(r.Body)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.response)
			}))
			t.Cleanup(upstream.Close)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			routingName := map[string]string{search: constant.DeepSeekSearchModel, fetch: constant.DeepSeekFetchModel}[tc.path]
			common.SetContextKey(c, constant.ContextKeyOriginalModel, routingName)
			common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
			common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
			common.SetContextKey(c, constant.ContextKeyChannelType, tc.channelType)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
			common.SetContextKey(c, constant.ContextKeyChannelKey, "sk-test")

			request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
			require.NoError(t, err)
			info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
			require.NoError(t, err)
			info.BillingRequestInput = &billingexpr.RequestInput{Body: []byte(tc.body)}
			_, err = helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
			require.NoError(t, err, "the routing name is priced out of the box")
			settlement := &recordedSettlement{}
			info.Billing = settlement

			apiErr := DeepSeekToolsHelper(c, info)
			if tc.status == 0 {
				require.NotNil(t, apiErr)
				assert.False(t, types.IsSkipRetryError(apiErr))
				assert.Empty(t, gotPath)
				return
			}
			assert.Equal(t, tc.path, gotPath)
			assert.Equal(t, tc.body, string(gotBody))
			assert.Equal(t, tc.settled, settlement.settled)
			assert.Equal(t, tc.refunded, settlement.refunded)
			if tc.status != http.StatusOK {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.status, apiErr.StatusCode)
				return
			}
			require.Nil(t, apiErr)
			assert.Equal(t, tc.status, recorder.Code)
			assert.Equal(t, tc.response, recorder.Body.String())
		})
	}
}

func deepSeekOCRUpload(t *testing.T, purpose string, extraFields ...string) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("purpose", purpose))
	for _, field := range extraFields {
		require.NoError(t, writer.WriteField(field, "extra"))
	}
	file, err := writer.CreateFormFile("file", "document.pdf")
	require.NoError(t, err)
	_, err = io.WriteString(file, "%PDF-1.7\nOCR test document\n")
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return body.Bytes(), writer.FormDataContentType()
}

func deepSeekOCRContext(t *testing.T, writer http.ResponseWriter, body []byte, contentType, baseURL string) *gin.Context {
	t.Helper()
	c, _ := gin.CreateTestContext(writer)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/tools/ocr", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", contentType)
	common.SetContextKey(c, constant.ContextKeyOriginalModel, constant.DeepSeekOCRModel)
	common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
	common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeDeepSeek)
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, baseURL)
	common.SetContextKey(c, constant.ContextKeyChannelKey, "sk-test")
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	return c
}

func TestDeepSeekOCR(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })
	settings := config.GlobalConfig.Get("billing_setting").(*billing_setting.BillingSetting)
	saved := *settings
	savedPrices := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() {
		*settings = saved
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
	})
	const page = `{"index":0,"text":"recognized text","finish_reason":"stop"}`
	const twoPages = `{"object":"ocr.result","page_count":2,"pages":[` + page + `,{"index":1,"text":"","finish_reason":"length"}],"usage":{"input_tokens":1000000000,"output_tokens":1000000000}}`
	tests := []struct {
		name, response string
		status         int
		quota          int
		wantError      bool
		expression     string
		prices         string
		reservation    int
	}{
		{name: "custom per-page price", response: twoPages, expression: `tier("page", fixed(0.001)) * page_count`, reservation: 500000, quota: 1000},
		{name: "custom per-request price", response: twoPages, expression: `tier("request", fixed(0.01))`, reservation: 5000, quota: 5000},
		{name: "explicit free expression", response: twoPages, expression: `tier("page", fixed(0)) * page_count`},
		{name: "legacy per-request override", response: twoPages, prices: `{"deepseek-ocr":0.01}`, reservation: 5000, quota: 5000},
		{name: "legacy free override", response: twoPages, prices: `{"deepseek-ocr":0}`},
		{name: "two pages ignore reference tokens", response: twoPages, quota: 225},
		{name: "one page rounds once", response: `{"object":"ocr.result","page_count":1,"pages":[` + page + `]}`, quota: 113},
		{name: "HTTP 200 error after heartbeat", response: "\n" + `{"error":{"message":"OCR did not finish in time","type":"gateway_timeout_error","code":"gateway_timeout_error"}}`, wantError: true},
		{name: "upstream upload rejection", status: 413, response: `{"error":{"message":"file is too large","type":"invalid_request_error","code":"invalid_request_error"}}`, wantError: true},
		{name: "page count differs from payload", response: `{"object":"ocr.result","page_count":2,"pages":[` + page + `]}`, wantError: true},
		{name: "negative page count", response: `{"object":"ocr.result","page_count":-1,"pages":[]}`, wantError: true},
		{name: "fractional page count", response: `{"object":"ocr.result","page_count":1.5,"pages":[` + page + `]}`, wantError: true},
		{name: "oversized page count", response: `{"object":"ocr.result","page_count":1001,"pages":[]}`, wantError: true},
		{name: "page without text", response: `{"object":"ocr.result","page_count":1,"pages":[{"index":0}]}`, wantError: true},
		{name: "invalid JSON", response: `{"object":"ocr.result"`, wantError: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			*settings = billing_setting.BillingSetting{BillingMode: map[string]string{}, BillingExpr: map[string]string{}}
			if tt.expression != "" {
				settings.BillingMode[constant.DeepSeekOCRModel] = billing_setting.BillingModeTieredExpr
				settings.BillingExpr[constant.DeepSeekOCRModel] = tt.expression
			}
			prices := tt.prices
			if prices == "" {
				prices = `{}`
			}
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(prices))
			body, contentType := deepSeekOCRUpload(t, "rich_layout_recognition")
			var gotBody []byte
			var gotPath, gotContentType, gotAuth string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath, gotContentType, gotAuth = r.URL.Path, r.Header.Get("Content-Type"), r.Header.Get("Authorization")
				gotBody, _ = io.ReadAll(r.Body)
				w.Header().Set("Content-Type", "application/json")
				if tt.status != 0 {
					w.WriteHeader(tt.status)
				}
				_, _ = io.WriteString(w, tt.response)
			}))
			t.Cleanup(upstream.Close)
			recorder := httptest.NewRecorder()
			c := deepSeekOCRContext(t, recorder, body, contentType, upstream.URL)
			request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
			require.NoError(t, err)
			assert.Empty(t, request.GetTokenCountMeta().CombineText)
			info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
			require.NoError(t, err)
			price, err := helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
			require.NoError(t, err)
			wantReservation := 112500
			if tt.expression != "" || tt.prices != "" {
				wantReservation = tt.reservation
			}
			assert.Equal(t, wantReservation, price.QuotaToPreConsume)
			if info.TieredBillingSnapshot != nil {
				if tt.expression == "" || strings.Contains(tt.expression, "page_count") {
					require.NotNil(t, info.TieredBillingSnapshot.EstimatedPageCount)
					assert.Equal(t, dto.MaxOCRPages, *info.TieredBillingSnapshot.EstimatedPageCount)
				}
				assert.JSONEq(t, `{"purpose":"rich_layout_recognition"}`, string(info.BillingRequestInput.Body))
			}
			settlement := &recordedSettlement{}
			info.Billing = settlement
			apiErr := DeepSeekFileHelper(c, info)
			apiErr = RefundFailedRequestBilling(c, info, apiErr)
			assert.Equal(t, "/v1/tools/ocr", gotPath)
			assert.Equal(t, contentType, gotContentType)
			assert.Equal(t, "Bearer sk-test", gotAuth)
			assert.Equal(t, body, gotBody, "preserve file bytes, filename, fields and boundary")
			if tt.wantError {
				require.NotNil(t, apiErr)
				assert.True(t, types.IsSkipRetryError(apiErr), "never replay a submitted recognition")
				assert.True(t, settlement.refunded)
				assert.Empty(t, settlement.settled)
				if tt.status != 0 {
					assert.Equal(t, tt.status, apiErr.StatusCode)
				}
				return
			}
			require.Nil(t, apiErr)
			assert.Equal(t, []int{tt.quota}, settlement.settled)
			assert.False(t, settlement.refunded)
			assert.Equal(t, tt.response, recorder.Body.String())
			assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))
			other := service.GenerateTextOtherInfo(c, info, 0, 1, 0, 0, 0, info.PriceData.ModelPrice, -1)
			if info.TieredBillingSnapshot != nil {
				settled, quota, result := service.TryTieredSettle(info, billingexpr.TokenParams{})
				require.True(t, settled)
				assert.Equal(t, tt.quota, quota)
				service.InjectTieredBillingInfo(other, info, result)
			}
			assert.Equal(t, *info.BillingPageCount, other.Snapshot()["page_count"])
		})
	}

	t.Run("validate multipart before reservation", func(t *testing.T) {
		for _, tc := range []struct {
			name, purpose string
			extra         []string
		}{
			{name: "invalid purpose", purpose: "ocr"},
			{name: "empty purpose"},
			{name: "unexpected model", purpose: "text_recognition", extra: []string{"model"}},
			{name: "duplicate purpose", purpose: "text_recognition", extra: []string{"purpose"}},
			{name: "unexpected field", purpose: "text_recognition", extra: []string{"page_count"}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				body, contentType := deepSeekOCRUpload(t, tc.purpose, tc.extra...)
				c := deepSeekOCRContext(t, httptest.NewRecorder(), body, contentType, "")
				_, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
				require.Error(t, err)
			})
		}
		c := deepSeekOCRContext(t, httptest.NewRecorder(), []byte(`{"purpose":"text_recognition"}`), "application/json", "")
		_, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
		require.ErrorContains(t, err, "multipart/form-data")
	})

	t.Run("bounded page expression and maximum reservation", func(t *testing.T) {
		expression, ok := billing_setting.GetBillingExpr(constant.DeepSeekOCRModel)
		require.True(t, ok)
		for _, count := range []int{-1, 0, 1, 1000, 1001} {
			t.Run(fmt.Sprint(count), func(t *testing.T) {
				cost, trace, err := billingexpr.RunExprWithRequest(expression, billingexpr.TokenParams{P: 1e12, C: 1e12}, billingexpr.RequestInput{PageCount: &count})
				if count < 1 || count > dto.MaxOCRPages {
					require.ErrorContains(t, err, "page_count")
					return
				}
				require.NoError(t, err)
				assert.InDelta(t, float64(count)*225, cost, 1e-8)
				assert.Equal(t, &count, trace.PageCount)
				assert.Equal(t, billingexpr.BillingUnitRequest, trace.BillingUnit)
			})
		}
	})
}

type ocrDisconnectWriter struct {
	*httptest.ResponseRecorder
	onHeartbeat  func()
	disconnected bool
}

func (w *ocrDisconnectWriter) Flush() {
	w.ResponseRecorder.Flush()
	if !w.disconnected {
		w.disconnected = true
		w.onHeartbeat()
	}
}

func (w *ocrDisconnectWriter) Write(p []byte) (int, error) {
	if w.disconnected {
		return 0, io.ErrClosedPipe
	}
	return w.ResponseRecorder.Write(p)
}

func TestDeepSeekOCRSettlesAfterClientDisconnect(t *testing.T) {
	service.InitHttpClient()
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })
	heartbeat := make(chan struct{})
	upstreamContext := make(chan error, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = io.WriteString(w, "\n")
		w.(http.Flusher).Flush()
		select {
		case <-heartbeat:
			upstreamContext <- r.Context().Err()
			_, _ = io.WriteString(w, `{"object":"ocr.result","page_count":1,"pages":[{"index":0,"text":"recognized","finish_reason":"stop"}]}`)
		case <-r.Context().Done():
			upstreamContext <- r.Context().Err()
		}
	}))
	t.Cleanup(upstream.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var once sync.Once
	writer := &ocrDisconnectWriter{ResponseRecorder: httptest.NewRecorder(), onHeartbeat: func() {
		once.Do(func() { cancel(); close(heartbeat) })
	}}
	body, contentType := deepSeekOCRUpload(t, "text_recognition")
	c := deepSeekOCRContext(t, writer, body, contentType, upstream.URL)
	c.Request = c.Request.WithContext(ctx)
	request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
	require.NoError(t, err)
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
	require.NoError(t, err)
	_, err = helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
	require.NoError(t, err)
	settlement := &recordedSettlement{}
	info.Billing = settlement
	require.Nil(t, DeepSeekFileHelper(c, info))
	require.ErrorIs(t, ctx.Err(), context.Canceled)
	require.NoError(t, <-upstreamContext)
	assert.Equal(t, []int{113}, settlement.settled)
	assert.False(t, settlement.refunded)
	assert.Equal(t, "\n", writer.Body.String(), "heartbeat was flushed before the final response")
}

func deepSeekTTSContext(t *testing.T, writer http.ResponseWriter, body, baseURL string) *gin.Context {
	t.Helper()
	c := deepSeekOCRContext(t, writer, []byte(body), "application/json", baseURL)
	c.Request.URL.Path = "/v1/tools/tts"
	common.SetContextKey(c, constant.ContextKeyOriginalModel, constant.DeepSeekTTSModel)
	return c
}

func TestDeepSeekTTS(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })
	settings := config.GlobalConfig.Get("billing_setting").(*billing_setting.BillingSetting)
	saved := *settings
	savedPrices := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() {
		*settings = saved
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices))
	})
	const defaultBody = `{"text":"你好 A🙂","voice_id":"stella","format":"pcm","filter_markdown":false,"character_count":10000}`
	const audio = "\x01\x00\x00\xffaudio\x00"
	for _, tt := range []struct {
		name, expression, prices, response, contentType string
		body, billingBody                               string
		status, quota                                   int
		wantError                                       bool
	}{
		{name: "weighted characters ignore token estimation and client quantity", quota: 79, response: audio},
		{name: "text alone preserves provider defaults", body: `{"text":"你好 A🙂"}`, billingBody: `{}`, quota: 79, response: audio},
		{name: "alternate voice", body: `{"text":"你好 A🙂","voice_id":"tide"}`, billingBody: `{"voice_id":"tide"}`, quota: 79, response: audio},
		{name: "custom character price", expression: `tier("character", fixed(0.001)) * character_count`, quota: 3500, response: audio},
		{name: "custom request price", expression: `tier("request", fixed(0.01))`, quota: 5000, response: audio},
		{name: "explicit free expression", expression: `tier("character", fixed(0)) * character_count`, response: audio},
		{name: "legacy request override", prices: `{"deepseek-tts":0.01}`, quota: 5000, response: audio},
		{name: "legacy free override", prices: `{"deepseek-tts":0}`, response: audio},
		{name: "empty audio refunds", wantError: true},
		{name: "HTTP rejection refunds", status: 400, contentType: "application/json", response: `{"error":{"message":"invalid voice","type":"invalid_request_error"}}`, wantError: true},
		{name: "HTTP 200 JSON error refunds", contentType: "application/json", response: `{"error":{"message":"synthesis failed","type":"server_error"}}`, wantError: true},
		{name: "non-audio response refunds", contentType: "text/plain", response: "synthesis failed", wantError: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			body := tt.body
			if body == "" {
				body = defaultBody
			}
			billingBody := tt.billingBody
			if billingBody == "" {
				billingBody = `{"voice_id":"stella","format":"pcm","filter_markdown":false}`
			}
			*settings = billing_setting.BillingSetting{BillingMode: map[string]string{}, BillingExpr: map[string]string{}}
			if tt.expression != "" {
				settings.BillingMode[constant.DeepSeekTTSModel] = billing_setting.BillingModeTieredExpr
				settings.BillingExpr[constant.DeepSeekTTSModel] = tt.expression
			}
			prices := tt.prices
			if prices == "" {
				prices = `{}`
			}
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(prices))
			var gotBody []byte
			var gotPath, gotAuth string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath, gotAuth = r.URL.Path, r.Header.Get("Authorization")
				gotBody, _ = io.ReadAll(r.Body)
				contentType := tt.contentType
				if contentType == "" {
					contentType = "audio/pcm"
				}
				w.Header().Set("Content-Type", contentType)
				w.Header().Set("Content-Disposition", `attachment; filename="speech.pcm"`)
				if tt.status != 0 {
					w.WriteHeader(tt.status)
				}
				_, _ = io.WriteString(w, tt.response)
			}))
			t.Cleanup(upstream.Close)
			recorder := httptest.NewRecorder()
			c := deepSeekTTSContext(t, recorder, body, upstream.URL)
			request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
			require.NoError(t, err)
			assert.Empty(t, request.GetTokenCountMeta().CombineText)
			tts := request.(*dto.DeepSeekTTSRequest)
			assert.Equal(t, 7, tts.CharacterCount)
			if tt.body == "" {
				require.NotNil(t, tts.FilterMarkdown)
				assert.False(t, *tts.FilterMarkdown)
			}
			info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
			require.NoError(t, err)
			price, err := helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
			require.NoError(t, err)
			if !tt.wantError {
				assert.Equal(t, tt.quota, price.QuotaToPreConsume)
			}
			if info.BillingRequestInput != nil {
				assert.JSONEq(t, billingBody, string(info.BillingRequestInput.Body))
			}
			settlement := &recordedSettlement{}
			info.Billing = settlement
			apiErr := RefundFailedRequestBilling(c, info, DeepSeekTTSHelper(c, info))
			assert.Equal(t, "/v1/tools/tts", gotPath)
			assert.Equal(t, "Bearer sk-test", gotAuth)
			assert.Equal(t, body, string(gotBody))
			if tt.wantError {
				require.NotNil(t, apiErr)
				assert.True(t, types.IsSkipRetryError(apiErr))
				assert.True(t, settlement.refunded)
				assert.Empty(t, settlement.settled)
				assert.Empty(t, recorder.Body.String())
				return
			}
			require.Nil(t, apiErr)
			assert.Equal(t, []int{tt.quota}, settlement.settled)
			assert.False(t, settlement.refunded)
			assert.Equal(t, audio, recorder.Body.String())
			assert.True(t, recorder.Flushed)
			assert.Equal(t, "audio/pcm", recorder.Header().Get("Content-Type"))
			assert.Equal(t, `attachment; filename="speech.pcm"`, recorder.Header().Get("Content-Disposition"))
			other := service.GenerateTextOtherInfo(c, info, 0, 1, 0, 0, 0, info.PriceData.ModelPrice, -1)
			assert.Equal(t, 7, other.Snapshot()["character_count"])
			if info.TieredBillingSnapshot != nil {
				ok, quota, result := service.TryTieredSettle(info, billingexpr.TokenParams{P: 1e12, C: 1e12})
				require.True(t, ok)
				assert.Equal(t, tt.quota, quota)
				service.InjectTieredBillingInfo(other, info, result)
				assert.Equal(t, 7, other.Snapshot()["character_count"])
			}
		})
	}
}

func TestDeepSeekTTSValidation(t *testing.T) {
	for _, tt := range []struct {
		name, body string
		count      int
		invalid    bool
	}{
		{name: "missing text", body: `{"voice_id":"stella"}`, invalid: true},
		{name: "whitespace", body: `{"text":"  ","voice_id":"stella"}`, invalid: true},
		{name: "missing voice", body: `{"text":"hello"}`, count: 5},
		{name: "empty voice", body: `{"text":"hello","voice_id":""}`, invalid: true},
		{name: "unsupported voice", body: `{"text":"hello","voice_id":"unknown"}`, invalid: true},
		{name: "wrong voice type", body: `{"text":"hello","voice_id":1}`, invalid: true},
		{name: "documented maximum characters", body: `{"text":"` + strings.Repeat("a", 10000) + `"}`, count: 10000},
		{name: "documented maximum request body", body: `{"text":"hello"}` + strings.Repeat(" ", (64<<10)-len(`{"text":"hello"}`)), count: 5},
		{name: "oversized request body", body: `{"text":"hello","voice_id":"stella"}` + strings.Repeat(" ", 64<<10), invalid: true},
		{name: "unsupported format", body: `{"text":"hello","voice_id":"stella","format":"mp3"}`, invalid: true},
		{name: "wrong boolean type", body: `{"text":"hello","voice_id":"stella","filter_markdown":"false"}`, invalid: true},
		{name: "default options", body: `{"text":"hello","voice_id":"stella"}`, count: 5},
		{name: "Han extension and emoji", body: `{"text":"𠀀🙂","voice_id":"stella","format":"wav"}`, count: 3},
		{name: "maximum Latin", body: `{"text":"` + strings.Repeat("a", dto.MaxTTSCharacters) + `","voice_id":"stella"}`, count: dto.MaxTTSCharacters},
		{name: "maximum Han", body: `{"text":"` + strings.Repeat("中", dto.MaxTTSCharacters/2) + `","voice_id":"stella"}`, count: dto.MaxTTSCharacters},
		{name: "too many Latin", body: `{"text":"` + strings.Repeat("a", dto.MaxTTSCharacters+1) + `","voice_id":"stella"}`, invalid: true},
		{name: "too many Han", body: `{"text":"` + strings.Repeat("中", dto.MaxTTSCharacters/2+1) + `","voice_id":"stella"}`, invalid: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c := deepSeekTTSContext(t, httptest.NewRecorder(), tt.body, "http://unused")
			request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
			if tt.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.count, request.(*dto.DeepSeekTTSRequest).CharacterCount)
		})
	}
	t.Run("billing expression bounds", func(t *testing.T) {
		expression, ok := billing_setting.GetBillingExpr(constant.DeepSeekTTSModel)
		require.True(t, ok)
		assert.True(t, billingexpr.UsesChatQuantities(expression), "task pricing must reject TTS character quantities")
		for _, count := range []int{0, -1, 1, dto.MaxTTSCharacters, dto.MaxTTSCharacters + 1} {
			cost, trace, err := billingexpr.RunExprWithRequest(expression, billingexpr.TokenParams{}, billingexpr.RequestInput{CharacterCount: &count})
			if count < 1 || count > dto.MaxTTSCharacters {
				require.ErrorContains(t, err, "character_count")
				continue
			}
			require.NoError(t, err)
			assert.InDelta(t, float64(count)*22.5, cost, 1e-9)
			assert.Equal(t, &count, trace.CharacterCount)
		}
	})
}

func TestDeepSeekTTSSettlesAfterClientDisconnect(t *testing.T) {
	service.InitHttpClient()
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })
	firstChunk := make(chan struct{})
	upstreamContext := make(chan error, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = io.WriteString(w, "RIFF")
		w.(http.Flusher).Flush()
		select {
		case <-firstChunk:
			upstreamContext <- r.Context().Err()
			_, _ = io.WriteString(w, "audio after disconnect")
		case <-r.Context().Done():
			upstreamContext <- r.Context().Err()
		}
	}))
	t.Cleanup(upstream.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	writer := &ocrDisconnectWriter{ResponseRecorder: httptest.NewRecorder(), onHeartbeat: func() { cancel(); close(firstChunk) }}
	c := deepSeekTTSContext(t, writer, `{"text":"你好 A🙂","voice_id":"stella"}`, upstream.URL)
	c.Request = c.Request.WithContext(ctx)
	request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
	require.NoError(t, err)
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
	require.NoError(t, err)
	_, err = helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
	require.NoError(t, err)
	settlement := &recordedSettlement{}
	info.Billing = settlement
	require.Nil(t, DeepSeekTTSHelper(c, info))
	require.ErrorIs(t, ctx.Err(), context.Canceled)
	require.NoError(t, <-upstreamContext)
	assert.Equal(t, []int{79}, settlement.settled)
	assert.False(t, settlement.refunded)
	assert.Equal(t, "RIFF", writer.Body.String())
}

func TestDeepSeekTTSRejectsInvalidOverrideBeforeSubmission(t *testing.T) {
	for _, tt := range []struct {
		name, field, value, message string
	}{
		{name: "text changes", field: "text", value: "a changed billing quantity", message: "text cannot change after billing reservation"},
		{name: "oversized body", field: "extra", value: strings.Repeat("a", dto.MaxTTSRequestSize), message: "request body must be at most 64 KiB"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c := deepSeekTTSContext(t, httptest.NewRecorder(), `{"text":"hello"}`, "http://unused")
			common.SetContextKey(c, constant.ContextKeyChannelParamOverride, map[string]any{tt.field: tt.value})
			request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
			require.NoError(t, err)
			info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
			require.NoError(t, err)
			_, err = helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
			require.NoError(t, err)
			settlement := &recordedSettlement{}
			info.Billing = settlement
			apiErr := RefundFailedRequestBilling(c, info, DeepSeekTTSHelper(c, info))
			require.NotNil(t, apiErr)
			assert.Contains(t, apiErr.Error(), tt.message)
			assert.True(t, settlement.refunded)
			assert.Empty(t, settlement.settled)
		})
	}
}

func TestDeepSeekTTSInterruptedAudioKeepsCharacterCharge(t *testing.T) {
	service.InitHttpClient()
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "audio/wav")
		w.Header().Set("Content-Length", "1024")
		_, _ = io.WriteString(w, "RIFF")
	}))
	t.Cleanup(upstream.Close)
	recorder := httptest.NewRecorder()
	c := deepSeekTTSContext(t, recorder, `{"text":"hello","voice_id":"stella"}`, upstream.URL)
	request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
	require.NoError(t, err)
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
	require.NoError(t, err)
	_, err = helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
	require.NoError(t, err)
	settlement := &recordedSettlement{}
	info.Billing = settlement
	require.Nil(t, DeepSeekTTSHelper(c, info))
	assert.Equal(t, "RIFF", recorder.Body.String(), "do not append JSON to interrupted audio")
	assert.Equal(t, []int{56}, settlement.settled)
	assert.False(t, settlement.refunded)
}

func TestDeepSeekASRSettlesAfterClientDisconnect(t *testing.T) {
	service.InitHttpClient()
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	upstreamContext := make(chan error, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		cancel()
		upstreamContext <- r.Context().Err()
		_, _ = io.WriteString(w, `{"request_id":"req","text":"hello","duration_ms":3200}`)
	}))
	t.Cleanup(upstream.Close)
	writer := &ocrDisconnectWriter{ResponseRecorder: httptest.NewRecorder(), disconnected: true}
	c, _ := deepSeekASRContext(t, writer, deepSeekASRWAV(1), upstream.URL)
	c.Request = c.Request.WithContext(ctx)
	request, err := helper.GetAndValidateRequest(c, types.RelayFormatDeepSeekTools)
	require.NoError(t, err)
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatDeepSeekTools, request, nil)
	require.NoError(t, err)
	_, err = helper.ModelPriceHelper(c, info, 0, request.GetTokenCountMeta())
	require.NoError(t, err)
	settlement := &recordedSettlement{}
	info.Billing = settlement
	require.Nil(t, DeepSeekFileHelper(c, info))
	require.ErrorIs(t, ctx.Err(), context.Canceled)
	require.NoError(t, <-upstreamContext)
	assert.Equal(t, []int{32}, settlement.settled)
	assert.False(t, settlement.refunded)
	assert.Empty(t, writer.Body.String())
}
