package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupModelStatusControllerTest(t *testing.T) *gorm.DB {
	t.Helper()

	oldDB := model.DB
	oldLogDB := model.LOG_DB
	oldRedisEnabled := common.RedisEnabled
	oldMainDatabaseType := common.MainDatabaseType()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))

	model.DB = db
	model.LOG_DB = db
	common.RedisEnabled = false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)

	t.Cleanup(func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.RedisEnabled = oldRedisEnabled
		common.SetMainDatabaseType(oldMainDatabaseType)
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

func TestGetModelStatusReturnsPublicModelMetrics(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	setModelStatusHeaderNavModules(t, `{"modelStatus":{"enabled":true,"requireAuth":false}}`)

	bucketTs := time.Now().Add(-time.Minute).Unix()
	require.NoError(t, db.Create(&model.PerfMetric{
		ModelName:      "gpt-test",
		Group:          "default",
		ChannelType:    constant.ChannelTypeOpenAI,
		BucketTs:       bucketTs,
		RequestCount:   5,
		SuccessCount:   5,
		TtftSumMs:      600,
		TtftCount:      3,
		FastestTtftMs:  100,
		SlowestTtftMs:  300,
		TotalLatencyMs: 2500,
	}).Error)

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
	assert.Equal(t, "OpenAI", item.Provider)
	assert.Equal(t, "gpt-test", item.ModelName)
	assert.Equal(t, float64(100), item.HealthScore)
	assert.Equal(t, int64(100), item.FastestTtftMs)
	assert.Equal(t, int64(300), item.SlowestTtftMs)
	assert.Equal(t, int64(5), item.RequestCount)
	assert.NotEmpty(t, item.LastUpdated)
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
