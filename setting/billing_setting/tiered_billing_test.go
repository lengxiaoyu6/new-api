package billing_setting

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSmokeTestTaskExprValidatesDeclaredUsageVectors(t *testing.T) {
	videoSchema := map[string]jsplugin.UsageFieldSchema{
		"seconds": {Type: "number", Unit: "second"},
		"mode":    {Enum: []string{"std", "pro"}},
		"quality": {Enum: []string{"sd", "hd"}},
	}

	tests := []struct {
		name          string
		schema        map[string]jsplugin.UsageFieldSchema
		expression    string
		expectedError string
	}{
		{
			name:       "declared numeric and enum facts",
			schema:     videoSchema,
			expression: `u("mode") == "pro" ? tier("pro", u("seconds") * 0.8) : tier("std", u("seconds") * 0.4)`,
		},
		{
			name:          "undeclared literal key",
			schema:        videoSchema,
			expression:    `tier("base", u("clips") * 0.1)`,
			expectedError: `usage key "clips" is not declared`,
		},
		{
			name:          "negative duration boundary",
			schema:        videoSchema,
			expression:    fmt.Sprintf(`u("seconds") == %d ? -1 : 0`, relaycommon.MaxTaskDurationSeconds),
			expectedError: "result must be finite and non-negative",
		},
		{
			name:          "negative count boundary",
			schema:        map[string]jsplugin.UsageFieldSchema{"clips": {Type: "number", Unit: "count"}},
			expression:    fmt.Sprintf(`u("clips") == %d ? -1 : 0`, dto.MaxImageN),
			expectedError: "result must be finite and non-negative",
		},
		{
			name:          "negative token boundary",
			schema:        map[string]jsplugin.UsageFieldSchema{"tokens": {Type: "number", Unit: "token"}},
			expression:    fmt.Sprintf(`u("tokens") == %d ? -1 : 0`, common.MaxQuota),
			expectedError: "result must be finite and non-negative",
		},
		{
			name:          "negative credit boundary",
			schema:        map[string]jsplugin.UsageFieldSchema{"units": {Type: "number", Unit: "credit"}},
			expression:    fmt.Sprintf(`u("units") == %d ? -1 : 0`, common.MaxQuota),
			expectedError: "result must be finite and non-negative",
		},
		{
			name:          "negative enum combination",
			schema:        videoSchema,
			expression:    `u("mode") == "pro" && u("quality") == "hd" ? -1 : 0`,
			expectedError: "result must be finite and non-negative",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			err := SmokeTestTaskExpr(testCase.expression, testCase.schema)
			if testCase.expectedError == "" {
				require.NoError(t, err)
				return
			}
			require.ErrorContains(t, err, testCase.expectedError)
		})
	}
}

func TestSmokeTestTaskExprCapsOversizedEnumProductsAtLastCombination(t *testing.T) {
	schema := make(map[string]jsplugin.UsageFieldSchema, 7)
	condition := ""
	for index := 0; index < 7; index++ {
		schema[fmt.Sprintf("enum_%d", index)] = jsplugin.UsageFieldSchema{Enum: []string{"first", "middle", "last"}}
		if condition != "" {
			condition += " && "
		}
		condition += fmt.Sprintf(`u("enum_%d") == "last"`, index)
	}

	err := SmokeTestTaskExpr(condition+" ? -1 : 0", schema)
	require.ErrorContains(t, err, "result must be finite and non-negative")
}

func TestSmokeTestExprRejectsTaskUsageWithoutSchema(t *testing.T) {
	err := SmokeTestExpr(`u("mode") == "std" ? 1 : 2`)
	require.Error(t, err)
	assert.ErrorContains(t, err, "mode")
	assert.ErrorContains(t, err, "no task plugin usage schema")

	require.NoError(t, SmokeTestExpr(`tier("base", p * 2 + c * 8)`))
}

func TestChannelBillingProfileResolutionAndValidation(t *testing.T) {
	original := billingSetting
	t.Cleanup(func() { billingSetting = original })
	billingSetting = BillingSetting{
		BillingMode: map[string]string{"profile-model": BillingModeTieredExpr},
		BillingExpr: map[string]string{"profile-model": `tier("base", p * 1 + c * 2)`},
	}
	settings := dto.ChannelOtherSettings{BillingProfiles: map[string]dto.ChannelBillingProfile{
		"profile-model": {
			Key:         "long-context",
			Label:       dto.ChannelBillingProfileLabel{Zh: "长上下文", En: "Long context"},
			BillingMode: BillingModeTieredExpr,
			BillingExpr: `len > 100 ? tier("long", p * 2 + c * 4) : tier("base", p + c * 2)`,
		},
	}}
	require.NoError(t, ValidateChannelBillingProfiles(settings))
	definition, err := ResolveBillingDefinition(settings, "profile-model", 42)
	require.NoError(t, err)
	assert.Equal(t, BillingProfileSourceChannel, definition.ProfileSource)
	assert.Equal(t, "long-context", definition.ProfileKey)
	assert.Equal(t, 42, definition.ChannelID)

	fallback, err := ResolveBillingDefinition(dto.ChannelOtherSettings{}, "profile-model", 42)
	require.NoError(t, err)
	assert.Equal(t, BillingProfileSourceModel, fallback.ProfileSource)
	assert.Equal(t, billingSetting.BillingExpr["profile-model"], fallback.BillingExpr)

	invalid := settings
	invalid.BillingProfiles = map[string]dto.ChannelBillingProfile{
		"profile-model": {
			Key:         "bad key",
			Label:       dto.ChannelBillingProfileLabel{En: "Bad"},
			BillingMode: BillingModeTieredExpr,
			BillingExpr: `tier("base", p)`,
		},
	}
	require.ErrorContains(t, ValidateChannelBillingProfiles(invalid), "invalid billing profile key")
}
