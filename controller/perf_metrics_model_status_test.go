package controller

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type availabilityResponseWriter struct {
	*httptest.ResponseRecorder
	cancel context.CancelFunc
}

func (w *availabilityResponseWriter) Flush() {
	w.ResponseRecorder.Flush()
	w.cancel()
}

func setupModelStatusControllerTest(t *testing.T) *gorm.DB {
	t.Helper()

	oldDB := model.DB
	oldLogDB := model.LOG_DB
	oldRedisEnabled := common.RedisEnabled
	oldMainDatabaseType := common.MainDatabaseType()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.PerfMetric{},
		&model.Ability{},
		&model.Channel{},
		&model.Model{},
		&model.Vendor{},
	))

	model.DB = db
	model.LOG_DB = db
	common.RedisEnabled = false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	model.InvalidatePricingCache()

	t.Cleanup(func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.RedisEnabled = oldRedisEnabled
		common.SetMainDatabaseType(oldMainDatabaseType)
		model.InvalidatePricingCache()
	})
	return db
}

func setModelStatusHeaderNavModules(t *testing.T, raw string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	previous, hadPrevious := common.OptionMap["HeaderNavModules"]
	common.OptionMap["HeaderNavModules"] = raw
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if hadPrevious {
			common.OptionMap["HeaderNavModules"] = previous
		} else {
			delete(common.OptionMap, "HeaderNavModules")
		}
		common.OptionMapRWMutex.Unlock()
	})
}

func newModelStatusTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/model-status", middleware.HeaderNavModuleAuth("modelStatus"), GetModelStatus)
	return router
}

func prepareModelStatusControllerFixture(t *testing.T, db *gorm.DB) string {
	t.Helper()

	vendor := model.Vendor{Name: "CatalogOpenAI", Status: 1}
	require.NoError(t, db.Create(&vendor).Error)
	require.NoError(t, db.Create(&model.Model{ModelName: "gpt-test", VendorID: vendor.Id, Status: 1, NameRule: model.NameRuleExact}).Error)
	channel := model.Channel{Type: constant.ChannelTypeAnthropic, Key: "anthropic-key", Status: 1, Name: "anthropic-channel"}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "gpt-test", ChannelId: channel.Id, Enabled: true}).Error)
	model.InvalidatePricingCache()

	bucketTs := time.Now().Add(-time.Minute).Unix()
	require.NoError(t, db.Create(&model.PerfMetric{
		ModelName:      "gpt-test",
		Group:          "default",
		ChannelType:    constant.ChannelTypeAnthropic,
		BucketTs:       bucketTs,
		RequestCount:   5,
		SuccessCount:   5,
		TtftSumMs:      600,
		TtftCount:      3,
		FastestTtftMs:  100,
		SlowestTtftMs:  300,
		TotalLatencyMs: 2500,
	}).Error)

	return modelStatusTestTime(bucketTs)
}

func modelStatusTestTime(ts int64) string {
	if ts <= 0 {
		return ""
	}
	return time.Unix(ts, 0).UTC().Format(time.RFC3339)
}

func TestGetPerfMetricsSummaryFiltersSelectedGroup(t *testing.T) {
	for _, dialect := range []struct{ name, env string }{
		{"sqlite", ""}, {"mysql", "TEST_PERF_MYSQL_DSN"}, {"postgres", "TEST_PERF_POSTGRES_DSN"},
	} {
		t.Run(dialect.name, func(t *testing.T) {
			dsn := os.Getenv(dialect.env)
			if dialect.env != "" && dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			_, isolatedDSN := newAuditTestDatabase(t, dialect.name, dsn)
			previousDB, previousLogDB := model.DB, model.LOG_DB
			previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
			previousMaster, previousSQLite := common.IsMasterNode, common.SQLitePath
			previousGroups := ratio_setting.GroupRatio2JSONString()
			common.IsMasterNode = false
			if dialect.name == "sqlite" {
				common.SQLitePath, isolatedDSN = isolatedDSN, "local"
			}
			t.Setenv("SQL_DSN", isolatedDSN)
			t.Setenv("LOG_SQL_DSN", "")
			t.Cleanup(func() {
				model.DB, model.LOG_DB = previousDB, previousLogDB
				common.IsMasterNode, common.SQLitePath = previousMaster, previousSQLite
				common.SetDatabaseTypes(previousMain, previousLog)
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroups))
			})
			require.NoError(t, model.InitDB())
			db := model.DB
			connection, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, connection.Close()) })
			require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"a":1,"b":1,"empty":1}`))
			var version string
			versionQuery := "SELECT version()"
			if dialect.name == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			bucketTs := time.Now().Unix()
			bucketTs -= bucketTs % 3600
			require.NoError(t, db.Create(&[]model.PerfMetric{
				{ModelName: "group-model", Group: "a", BucketTs: bucketTs, RequestCount: 4, SuccessCount: 4},
				{ModelName: "group-model", Group: "b", BucketTs: bucketTs, RequestCount: 4, SuccessCount: 1},
				{ModelName: "group-model", Group: "inactive", BucketTs: bucketTs, RequestCount: 100},
			}).Error)

			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.GET("/api/perf-metrics/summary", GetPerfMetricsSummary)
			for _, tc := range []struct {
				name  string
				query string
				rate  float64
				empty bool
			}{
				{name: "all active groups", rate: 62.5},
				{name: "group a", query: "&group=a", rate: 100},
				{name: "group b", query: "&group=b", rate: 25},
				{name: "group without requests", query: "&group=empty", empty: true},
				{name: "inactive group", query: "&group=inactive", empty: true},
			} {
				t.Run(tc.name, func(t *testing.T) {
					request := httptest.NewRequest(http.MethodGet, "/api/perf-metrics/summary?hours=24&recent_model=group-model"+tc.query, nil)
					response := httptest.NewRecorder()
					router.ServeHTTP(response, request)
					require.Equal(t, http.StatusOK, response.Code)
					var payload struct {
						Success bool                         `json:"success"`
						Data    perfmetrics.SummaryAllResult `json:"data"`
					}
					require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
					require.True(t, payload.Success)
					if tc.empty {
						assert.Empty(t, payload.Data.Models)
						assert.Nil(t, payload.Data.Summary)
						assert.Empty(t, payload.Data.RecentSuccessSeries)
						return
					}
					require.Len(t, payload.Data.Models, 1)
					require.NotNil(t, payload.Data.Summary)
					item := payload.Data.Models[0]
					assert.Equal(t, tc.rate, item.SuccessRate)
					assert.Equal(t, tc.rate, payload.Data.Summary.SuccessRate)
					require.Len(t, item.RecentSuccessSeries, 1)
					assert.Equal(t, tc.rate, item.RecentSuccessSeries[0].SuccessRate)
					require.Len(t, payload.Data.RecentSuccessSeries["group-model"], 1)
					assert.Equal(t, tc.rate, payload.Data.RecentSuccessSeries["group-model"][0].SuccessRate)
				})
			}

			t.Run("successful nonstream request remains available after client disconnects", func(t *testing.T) {
				require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &model.Channel{}))
				model.LOG_DB = db
				t.Cleanup(func() { model.LOG_DB = previousLogDB })
				t.Cleanup(perfmetrics.Flush)
				previousRatios := ratio_setting.ModelRatio2JSONString()
				previousLogEnabled, previousBatchEnabled := common.LogConsumeEnabled, common.BatchUpdateEnabled
				previousRedisEnabled := common.RedisEnabled
				previousCountToken := constant.CountToken
				quotaSetting := operation_setting.GetQuotaSetting()
				previousFreePreConsume := quotaSetting.EnableFreeModelPreConsume
				common.LogConsumeEnabled, common.BatchUpdateEnabled = true, false
				common.RedisEnabled = false
				constant.CountToken = false
				quotaSetting.EnableFreeModelPreConsume = false
				require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-6-sol":0}`))
				t.Cleanup(func() {
					common.LogConsumeEnabled, common.BatchUpdateEnabled = previousLogEnabled, previousBatchEnabled
					common.RedisEnabled = previousRedisEnabled
					constant.CountToken = previousCountToken
					quotaSetting.EnableFreeModelPreConsume = previousFreePreConsume
					require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios))
				})
				user := model.User{Username: "availability-test", Group: "a", Status: common.UserStatusEnabled}
				require.NoError(t, db.Create(&user).Error)
				service.InitHttpClient()
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					_, _ = io.WriteString(w, `{"id":"resp_test","object":"response","status":"completed","model":"gpt-6-sol","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello"}]}],"usage":{"input_tokens":7,"output_tokens":5,"total_tokens":12}}`)
				}))
				t.Cleanup(upstream.Close)
				channel := model.Channel{
					Name: "availability-test", Type: constant.ChannelTypeOpenAI, Key: "test-key",
					BaseURL: &upstream.URL, Status: common.ChannelStatusEnabled,
				}
				require.NoError(t, db.Create(&channel).Error)
				ctx, cancel := context.WithCancel(context.Background())
				t.Cleanup(cancel)
				writer := &availabilityResponseWriter{ResponseRecorder: httptest.NewRecorder(), cancel: cancel}
				c, _ := gin.CreateTestContext(writer)
				c.Request = httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/responses",
					strings.NewReader(`{"model":"gpt-6-sol","input":"Hello","stream":false}`))
				c.Request.Header.Set("Content-Type", "application/json")
				common.SetContextKey(c, constant.ContextKeyOriginalModel, "gpt-6-sol")
				common.SetContextKey(c, constant.ContextKeyUsingGroup, "a")
				common.SetContextKey(c, constant.ContextKeyUserId, user.Id)
				common.SetContextKey(c, constant.ContextKeyUserGroup, "a")
				require.Nil(t, middleware.SetupContextForSelectedChannel(c, &channel, "gpt-6-sol"))

				Relay(c, types.RelayFormatOpenAIResponses)

				require.Equal(t, http.StatusOK, writer.Code, writer.Body.String())
				require.Contains(t, writer.Body.String(), `"status":"completed"`)
				require.ErrorIs(t, ctx.Err(), context.Canceled)
				var log model.Log
				require.NoError(t, db.Where("model_name = ? AND type = ?", "gpt-6-sol", model.LogTypeConsume).First(&log).Error)
				assert.Equal(t, "a", log.Group)
				assert.Equal(t, 5, log.CompletionTokens)
				assert.False(t, log.IsStream)

				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/perf-metrics/summary?hours=24&group=a", nil))
				require.Equal(t, http.StatusOK, response.Code)
				var payload struct {
					Success bool                         `json:"success"`
					Data    perfmetrics.SummaryAllResult `json:"data"`
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
				require.True(t, payload.Success)
				var found bool
				for _, item := range payload.Data.Models {
					if item.ModelName == "gpt-6-sol" {
						found = true
						assert.Equal(t, 100.0, item.SuccessRate)
						assert.NotEmpty(t, item.RecentSuccessSeries)
					}
				}
				require.True(t, found, "a completed nonstream request with a consumption log must appear in marketplace availability")

				perfmetrics.Flush()
				var metric model.PerfMetric
				require.NoError(t, db.Where("model_name = ?", "gpt-6-sol").First(&metric).Error)
				assert.Equal(t, "a", metric.Group)
				assert.Equal(t, int64(1), metric.RequestCount)
				assert.Equal(t, int64(1), metric.SuccessCount)
				assert.Equal(t, int64(5), metric.OutputTokens)
			})
		})
	}
}

func TestGetModelStatusReturnsPublicModelMetrics(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	setModelStatusHeaderNavModules(t, `{"modelStatus":{"enabled":true,"requireAuth":false}}`)
	expectedLastUpdated := prepareModelStatusControllerFixture(t, db)

	request := httptest.NewRequest(http.MethodGet, "/api/model-status?hours=24", nil)
	response := httptest.NewRecorder()
	newModelStatusTestRouter().ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool                            `json:"success"`
		Data    perfmetrics.ModelStatusResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	require.Len(t, payload.Data.Models, 1)
	require.Len(t, payload.Data.Providers, 1)
	item := payload.Data.Models[0]
	assert.Equal(t, "CatalogOpenAI", item.Provider)
	assert.Equal(t, "gpt-test", item.ModelName)
	assert.Equal(t, float64(100), item.HealthScore)
	assert.Equal(t, int64(100), item.FastestTtftMs)
	assert.Equal(t, int64(300), item.SlowestTtftMs)
	assert.Equal(t, int64(5), item.RequestCount)
	assert.Equal(t, expectedLastUpdated, item.LastUpdated)
	assert.Equal(t, modelStatusTestTime(payload.Data.GeneratedAt), payload.Data.LastUpdated)
	assert.Equal(t, fmt.Sprintf("vendor:%d", payload.Data.Providers[0].VendorID), payload.Data.Providers[0].ProviderID)
	require.Len(t, item.Groups, 1)
	assert.Equal(t, "default", item.Groups[0].Group)
	assert.Equal(t, expectedLastUpdated, item.Groups[0].LastUpdated)
}

func TestGetModelStatusRejectsDisabledModule(t *testing.T) {
	setupModelStatusControllerTest(t)
	setModelStatusHeaderNavModules(t, `{"modelStatus":{"enabled":false,"requireAuth":false}}`)

	request := httptest.NewRequest(http.MethodGet, "/api/model-status", nil)
	response := httptest.NewRecorder()
	newModelStatusTestRouter().ServeHTTP(response, request)

	require.Equal(t, http.StatusForbidden, response.Code)
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.False(t, payload.Success)
	assert.Equal(t, "modelStatus is disabled", payload.Message)
}
