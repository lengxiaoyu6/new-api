package model

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	filterdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestChannelValidateSettingsRejectsInvalidHTTPTransport(t *testing.T) {
	tests := []struct {
		name    string
		setting dto.ChannelSettings
		wantErr string
	}{
		{
			name:    "auto with shards is valid",
			setting: dto.ChannelSettings{HTTPProtocol: "auto", HTTP2ConnectionShards: 4},
		},
		{
			name:    "http1 with shards greater than one rejected",
			setting: dto.ChannelSettings{HTTPProtocol: "http1", HTTP2ConnectionShards: 2},
			wantErr: "http2_connection_shards",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			channel := &Channel{}
			channel.SetSetting(tt.setting)
			err := channel.ValidateSettings()
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestAdvancedCustomChannelRequiresModelListRouteOnlyWhenUpdateChecksEnabled(t *testing.T) {
	inferenceRoute := dto.AdvancedCustomRoute{
		IncomingPath: "/v1/chat/completions",
		UpstreamPath: "/v1/chat/completions",
		Converter:    "none",
	}

	tests := []struct {
		name          string
		checksEnabled bool
		routes        []dto.AdvancedCustomRoute
		wantErr       string
	}{
		{
			name:   "legacy channel without discovery route remains valid",
			routes: []dto.AdvancedCustomRoute{inferenceRoute},
		},
		{
			name:          "enabled checks require discovery route",
			checksEnabled: true,
			routes:        []dto.AdvancedCustomRoute{inferenceRoute},
			wantErr:       dto.AdvancedCustomModelListPath,
		},
		{
			name:          "enabled checks accept discovery route",
			checksEnabled: true,
			routes: []dto.AdvancedCustomRoute{
				inferenceRoute,
				{
					IncomingPath: dto.AdvancedCustomModelListPath,
					UpstreamPath: dto.AdvancedCustomModelListPath,
					Converter:    "none",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			channel := &Channel{Type: constant.ChannelTypeAdvancedCustom}
			channel.SetOtherSettings(dto.ChannelOtherSettings{
				UpstreamModelUpdateCheckEnabled: tt.checksEnabled,
				AdvancedCustom: &dto.AdvancedCustomConfig{
					Routes: tt.routes,
				},
			})

			err := channel.ValidateSettings()
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestChannelValidateSettingsRejectsInvalidBillingProfile(t *testing.T) {
	channel := &Channel{}
	channel.SetOtherSettings(dto.ChannelOtherSettings{BillingProfiles: map[string]dto.ChannelBillingProfile{
		"model": {
			Key:         "bad key",
			Label:       dto.ChannelBillingProfileLabel{En: "Bad"},
			BillingMode: "tiered_expr",
			BillingExpr: `tier("base", p)`,
		},
	}})
	err := channel.ValidateSettings()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid billing profile key")
}

func TestChannelValidateGroupModels(t *testing.T) {
	for _, tc := range []struct {
		name, settings, wantErr string
	}{
		{"legacy", `{}`, ""},
		{"restricted", `{"group_models":{"a":["gpt-4"],"b":["claude-test"]}}`, ""},
		{"explicit empty", `{"group_models":{"a":[]}}`, ""},
		{"null restricts all", `{"group_models":{"a":null}}`, ""},
		{"unbound group", `{"group_models":{"other":["gpt-4"]}}`, "Model restrictions must reference channel groups"},
		{"unknown model", `{"group_models":{"a":["unknown"]}}`, "Model restrictions must reference channel models"},
		{"empty model", `{"group_models":{"a":[""]}}`, "Model restrictions must reference channel models"},
		{"wrong list type", `{"group_models":{"a":"gpt-4"}}`, "cannot unmarshal"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			channel := &Channel{Models: "gpt-4,claude-test", Group: "a,b", OtherSettings: tc.settings}
			err := channel.ValidateSettings()
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.ErrorContains(t, err, tc.wantErr)
		})
	}
}

func TestChannelGroupModelsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "group-models.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			previousDB, previousType, previousCache := DB, common.MainDatabaseType(), common.MemoryCacheEnabled
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&Ability{}, &Channel{}, &Model{}, &Vendor{}))
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				common.MemoryCacheEnabled = previousCache
				initCol()
				InitChannelCache()
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}, &Model{}, &Vendor{}))
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("%s version: %s", dialect, version)

			channel := &Channel{
				Name: "shared upstream", Type: constant.ChannelTypeOpenAI, Key: "test-only",
				Status: common.ChannelStatusEnabled, Models: "gpt-4,claude-test", Group: "openai,anthropic,shared,empty",
				OtherSettings: `{"group_models":{"openai":["gpt-4"],"anthropic":["claude-test"],"empty":[]}}`,
			}
			require.NoError(t, channel.Insert())
			assertChannelGroupModelAvailability(t, channel, map[string][]string{
				"openai": {"gpt-4"}, "anthropic": {"claude-test"}, "shared": {"gpt-4", "claude-test"}, "empty": {},
			})

			// A save and repeated ability rebuilds must preserve the explicit restrictions.
			var loaded Channel
			require.NoError(t, db.First(&loaded, channel.Id).Error)
			require.NoError(t, loaded.Update())
			for range 2 {
				require.NoError(t, loaded.UpdateAbilities(nil))
				assertChannelGroupModelAvailability(t, &loaded, map[string][]string{
					"openai": {"gpt-4"}, "anthropic": {"claude-test"}, "shared": {"gpt-4", "claude-test"}, "empty": {},
				})
			}

			// Upstream additions belong only to unrestricted groups until explicitly selected.
			loaded.Models += ",new-model"
			require.NoError(t, loaded.Update())
			assertChannelGroupModelAvailability(t, &loaded, map[string][]string{
				"openai": {"gpt-4"}, "anthropic": {"claude-test"}, "shared": {"gpt-4", "claude-test", "new-model"}, "empty": {},
			})

			// Removing a model must leave its restricted group empty, without falling back to all models.
			loaded.Models = "gpt-4,new-model"
			require.NoError(t, loaded.Update())
			assertChannelGroupModelAvailability(t, &loaded, map[string][]string{
				"openai": {"gpt-4"}, "anthropic": {}, "shared": {"gpt-4", "new-model"}, "empty": {},
			})

			loaded.OtherSettings = `{"group_models":{"openai":["new-model"],"anthropic":[],"empty":[]}}`
			require.NoError(t, loaded.Update())
			assertChannelGroupModelAvailability(t, &loaded, map[string][]string{
				"openai": {"new-model"}, "anthropic": {}, "shared": {"gpt-4", "new-model"}, "empty": {},
			})
			loaded.OtherSettings = "{}"
			require.NoError(t, loaded.Update())
			assertChannelGroupModelAvailability(t, &loaded, map[string][]string{
				"openai": {"gpt-4", "new-model"}, "anthropic": {"gpt-4", "new-model"},
				"shared": {"gpt-4", "new-model"}, "empty": {"gpt-4", "new-model"},
			})
		})
	}
}

func assertChannelGroupModelAvailability(t *testing.T, channel *Channel, expected map[string][]string) {
	t.Helper()
	for _, cached := range []bool{false, true} {
		common.MemoryCacheEnabled = cached
		InitChannelCache()
		for group, models := range expected {
			assert.ElementsMatch(t, models, GetGroupEnabledModels(group), "group %s, cache %t", group, cached)
			for _, name := range []string{"gpt-4", "claude-test", "new-model"} {
				allowed := slices.Contains(models, name)
				selected, err := GetRandomSatisfiedChannel(group, name, 0, nil)
				require.NoError(t, err)
				assert.Equal(t, allowed, selected != nil, "selection: group %s model %s cache %t", group, name, cached)
				assert.Equal(t, allowed, IsChannelEnabledForGroupModel(group, name, channel.Id), "affinity: group %s model %s cache %t", group, name, cached)
			}
		}
		for _, pricing := range GetPricing() {
			for group, models := range expected {
				allowed := slices.Contains(models, pricing.ModelName)
				assert.Equal(t, allowed, common.StringsContains(pricing.EnableGroup, group), "catalog: group %s model %s", group, pricing.ModelName)
			}
		}
	}
}

func TestInferencePresetSettingsAndDatabaseRoundTrip(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "presets.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			table := db.Table("inference_preset_channels").Session(&gorm.Session{})
			require.NoError(t, table.AutoMigrate(&Channel{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable("inference_preset_channels")) })
			var version string
			if dialect == "sqlite" {
				require.NoError(t, db.Raw("select sqlite_version()").Scan(&version).Error)
			} else {
				require.NoError(t, db.Raw("select version()").Scan(&version).Error)
			}
			t.Logf("%s version: %s", dialect, version)
			for _, channelType := range []int{constant.ChannelTypeVLLM, constant.ChannelTypeSGLang} {
				t.Run(fmt.Sprint(channelType), func(t *testing.T) {
					channel := &Channel{Type: channelType, Key: "EMPTY", Name: "inference", Status: common.ChannelStatusEnabled}
					require.NoError(t, channel.ValidateSettings())
					require.NotNil(t, channel.GetOtherSettings().AdvancedCustom)
					require.NoError(t, table.Create(channel).Error)
					for range 2 {
						var loaded Channel
						require.NoError(t, table.First(&loaded, channel.Id).Error)
						assert.Equal(t, channelType, loaded.Type)
						assert.Empty(t, loaded.OtherSettings)
						defaults := loaded.GetOtherSettings().AdvancedCustom
						require.NotNil(t, defaults)
						assert.True(t, defaults.SupportsPath("/v1/messages"))
						assert.Empty(t, loaded.OtherSettings, "reading defaults must not rewrite saved settings")
						defaults.Routes[0].UpstreamPath = "/changed-locally"
						assert.Equal(t, "/v1/chat/completions", loaded.GetOtherSettings().AdvancedCustom.Routes[0].UpstreamPath)
					}
					settings := dto.ChannelOtherSettings{AdvancedCustom: &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{IncomingPath: "/v1/chat/completions", UpstreamPath: "/custom/chat", Models: []string{"allowed"}, Auth: &dto.AdvancedCustomRouteAuth{Type: "none"}}}}}
					channel.SetOtherSettings(settings)
					require.NoError(t, channel.ValidateSettings())
					require.NoError(t, table.Save(channel).Error)
					for range 2 {
						var loaded Channel
						require.NoError(t, table.First(&loaded, channel.Id).Error)
						actual := loaded.GetOtherSettings().AdvancedCustom
						require.Equal(t, common.GetAdvancedCustomPreset(channelType), actual, "named channels must ignore editable advanced_custom overrides")
						assert.Equal(t, channel.OtherSettings, loaded.OtherSettings)
						for _, tc := range []struct {
							path, model string
							allowed     bool
						}{
							{"/v1/chat/completions", "allowed", true},
							{"/v1/chat/completions", "other", true},
							{"/v1/messages", "allowed", true},
							{"/v1/images/generations", "allowed", false},
						} {
							ok, _ := ChannelSatisfiesFilters(&loaded, tc.model, []filterdto.ChannelFilter{{Kind: filterdto.FilterRequestPath, RequestPath: tc.path}})
							assert.Equal(t, tc.allowed, ok)
						}
						endpoints := getPricingEndpointTypesForAbility(AbilityWithChannel{ChannelType: channelType, Ability: Ability{Model: "allowed", ChannelId: loaded.Id}}, map[int]*dto.AdvancedCustomConfig{loaded.Id: actual})
						expectedEndpoints := []constant.EndpointType{constant.EndpointTypeOpenAI, constant.EndpointTypeOpenAIResponse, constant.EndpointTypeAnthropic, constant.EndpointTypeEmbeddings}
						if channelType == constant.ChannelTypeSGLang {
							expectedEndpoints = append(expectedEndpoints, constant.EndpointTypeJinaRerank)
						}
						assert.ElementsMatch(t, expectedEndpoints, endpoints)
					}
				})
			}
		})
	}
}
