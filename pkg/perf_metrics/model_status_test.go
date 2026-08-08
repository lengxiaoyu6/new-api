package perfmetrics

import (
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupModelStatusTestDB(t *testing.T) {
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
	hotBuckets = sync.Map{}

	t.Cleanup(func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.RedisEnabled = oldRedisEnabled
		common.SetMainDatabaseType(oldMainDatabaseType)
		hotBuckets = sync.Map{}
	})
}

func TestQueryModelStatusGroupsByChannelTypeAndMergesHotBuckets(t *testing.T) {
	setupModelStatusTestDB(t)

	currentBucket := bucketStart(time.Now().Unix())
	previousBucket := currentBucket - 3600
	require.NoError(t, model.DB.Create([]model.PerfMetric{
		{
			ModelName:      "gpt-test",
			Group:          "default",
			ChannelType:    constant.ChannelTypeOpenAI,
			BucketTs:       previousBucket,
			RequestCount:   6,
			SuccessCount:   6,
			TotalLatencyMs: 6000,
			TtftSumMs:      900,
			TtftCount:      3,
			FastestTtftMs:  180,
			SlowestTtftMs:  420,
		},
		{
			ModelName:      "gpt-test",
			Group:          "vip",
			ChannelType:    constant.ChannelTypeOpenAI,
			BucketTs:       previousBucket,
			RequestCount:   4,
			SuccessCount:   3,
			TotalLatencyMs: 5000,
			TtftSumMs:      1300,
			TtftCount:      2,
			FastestTtftMs:  120,
			SlowestTtftMs:  1500,
		},
		{
			ModelName:    "legacy-test",
			Group:        "default",
			ChannelType:  0,
			BucketTs:     previousBucket,
			RequestCount: 1,
			SuccessCount: 0,
		},
	}).Error)

	bucket := newAtomicBucket()
	bucket.add(Sample{Success: true, HasTtft: true, TtftMs: 90, LatencyMs: 900})
	bucket.add(Sample{Success: true, HasTtft: true, TtftMs: 700, LatencyMs: 1100})
	hotBuckets.Store(bucketKey{
		model:       "claude-test",
		group:       "default",
		channelType: constant.ChannelTypeAnthropic,
		bucketTs:    currentBucket,
	}, bucket)

	result, err := QueryModelStatus(ModelStatusQueryParams{Hours: 24, Groups: []string{"default", "vip"}})
	require.NoError(t, err)
	require.Len(t, result.Models, 3)
	require.Len(t, result.Providers, 3)
	assert.Equal(t, 24, result.WindowHours)
	assert.Equal(t, formatStatusTime(currentBucket), result.LastUpdated)

	openAIModel := requireModelStatusItem(t, result.Models, constant.ChannelTypeOpenAI, "gpt-test")
	assert.Equal(t, "OpenAI", openAIModel.Provider)
	assert.Equal(t, "OpenAI", openAIModel.ProviderName)
	assert.Equal(t, "channel:1", openAIModel.ProviderID)
	assert.Equal(t, int64(120), openAIModel.FastestTtftMs)
	assert.Equal(t, int64(1500), openAIModel.SlowestTtftMs)
	assert.Equal(t, int64(10), openAIModel.RequestCount)
	assert.Equal(t, int64(5), openAIModel.TtftSampleCount)
	assert.InDelta(t, 90, openAIModel.SuccessRate, 0.001)
	assert.InDelta(t, openAIModel.SuccessRate, openAIModel.HealthScore, 0.001)
	assert.Equal(t, "degraded", openAIModel.Status)
	assert.Equal(t, formatStatusTime(previousBucket), openAIModel.LastUpdated)

	anthropicModel := requireModelStatusItem(t, result.Models, constant.ChannelTypeAnthropic, "claude-test")
	assert.Equal(t, "Anthropic", anthropicModel.Provider)
	assert.Equal(t, int64(90), anthropicModel.FastestTtftMs)
	assert.Equal(t, int64(700), anthropicModel.SlowestTtftMs)
	assert.Equal(t, int64(2), anthropicModel.RequestCount)
	assert.Equal(t, "healthy", anthropicModel.Status)
	assert.Equal(t, formatStatusTime(currentBucket), anthropicModel.LastUpdated)

	legacyModel := requireModelStatusItem(t, result.Models, 0, "legacy-test")
	assert.Equal(t, "Unknown", legacyModel.Provider)
	assert.Equal(t, int64(0), legacyModel.FastestTtftMs)
	assert.Equal(t, int64(0), legacyModel.SlowestTtftMs)
	assert.Equal(t, "down", legacyModel.Status)

	openAIProvider := requireModelStatusProvider(t, result.Providers, constant.ChannelTypeOpenAI)
	assert.Equal(t, "OpenAI", openAIProvider.Provider)
	assert.Equal(t, int64(10), openAIProvider.RequestCount)
	assert.Equal(t, int64(120), openAIProvider.FastestTtftMs)
	assert.Equal(t, int64(1500), openAIProvider.SlowestTtftMs)
	assert.Equal(t, "degraded", openAIProvider.Status)
	require.Len(t, openAIProvider.Models, 1)
}

func TestQueryModelStatusAppliesGroupFilter(t *testing.T) {
	setupModelStatusTestDB(t)

	bucketTs := bucketStart(time.Now().Unix()) - 3600
	require.NoError(t, model.DB.Create([]model.PerfMetric{
		{
			ModelName:    "default-model",
			Group:        "default",
			ChannelType:  constant.ChannelTypeOpenAI,
			BucketTs:     bucketTs,
			RequestCount: 1,
			SuccessCount: 1,
		},
		{
			ModelName:    "vip-model",
			Group:        "vip",
			ChannelType:  constant.ChannelTypeOpenAI,
			BucketTs:     bucketTs,
			RequestCount: 1,
			SuccessCount: 1,
		},
	}).Error)

	result, err := QueryModelStatus(ModelStatusQueryParams{Hours: 24, Groups: []string{"default"}})
	require.NoError(t, err)
	require.Len(t, result.Models, 1)
	assert.Equal(t, "default-model", result.Models[0].ModelName)
}

func TestQueryModelStatusReturnsEmptyCollectionsWithoutMetrics(t *testing.T) {
	setupModelStatusTestDB(t)

	result, err := QueryModelStatus(ModelStatusQueryParams{Hours: 24, Groups: []string{"default"}})
	require.NoError(t, err)
	assert.Empty(t, result.Models)
	assert.Empty(t, result.Providers)
	assert.Empty(t, result.LastUpdated)
}

func requireModelStatusItem(t *testing.T, items []ModelStatusItem, channelType int, modelName string) ModelStatusItem {
	t.Helper()
	for _, item := range items {
		if item.ChannelType == channelType && item.ModelName == modelName {
			return item
		}
	}
	require.Failf(t, "model status item missing", "channel_type=%d model=%s", channelType, modelName)
	return ModelStatusItem{}
}

func requireModelStatusProvider(t *testing.T, providers []ModelStatusProvider, channelType int) ModelStatusProvider {
	t.Helper()
	for _, provider := range providers {
		if provider.ChannelType == channelType {
			return provider
		}
	}
	require.Failf(t, "model status provider missing", "channel_type=%d", channelType)
	return ModelStatusProvider{}
}
