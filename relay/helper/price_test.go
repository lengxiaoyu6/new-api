package helper

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestModelPriceHelperTieredUsesPreloadedRequestInput(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{"tiered-test-model":"tiered_expr"}`,
		"billing_setting.billing_expr": `{"tiered-test-model":"param(\"stream\") == true ? tier(\"stream\", p * 3) : tier(\"base\", p * 2)"}`,
	}))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(http.MethodPost, "/api/channel/test/1", nil)
	req.Body = nil
	req.ContentLength = 0
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req
	ctx.Set("group", "default")

	info := &relaycommon.RelayInfo{
		OriginModelName: "tiered-test-model",
		UserGroup:       "default",
		UsingGroup:      "default",
		RequestHeaders:  map[string]string{"Content-Type": "application/json"},
		BillingRequestInput: &billingexpr.RequestInput{
			Headers: map[string]string{"Content-Type": "application/json"},
			Body:    []byte(`{"stream":true}`),
		},
	}

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{
		BillingRatios: map[string]float64{"n": 3},
	})
	require.NoError(t, err)
	require.Equal(t, 1500, priceData.QuotaToPreConsume)
	require.NotNil(t, info.TieredBillingSnapshot)
	require.Equal(t, "stream", info.TieredBillingSnapshot.EstimatedTier)
	require.Equal(t, billing_setting.BillingModeTieredExpr, info.TieredBillingSnapshot.BillingMode)
	require.Equal(t, common.QuotaPerUnit, info.TieredBillingSnapshot.QuotaPerUnit)
}

func TestFixedPricePreConsumeAndRealtimeRejection(t *testing.T) {
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(saved)) })
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"fixed-test":"tiered_expr"}`,
		"billing_setting.billing_expr":    `{"fixed-test":"len <= 32000 ? tier(\"short\", fixed(0.01)) : tier(\"long\", p * 2)"}`,
		"group_ratio_setting.group_ratio": `{"default":1.5}`,
	}))
	for _, tc := range []struct {
		name      string
		format    types.RelayFormat
		prompt    int
		wantError bool
	}{
		{"HTTP charges once", types.RelayFormatOpenAI, 0, false},
		{"Realtime rejects even unselected fixed branch", types.RelayFormatOpenAIRealtime, 50000, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			info := &relaycommon.RelayInfo{OriginModelName: "fixed-test", UserGroup: "default", UsingGroup: "default", RelayFormat: tc.format, BillingRequestInput: &billingexpr.RequestInput{}}
			price, err := ModelPriceHelper(ctx, info, tc.prompt, &types.TokenCountMeta{})
			if tc.wantError {
				require.ErrorContains(t, err, "Realtime")
				assert.Nil(t, info.TieredBillingSnapshot)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, 7500, price.QuotaToPreConsume)
			require.NotNil(t, info.TieredBillingSnapshot)
			assert.Equal(t, billingexpr.BillingUnitRequest, info.TieredBillingSnapshot.EstimatedBillingUnit)
			require.NotNil(t, info.TieredBillingSnapshot.EstimatedFixedPrice)
			assert.Equal(t, 0.01, *info.TieredBillingSnapshot.EstimatedFixedPrice)
		})
	}
}

func TestModelPriceHelperTieredInputPreConsumeMultiplier(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"tiered-fallback-model":"tiered_expr"}`,
		"billing_setting.billing_expr":    `{"tiered-fallback-model":"len <= 1200 ? tier(\"base\", p * 3 + c * 15) : tier(\"long\", p * 30 + c * 150)"}`,
		"group_ratio_setting.group_ratio": `{"default":1,"free":0}`,
	}))

	cases := []struct {
		name       string
		group      string
		prompt     int
		maxTokens  int
		multiplier float64
		expected   int
	}{
		{"default uses only input", "default", 1000, 0, 1, 1500},
		{"explicit output limit does not increase reservation", "default", 1000, 100, 1, 1500},
		{"fraction below one", "default", 1000, 0, 0.5, 750},
		{"fraction above one preserves context tier", "default", 1000, 0, 2.5, 3750},
		{"small input has no token floor", "default", 100, 0, 1, 150},
		{"zero input", "default", 0, 100, 1, 0},
		{"free group", "free", 1000, 0, 2.5, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			req.Header.Set("Content-Type", "application/json")
			ctx.Request = req
			ctx.Set("group", tc.group)

			info := &relaycommon.RelayInfo{
				OriginModelName: "tiered-fallback-model",
				UserGroup:       tc.group,
				UsingGroup:      tc.group,
				RequestHeaders:  map[string]string{"Content-Type": "application/json"},
				BillingRequestInput: &billingexpr.RequestInput{
					Headers: map[string]string{"Content-Type": "application/json"},
					Body:    []byte(`{}`),
				},
			}

			operation_setting.GetQuotaSetting().PreConsumeMultiplier = tc.multiplier
			priceData, err := ModelPriceHelper(ctx, info, tc.prompt, &types.TokenCountMeta{MaxTokens: tc.maxTokens})
			require.NoError(t, err)
			assert.Equal(t, tc.expected, priceData.QuotaToPreConsume)
			require.NotNil(t, info.TieredBillingSnapshot)
			actual, err := billingexpr.ComputeTieredQuotaWithRequest(info.TieredBillingSnapshot, billingexpr.TokenParams{P: 1000, C: 100, Len: 1000}, *info.BillingRequestInput)
			require.NoError(t, err)
			wantActual := 2250
			if tc.group == "free" {
				wantActual = 0
			}
			assert.Equal(t, wantActual, actual.ActualQuotaAfterGroup, "reservation multiplier must not change settlement")
		})
	}
}

func TestModelPriceHelperTieredRejectsPreConsumeOverflow(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"tiered-overflow-model":"tiered_expr"}`,
		"billing_setting.billing_expr":    `{"tiered-overflow-model":"tier(\"overflow\", p * 100000000000000000)"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Set("group", "default")
	info := &relaycommon.RelayInfo{
		OriginModelName: "tiered-overflow-model",
		UserGroup:       "default",
		UsingGroup:      "default",
		BillingRequestInput: &billingexpr.RequestInput{
			Body: []byte(`{}`),
		},
	}

	_, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})

	var clamp *common.QuotaClamp
	require.ErrorAs(t, err, &clamp)
	require.Equal(t, "QuotaRound", clamp.Op)
	require.Equal(t, common.QuotaClampOverflow, clamp.Kind)
}

func TestModelPriceHelperRequestBillingRatiosOnlyApplyToFixedPrice(t *testing.T) {
	gin.SetMode(gin.TestMode)
	savedModelPrices := ratio_setting.ModelPrice2JSONString()
	savedModelRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedModelPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedModelRatios))
	})

	modelPrices, err := common.Marshal(map[string]float64{
		"fixed-image-price":      0.04,
		"fractional-image-price": 0.0000012,
		"overflow-image-price":   float64(common.MaxQuota) / common.QuotaPerUnit / 2,
	})
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(string(modelPrices)))
	modelRatios, err := common.Marshal(map[string]float64{"ratio-image-price": 15})
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(modelRatios)))

	tests := []struct {
		name           string
		model          string
		wantQuota      int
		wantUsePrice   bool
		wantImageCount bool
	}{
		{
			name:           "fixed price applies image count",
			model:          "fixed-image-price",
			wantQuota:      180000,
			wantUsePrice:   true,
			wantImageCount: true,
		},
		{
			name:         "ratio price ignores request billing ratios",
			model:        "ratio-image-price",
			wantQuota:    15000,
			wantUsePrice: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Set("group", "default")
			info := &relaycommon.RelayInfo{
				OriginModelName: tt.model,
				UserGroup:       "default",
				UsingGroup:      "default",
			}
			meta := &types.TokenCountMeta{
				ImagePriceRatio: 3,
				BillingRatios:   map[string]float64{"n": 3},
			}

			priceData, err := ModelPriceHelper(ctx, info, 1000, meta)

			require.NoError(t, err)
			require.Equal(t, tt.wantQuota, priceData.QuotaToPreConsume)
			require.Equal(t, tt.wantUsePrice, priceData.UsePrice)
			require.Equal(t, tt.wantImageCount, priceData.HasOtherRatio("n"))
			require.Equal(t, priceData.OtherRatios(), info.PriceData.OtherRatios())
		})
	}

	newInfo := func(model string) (*gin.Context, *relaycommon.RelayInfo) {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Set("group", "default")
		return ctx, &relaycommon.RelayInfo{
			OriginModelName: model,
			UserGroup:       "default",
			UsingGroup:      "default",
		}
	}
	meta := &types.TokenCountMeta{BillingRatios: map[string]float64{"n": 3}}

	ctx, info := newInfo("fractional-image-price")
	priceData, err := ModelPriceHelper(ctx, info, 0, meta)
	require.NoError(t, err)
	// 0.0000012 * 500000 * 3 = 1.8, then truncate once to 1.
	require.Equal(t, 1, priceData.QuotaToPreConsume)

	ctx, info = newInfo("overflow-image-price")
	_, err = ModelPriceHelper(ctx, info, 0, meta)
	var clamp *common.QuotaClamp
	require.ErrorAs(t, err, &clamp)
	require.Equal(t, "QuotaFromFloat", clamp.Op)
	require.Equal(t, common.QuotaClampOverflow, clamp.Kind)
	require.Nil(t, info.Billing)
}

// Pricing identity is resolved once in ModelPriceHelper via the candidate
// ladder: raw name (only when it has no @ modifiers) → canonical
// base@effort:E@thinking:S → base@thinking:S → base. Each level is looked up
// after FormatMatchingModelName wildcard normalization. A hit on the raw
// gemini-2.5-flash-thinking-* wildcard must keep the client origin as the
// consume-log name.
func TestModelPriceHelperUsesSuffixedOriginLikeMain(t *testing.T) {
	gin.SetMode(gin.TestMode)

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	ratios := ratio_setting.GetModelRatioCopy()
	ratios["gemini-2.5-flash"] = 0.15
	ratios["gemini-2.5-flash-thinking-*"] = 0.075
	ratioJSON, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = true
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")

	suffixed := &relaycommon.RelayInfo{
		OriginModelName: "gemini-2.5-flash-thinking-8192",
		UserGroup:       "default",
		UsingGroup:      "default",
	}
	suffixedPrice, err := ModelPriceHelper(ctx, suffixed, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Empty(t, suffixed.BillingModelName)
	assert.Equal(t, "gemini-2.5-flash-thinking-8192", suffixed.GetBillingModelName())
	assert.Equal(t, 0.075, suffixedPrice.ModelRatio)

	geminiSettings := model_setting.GetGeminiSettings()
	oldThinking := geminiSettings.ThinkingAdapterEnabled
	geminiSettings.ThinkingAdapterEnabled = true
	t.Cleanup(func() { geminiSettings.ThinkingAdapterEnabled = oldThinking })

	adapterOn := &relaycommon.RelayInfo{
		OriginModelName: "gemini-2.5-flash-thinking-8192",
		UserGroup:       "default",
		UsingGroup:      "default",
	}
	adapterOnPrice, err := ModelPriceHelper(ctx, adapterOn, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Empty(t, adapterOn.BillingModelName)
	assert.Equal(t, "gemini-2.5-flash-thinking-8192", adapterOn.GetBillingModelName())
	assert.Equal(t, 0.075, adapterOnPrice.ModelRatio)

	base := &relaycommon.RelayInfo{
		OriginModelName: "gemini-2.5-flash",
		UserGroup:       "default",
		UsingGroup:      "default",
	}
	basePrice, err := ModelPriceHelper(ctx, base, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Empty(t, base.BillingModelName)
	assert.Equal(t, "gemini-2.5-flash", base.GetBillingModelName())
	assert.Equal(t, 0.15, basePrice.ModelRatio)
}

func TestModelPriceHelperHonorsCustomClaudeThinkingAlias(t *testing.T) {
	gin.SetMode(gin.TestMode)

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	ratios := ratio_setting.GetModelRatioCopy()
	ratios["claude-3-7-sonnet"] = 1.5
	ratios["claude-3-7-sonnet-thinking"] = 3.0
	ratioJSON, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	claudeSettings := model_setting.GetClaudeSettings()
	oldThinking := claudeSettings.ThinkingAdapterEnabled
	claudeSettings.ThinkingAdapterEnabled = true
	t.Cleanup(func() { claudeSettings.ThinkingAdapterEnabled = oldThinking })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")
	info := &relaycommon.RelayInfo{
		OriginModelName: "claude-3-7-sonnet-thinking",
		UserGroup:       "default",
		UsingGroup:      "default",
	}
	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Empty(t, info.BillingModelName)
	assert.Equal(t, "claude-3-7-sonnet-thinking", info.GetBillingModelName())
	assert.Equal(t, 3.0, priceData.ModelRatio)
}

func TestModelPriceHelperCanonicalBillingLadder(t *testing.T) {
	gin.SetMode(gin.TestMode)

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")

	t.Run("level2 full form", func(t *testing.T) {
		ratios := ratio_setting.GetModelRatioCopy()
		delete(ratios, "qwen3-max")
		ratios["qwen3-max@effort:high@thinking:on"] = 4.0
		ratios["qwen3-max@thinking:on"] = 3.0
		ratioJSON, err := common.Marshal(ratios)
		require.NoError(t, err)
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

		info := &relaycommon.RelayInfo{
			OriginModelName: "qwen3-max@thinking:on@effort:high@temperature:0.2",
			UserGroup:       "default",
			UsingGroup:      "default",
		}
		priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
		require.NoError(t, err)
		assert.Equal(t, "qwen3-max@effort:high@thinking:on", info.BillingModelName)
		assert.Equal(t, 4.0, priceData.ModelRatio)
	})

	t.Run("level3 thinking form shuffled budget", func(t *testing.T) {
		ratios := ratio_setting.GetModelRatioCopy()
		delete(ratios, "qwen3-max")
		delete(ratios, "qwen3-max@effort:high@thinking:on")
		ratios["qwen3-max@thinking:on"] = 3.0
		ratioJSON, err := common.Marshal(ratios)
		require.NoError(t, err)
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

		info := &relaycommon.RelayInfo{
			OriginModelName: "qwen3-max@temperature:0.3@thinking:8192",
			UserGroup:       "default",
			UsingGroup:      "default",
		}
		priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
		require.NoError(t, err)
		assert.Equal(t, "qwen3-max@thinking:on", info.BillingModelName)
		assert.Equal(t, 3.0, priceData.ModelRatio)
	})

	t.Run("level4 base fallback", func(t *testing.T) {
		ratios := ratio_setting.GetModelRatioCopy()
		delete(ratios, "qwen3-max@thinking:on")
		delete(ratios, "qwen3-max@effort:high@thinking:on")
		ratios["qwen3-max"] = 1.25
		ratioJSON, err := common.Marshal(ratios)
		require.NoError(t, err)
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

		info := &relaycommon.RelayInfo{
			OriginModelName: "qwen3-max@thinking:off",
			UserGroup:       "default",
			UsingGroup:      "default",
		}
		priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
		require.NoError(t, err)
		assert.Equal(t, "qwen3-max", info.BillingModelName)
		assert.Equal(t, 1.25, priceData.ModelRatio)
	})

	t.Run("thinking minus one bills as on", func(t *testing.T) {
		ratios := ratio_setting.GetModelRatioCopy()
		ratios["qwen3-max@thinking:on"] = 3.0
		ratioJSON, err := common.Marshal(ratios)
		require.NoError(t, err)
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

		info := &relaycommon.RelayInfo{
			OriginModelName: "qwen3-max@thinking:-1",
			UserGroup:       "default",
			UsingGroup:      "default",
		}
		priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
		require.NoError(t, err)
		assert.Equal(t, "qwen3-max@thinking:on", info.BillingModelName)
		assert.Equal(t, 3.0, priceData.ModelRatio)
	})
}

func TestModelPriceHelperMigratesLegacyGeminiWildcardToCanonical(t *testing.T) {
	gin.SetMode(gin.TestMode)

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	ratios := ratio_setting.GetModelRatioCopy()
	delete(ratios, "gemini-2.5-flash-thinking-*")
	ratios["gemini-2.5-flash"] = 0.15
	ratios["gemini-2.5-flash@thinking:on"] = 0.09
	ratioJSON, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	geminiSettings := model_setting.GetGeminiSettings()
	oldThinking := geminiSettings.ThinkingAdapterEnabled
	geminiSettings.ThinkingAdapterEnabled = true
	t.Cleanup(func() { geminiSettings.ThinkingAdapterEnabled = oldThinking })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")
	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-2.5-flash-thinking-8192",
		UserGroup:       "default",
		UsingGroup:      "default",
	}
	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Equal(t, "gemini-2.5-flash@thinking:on", info.BillingModelName)
	assert.Equal(t, 0.09, priceData.ModelRatio)
}

func TestModelPriceHelperModifierNameFallsBackToBase(t *testing.T) {
	gin.SetMode(gin.TestMode)

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	ratios := ratio_setting.GetModelRatioCopy()
	ratios["qwen3.8-max"] = 2.0
	ratioJSON, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")
	info := &relaycommon.RelayInfo{
		OriginModelName: "qwen3.8-max@thinking:on@temperature:0.2",
		UserGroup:       "default",
		UsingGroup:      "default",
	}
	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Equal(t, "qwen3.8-max", info.BillingModelName)
	assert.Equal(t, 2.0, priceData.ModelRatio)
}

func TestModelPriceHelperExemptAtNameBillsVerbatim(t *testing.T) {
	gin.SetMode(gin.TestMode)

	settings := model_setting.GetGlobalSettings()
	originalBlacklist := append([]string(nil), settings.ThinkingModelBlacklist...)
	t.Cleanup(func() { settings.ThinkingModelBlacklist = originalBlacklist })
	settings.ThinkingModelBlacklist = append(originalBlacklist, "re:.*@sha256:.*")

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	ratios := ratio_setting.GetModelRatioCopy()
	ratios["opaque"] = 1.0
	ratios["opaque@sha256:deadbeef"] = 7.0
	ratioJSON, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")
	info := &relaycommon.RelayInfo{
		OriginModelName: "opaque@sha256:deadbeef",
		UserGroup:       "default",
		UsingGroup:      "default",
	}
	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Empty(t, info.BillingModelName)
	assert.Equal(t, "opaque@sha256:deadbeef", info.GetBillingModelName())
	assert.Equal(t, 7.0, priceData.ModelRatio)
}

func TestModelPriceHelperPreservesGpt51CodexMaxIdentity(t *testing.T) {
	gin.SetMode(gin.TestMode)

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	ratios := ratio_setting.GetModelRatioCopy()
	ratios["gpt-5.1-codex-max"] = 1.75
	ratios["gpt-5.1-codex"] = 9.9
	ratioJSON, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1-codex-max",
		UserGroup:       "default",
		UsingGroup:      "default",
	}
	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Empty(t, info.BillingModelName)
	assert.Equal(t, "gpt-5.1-codex-max", info.GetBillingModelName())
	assert.Equal(t, 1.75, priceData.ModelRatio)
}

// DeepSeek thinking tails and @ modifiers bill at the base model's built-in
// expression; a name on the thinking-suffix blacklist stays opaque and needs
// its own price.
func TestModelPriceHelperDeepSeekThinkingTailsBillAtBase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(saved)) })
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{}`,
		"billing_setting.billing_expr": `{}`,
	}))
	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })
	settings := model_setting.GetGlobalSettings()
	originalBlacklist := append([]string(nil), settings.ThinkingModelBlacklist...)
	t.Cleanup(func() { settings.ThinkingModelBlacklist = originalBlacklist })
	settings.ThinkingModelBlacklist = append(originalBlacklist, "deepseek-v4-pro-max")

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Set("group", "default")
	for origin, base := range map[string]string{
		"deepseek-flash-none":           "deepseek-flash",
		"deepseek-flash-low":            "deepseek-flash",
		"deepseek-flash-max":            "deepseek-flash",
		"deepseek-v4-pro-low":           "deepseek-v4-pro",
		"deepseek-flash@effort:max":     "deepseek-flash",
		"deepseek-flash-max@effort:low": "deepseek-flash",
		"deepseek-v4-pro@thinking:off":  "deepseek-v4-pro",
	} {
		info := &relaycommon.RelayInfo{
			OriginModelName: origin, UserGroup: "default", UsingGroup: "default",
			BillingRequestInput: &billingexpr.RequestInput{Body: []byte(`{}`)},
		}
		_, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
		require.NoError(t, err, origin)
		assert.Equal(t, base, info.BillingModelName, origin)
		expression, _ := billing_setting.GetBuiltinBillingExpr(base)
		require.NotNil(t, info.TieredBillingSnapshot, origin)
		assert.Equal(t, expression, info.TieredBillingSnapshot.ExprString, origin)
	}

	info := &relaycommon.RelayInfo{OriginModelName: "deepseek-v4-pro-max", UserGroup: "default", UsingGroup: "default"}
	_, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.Error(t, err)
	assert.Equal(t, "deepseek-v4-pro-max", info.GetBillingModelName())
}

func TestModelPriceHelperNativeGeminiNoThinkingDoesNotAliasBillingModel(t *testing.T) {
	gin.SetMode(gin.TestMode)

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	ratios := ratio_setting.GetModelRatioCopy()
	ratios["gemini-3-pro"] = 1.25
	ratioJSON, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = true
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	geminiSettings := model_setting.GetGeminiSettings()
	oldThinking := geminiSettings.ThinkingAdapterEnabled
	geminiSettings.ThinkingAdapterEnabled = true
	t.Cleanup(func() { geminiSettings.ThinkingAdapterEnabled = oldThinking })

	budget := 0
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("group", "default")
	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-pro",
		UserGroup:       "default",
		UsingGroup:      "default",
		Request: &dto.GeminiChatRequest{
			GenerationConfig: dto.GeminiChatGenerationConfig{
				ThinkingConfig: &dto.GeminiThinkingConfig{
					ThinkingBudget: &budget,
				},
			},
		},
	}

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.Empty(t, info.BillingModelName)
	assert.Equal(t, "gemini-3-pro", info.GetBillingModelName())
	assert.Equal(t, 1.25, priceData.ModelRatio)
	assert.NotEqual(t, 37.5, priceData.ModelRatio)
}

func TestInputPreConsumeMultiplierLegacyAndRequestPrices(t *testing.T) {
	previous := config.GlobalConfig.ExportAllConfigs()
	previousRatios, previousPrices := ratio_setting.ModelRatio2JSONString(), ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(previous))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios))
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(previousPrices))
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"legacy-input-policy":1.5}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"request-input-policy":0.01}`))
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"fixed-input-policy":"tiered_expr","image-input-policy":"tiered_expr"}`,
		"billing_setting.billing_expr":    `{"fixed-input-policy":"tier(\"request\", fixed(0.01))","image-input-policy":"tier(\"image\", p * 3) * image_count"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))
	for _, tc := range []struct {
		model        string
		multiplier   float64
		prompt, want int
	}{
		{"legacy-input-policy", 0.5, 100, 75},
		{"legacy-input-policy", 2.5, 100, 375},
		{"legacy-input-policy", 1, 0, 0},
		{"request-input-policy", 2.5, 100, 5000},
		{"fixed-input-policy", 2.5, 100, 5000},
		{"image-input-policy", 2.5, 100, 375},
	} {
		t.Run(tc.model+"/"+fmt.Sprint(tc.multiplier, "/", tc.prompt), func(t *testing.T) {
			operation_setting.GetQuotaSetting().PreConsumeMultiplier = tc.multiplier
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			info := &relaycommon.RelayInfo{OriginModelName: tc.model, UserGroup: "default", UsingGroup: "default", BillingRequestInput: &billingexpr.RequestInput{}}
			price, err := ModelPriceHelper(ctx, info, tc.prompt, &types.TokenCountMeta{MaxTokens: 10000})
			require.NoError(t, err)
			assert.Equal(t, tc.want, price.QuotaToPreConsume)
			if tc.model == "image-input-policy" {
				reservation := &priceTestReservation{held: price.QuotaToPreConsume}
				info.Billing = reservation
				operation_setting.GetQuotaSetting().PreConsumeMultiplier = 10
				require.Nil(t, service.PrepareImageBillingForRequest(ctx, info, 2))
				assert.Equal(t, 750, reservation.held, "retry must reuse the original fractional multiplier")
			}
		})
	}
}

// priceTestReservation observes the reservation requested before image submission.
type priceTestReservation struct{ held int }

func (s *priceTestReservation) Settle(int) error         { return nil }
func (s *priceTestReservation) Refund(*gin.Context)      {}
func (s *priceTestReservation) NeedsRefund() bool        { return false }
func (s *priceTestReservation) GetPreConsumedQuota() int { return s.held }
func (s *priceTestReservation) Reserve(quota int) error  { s.held = max(s.held, quota); return nil }

func (s *priceTestReservation) ReserveBeforeSubmit(quota int) error { return s.Reserve(quota) }

func TestSubscriptionChannelAccounting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	oldRedis, oldBatch, oldConsumeLog := common.RedisEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.RedisEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = false, false, true
	t.Cleanup(func() {
		common.RedisEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = oldRedis, oldBatch, oldConsumeLog
	})
	oldGroupRatios := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldGroupRatios)) })
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"subscription-channel-retry":0.5}`))

	for _, dialect := range []struct {
		name   common.DatabaseType
		env    string
		logEnv string
	}{
		{common.DatabaseTypeSQLite, "", ""},
		{common.DatabaseTypeMySQL, "TEST_SUBSCRIPTION_MYSQL_DSN", "TEST_SUBSCRIPTION_MYSQL_LOG_DSN"},
		{common.DatabaseTypePostgreSQL, "TEST_SUBSCRIPTION_POSTGRES_DSN", "TEST_SUBSCRIPTION_POSTGRES_LOG_DSN"},
	} {
		t.Run(string(dialect.name), func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip(dialect.env + " is not configured")
			}
			openDB := func(dsn string) *gorm.DB {
				var driver gorm.Dialector = sqlite.Open(":memory:")
				switch dialect.name {
				case common.DatabaseTypeMySQL:
					driver = mysql.Open(dsn)
				case common.DatabaseTypePostgreSQL:
					driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
				}
				db, err := gorm.Open(driver, &gorm.Config{})
				require.NoError(t, err)
				sqlDB, err := db.DB()
				require.NoError(t, err)
				sqlDB.SetMaxOpenConns(1)
				t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
				return db
			}
			db := openDB(os.Getenv(dialect.env))
			logDB := db
			if dialect.name == common.DatabaseTypeSQLite || os.Getenv(dialect.logEnv) != "" {
				logDB = openDB(os.Getenv(dialect.logEnv))
			}
			oldDB, oldLogDB := model.DB, model.LOG_DB
			oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
			model.DB, model.LOG_DB = db, logDB
			common.SetDatabaseTypes(dialect.name, dialect.name)
			t.Cleanup(func() {
				model.DB, model.LOG_DB = oldDB, oldLogDB
				common.SetDatabaseTypes(oldMainType, oldLogType)
			})
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Channel{}, &model.Task{},
				&model.SubscriptionPlan{}, &model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{}))
			require.NoError(t, logDB.AutoMigrate(&model.Log{}))
			var version string
			versionQuery := "select version()"
			if dialect.name == common.DatabaseTypeSQLite {
				versionQuery = "select sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database: %s; separate log database: %t", version, db != logDB)
			runSubscriptionChannelAccountingCases(t, db, logDB)
		})
	}
}

func runSubscriptionChannelAccountingCases(t *testing.T, db, logDB *gorm.DB) {
	t.Helper()
	for index, tc := range []struct {
		name, flow, expression                          string
		groupRatio                                      float64
		wallet, fallback, special, legacy, empty, retry bool
	}{
		{name: "text markup", groupRatio: 2},
		{name: "text discount", groupRatio: 0.25},
		{name: "special group discount", groupRatio: 0.4, special: true},
		{name: "zero group ratio", groupRatio: 0},
		{name: "no usage", groupRatio: 2, empty: true},
		{name: "audio", flow: "audio", groupRatio: 2},
		{name: "realtime", flow: "realtime", groupRatio: 2},
		{name: "token expression", groupRatio: 2, expression: `tier("base", p * 2)`},
		{name: "group retry preserves subscription base rate", groupRatio: 2, expression: `tier("base", p * 2)`, retry: true},
		{name: "fixed price zero usage", groupRatio: 2, expression: `tier("request", fixed(0.0002))`, empty: true},
		{name: "wallet", groupRatio: 2, wallet: true},
		{name: "subscription falls back to wallet", groupRatio: 2, fallback: true},
		{name: "task settlement and refund", flow: "task", groupRatio: 2},
		{name: "task discount rounding and refund", flow: "task", groupRatio: 0.25},
		{name: "task zero group ratio survives persistence", flow: "task", groupRatio: 0},
		{name: "historical task retains recorded accounting", flow: "task", groupRatio: 2, legacy: true},
		{name: "channel saturation stays positive and audited", groupRatio: math.MaxFloat64},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const startingQuota = 10_000
			user := model.User{Username: fmt.Sprintf("subscription_channel_%d", index), Quota: startingQuota, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&user).Error)
			token := model.Token{UserId: user.Id, Key: fmt.Sprintf("subscription-channel-%d", index), RemainQuota: startingQuota, Status: common.TokenStatusEnabled}
			require.NoError(t, db.Create(&token).Error)
			channel := model.Channel{Name: "subscription-channel", Key: "unused", Status: common.ChannelStatusEnabled}
			require.NoError(t, db.Create(&channel).Error)
			plan := model.SubscriptionPlan{Title: "subscription-channel", QuotaResetPeriod: model.SubscriptionResetNever}
			require.NoError(t, db.Create(&plan).Error)
			sub := model.UserSubscription{
				UserId: user.Id, PlanId: plan.Id, AmountTotal: startingQuota,
				Status: "active", StartTime: time.Now().Unix(), EndTime: time.Now().Add(time.Hour).Unix(),
				AllowWalletOverflow: true,
			}
			if tc.fallback {
				sub.AmountTotal = 1
			}
			require.NoError(t, db.Create(&sub).Error)
			t.Cleanup(func() {
				model.InvalidateSubscriptionPlanCache(plan.Id)
				require.NoError(t, logDB.Where("user_id = ?", user.Id).Delete(&model.Log{}).Error)
				require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.SubscriptionPreConsumeRecord{}).Error)
				require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.Task{}).Error)
				require.NoError(t, db.Delete(&sub).Error)
				require.NoError(t, db.Delete(&plan).Error)
				require.NoError(t, db.Unscoped().Delete(&token).Error)
				require.NoError(t, db.Unscoped().Delete(&user).Error)
				require.NoError(t, db.Delete(&channel).Error)
			})
			ratio := tc.groupRatio
			reservation := common.QuotaRound(100 * ratio)
			if ratio == math.MaxFloat64 {
				// Exercise settlement saturation without reserving an oversized charge.
				reservation = 100
			}
			info := &relaycommon.RelayInfo{
				UserId: user.Id, TokenId: token.Id, TokenKey: token.Key,
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channel.Id},
				TaskRelayInfo:   &relaycommon.TaskRelayInfo{Action: "test"},
				OriginModelName: "subscription-channel-test", UsingGroup: "default", UserGroup: "default",
				RequestId: fmt.Sprintf("subscription-channel-%d-%d", index, user.Id),
				StartTime: time.Now(), ForcePreConsume: true,
				UserSetting: dto.UserSetting{BillingPreference: "subscription_first"},
				PriceData: hosttypes.PriceData{
					ModelRatio: 1, CompletionRatio: 1, Quota: reservation, QuotaToPreConsume: reservation,
					GroupRatioInfo: hosttypes.GroupRatioInfo{GroupRatio: ratio, HasSpecialRatio: tc.special, GroupSpecialRatio: ratio},
				},
			}
			if tc.wallet {
				info.UserSetting.BillingPreference = "wallet_only"
			}
			if tc.expression != "" {
				info.TieredBillingSnapshot = &billingexpr.BillingSnapshot{
					BillingMode: "tiered_expr", ExprString: tc.expression, ExprHash: billingexpr.ExprHashString(tc.expression),
					GroupRatio: ratio, QuotaPerUnit: common.QuotaPerUnit, EstimatedQuotaAfterGroup: reservation,
				}
			}
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			require.Nil(t, service.PreConsumeBilling(ctx, reservation, info))
			wantFunding := 100
			wantSubscription := int64(100)
			wantChannel := common.QuotaRound(100 * ratio)
			if tc.wallet || tc.fallback {
				wantFunding = reservation
				wantSubscription = 0
				assert.Equal(t, service.BillingSourceWallet, info.BillingSource)
				assert.Nil(t, info.PriceData.GroupRatioInfo.ChannelGroupRatio)
			} else {
				assert.Equal(t, service.BillingSourceSubscription, info.BillingSource)
			}
			if tc.retry {
				ctx.Set("auto_group", "subscription-channel-retry")
				info.PriceData.GroupRatioInfo = HandleGroupRatio(ctx, info)
				require.Nil(t, service.PrepareTieredBillingForSelectedGroup(ctx, info))
				assert.Equal(t, 100, info.Billing.GetPreConsumedQuota())
				wantChannel = 50
			}
			usage := &dto.Usage{PromptTokens: 100, TotalTokens: 100, PromptTokensDetails: dto.InputTokenDetails{TextTokens: 100}}
			if tc.empty {
				usage = &dto.Usage{}
				if tc.expression == "" {
					wantFunding, wantSubscription, wantChannel = 0, 0, 0
				}
			}
			switch tc.flow {
			case "audio":
				service.PostAudioConsumeQuota(ctx, info, usage, nil)
			case "realtime":
				service.PostWssConsumeQuota(ctx, info, info.OriginModelName, &dto.RealtimeUsage{
					InputTokens: 100, TotalTokens: 100, InputTokenDetails: dto.InputTokenDetails{TextTokens: 100},
				}, nil)
			case "task":
				require.NoError(t, service.SettleBilling(ctx, info, 100))
				info.PriceData.Quota = 100
				task := &model.Task{
					TaskID: fmt.Sprintf("subscription-channel-task-%d", user.Id),
					UserId: user.Id, ChannelId: channel.Id, Group: "default", Quota: 100,
					PrivateData: model.TaskPrivateData{
						BillingSource: info.BillingSource, SubscriptionId: info.SubscriptionId, TokenId: token.Id,
						BillingContext: &model.TaskBillingContext{
							GroupRatio: 1, ChannelGroupRatio: info.PriceData.GroupRatioInfo.ChannelGroupRatio,
						},
					},
				}
				if tc.legacy {
					task.PrivateData.BillingContext.ChannelGroupRatio = nil
					info.PriceData.GroupRatioInfo.ChannelGroupRatio = nil
					wantChannel = 100
				}
				require.NoError(t, db.Create(task).Error)
				require.NoError(t, db.First(task, task.ID).Error)
				service.LogTaskConsumption(ctx, info, task)
				require.NoError(t, db.First(&channel, channel.Id).Error)
				assert.Equal(t, int64(wantChannel), channel.UsedQuota)
				service.RecalculateTaskQuota(context.Background(), task, 103, common.NewMessage("test settlement"))
				service.RecalculateTaskQuota(context.Background(), task, 101, common.NewMessage("test settlement"))
				service.RecalculateTaskQuota(context.Background(), task, 102, common.NewMessage("test settlement"))
				expectedChannel := common.QuotaRound(102 * ratio)
				if tc.legacy {
					expectedChannel = 102
				}
				require.NoError(t, db.First(&channel, channel.Id).Error)
				assert.Equal(t, int64(expectedChannel), channel.UsedQuota)
				require.True(t, service.RefundTaskQuota(context.Background(), task, "test refund"))
				require.True(t, service.RefundTaskQuota(context.Background(), task, "test repeated refund"))
				wantFunding, wantSubscription, wantChannel = 0, 0, 0
			default:
				service.PostTextConsumeQuota(ctx, info, usage, nil)
			}
			require.NoError(t, db.First(&sub, sub.Id).Error)
			require.NoError(t, db.First(&channel, channel.Id).Error)
			require.NoError(t, db.First(&user, user.Id).Error)
			require.NoError(t, db.First(&token, token.Id).Error)
			assert.Equal(t, wantSubscription, sub.AmountUsed)
			assert.Equal(t, int64(wantChannel), channel.UsedQuota, "channel accounting must retain the configured group multiplier")
			assert.Equal(t, wantFunding, user.UsedQuota)
			assert.Equal(t, startingQuota-wantFunding, token.RemainQuota)
			assert.Equal(t, wantFunding, token.UsedQuota)
			walletQuota := startingQuota
			if tc.wallet || tc.fallback {
				walletQuota -= wantFunding
			}
			assert.Equal(t, walletQuota, user.Quota)
			var log model.Log
			require.NoError(t, logDB.Where("user_id = ?", user.Id).Order("id").First(&log).Error)
			if tc.flow != "task" {
				assert.Equal(t, wantFunding, log.Quota)
			}
			if ratio == math.MaxFloat64 {
				assert.Contains(t, log.Other, "quota_saturation")
			}
		})
	}
}
