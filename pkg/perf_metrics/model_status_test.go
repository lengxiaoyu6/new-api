package perfmetrics

import (
	"fmt"
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
	hotBuckets = sync.Map{}
	model.InvalidatePricingCache()

	t.Cleanup(func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.RedisEnabled = oldRedisEnabled
		common.SetMainDatabaseType(oldMainDatabaseType)
		hotBuckets = sync.Map{}
		model.InvalidatePricingCache()
	})
}

type modelStatusCatalogFixture struct {
	OpenAIVendorID int
	ClaudeVendorID int
	IdleVendorID   int
	OpenAIProvider string
	ClaudeProvider string
	IdleProvider   string
}

func insertModelStatusCatalogFixture(t *testing.T) modelStatusCatalogFixture {
	t.Helper()

	vendors := []model.Vendor{
		{Name: "CatalogOpenAI", Status: 1},
		{Name: "CatalogClaude", Status: 1},
		{Name: "CatalogIdle", Status: 1},
	}
	require.NoError(t, model.DB.Create(&vendors).Error)

	models := []model.Model{
		{ModelName: "gpt-test", VendorID: vendors[0].Id, Status: 1, NameRule: model.NameRuleExact},
		{ModelName: "claude-test", VendorID: vendors[1].Id, Status: 1, NameRule: model.NameRuleExact},
		{ModelName: "idle-test", VendorID: vendors[2].Id, Status: 1, NameRule: model.NameRuleExact},
		{ModelName: "vip-only", VendorID: vendors[2].Id, Status: 1, NameRule: model.NameRuleExact},
	}
	require.NoError(t, model.DB.Create(&models).Error)

	channels := []model.Channel{
		{Type: constant.ChannelTypeOpenAI, Key: "openai-key", Status: 1, Name: "openai-channel"},
		{Type: constant.ChannelTypeAnthropic, Key: "anthropic-key", Status: 1, Name: "anthropic-channel"},
	}
	require.NoError(t, model.DB.Create(&channels).Error)

	abilities := []model.Ability{
		{Group: "default", Model: "gpt-test", ChannelId: channels[1].Id, Enabled: true},
		{Group: "vip", Model: "gpt-test", ChannelId: channels[1].Id, Enabled: true},
		{Group: "default", Model: "claude-test", ChannelId: channels[0].Id, Enabled: true},
		{Group: "default", Model: "idle-test", ChannelId: channels[0].Id, Enabled: true},
		{Group: "vip", Model: "idle-test", ChannelId: channels[0].Id, Enabled: true},
		{Group: "vip", Model: "vip-only", ChannelId: channels[0].Id, Enabled: true},
	}
	require.NoError(t, model.DB.Create(&abilities).Error)
	model.InvalidatePricingCache()

	return modelStatusCatalogFixture{
		OpenAIVendorID: vendors[0].Id,
		ClaudeVendorID: vendors[1].Id,
		IdleVendorID:   vendors[2].Id,
		OpenAIProvider: fmt.Sprintf("vendor:%d", vendors[0].Id),
		ClaudeProvider: fmt.Sprintf("vendor:%d", vendors[1].Id),
		IdleProvider:   fmt.Sprintf("vendor:%d", vendors[2].Id),
	}
}

func TestQueryModelStatusUsesCatalogVendorsAndMergesGroups(t *testing.T) {
	setupModelStatusTestDB(t)
	fixture := insertModelStatusCatalogFixture(t)

	currentBucket := bucketStart(time.Now().Unix())
	previousBucket := currentBucket - 600
	require.NoError(t, model.DB.Create([]model.PerfMetric{
		{
			ModelName:      "gpt-test",
			Group:          "default",
			ChannelType:    constant.ChannelTypeAnthropic,
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
			ChannelType:    constant.ChannelTypeAnthropic,
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
			ModelName:    "stale-test",
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
		channelType: constant.ChannelTypeOpenAI,
		bucketTs:    currentBucket,
	}, bucket)

	result, err := QueryModelStatus(ModelStatusQueryParams{Hours: 24, Groups: []string{"default", "vip"}})
	require.NoError(t, err)
	require.Len(t, result.Models, 4)
	require.Len(t, result.Providers, 3)
	assert.Equal(t, 24, result.WindowHours)
	assert.Equal(t, formatStatusTime(result.GeneratedAt), result.LastUpdated)
	assert.NotEmpty(t, result.LastUpdated)
	assert.False(t, hasModelStatusItem(result.Models, "stale-test"))

	openAIModel := requireModelStatusItem(t, result.Models, "gpt-test")
	assert.Equal(t, "CatalogOpenAI", openAIModel.Provider)
	assert.Equal(t, "CatalogOpenAI", openAIModel.ProviderName)
	assert.Equal(t, fixture.OpenAIProvider, openAIModel.ProviderID)
	assert.Equal(t, fixture.OpenAIVendorID, openAIModel.VendorID)
	assert.Equal(t, 0, openAIModel.ChannelType)
	assert.Equal(t, int64(120), openAIModel.FastestTtftMs)
	assert.Equal(t, int64(1500), openAIModel.SlowestTtftMs)
	assert.Equal(t, int64(10), openAIModel.RequestCount)
	assert.Equal(t, int64(5), openAIModel.TtftSampleCount)
	assert.InDelta(t, 90, openAIModel.SuccessRate, 0.001)
	assert.InDelta(t, openAIModel.SuccessRate, openAIModel.HealthScore, 0.001)
	assert.Equal(t, "degraded", openAIModel.Status)
	assert.Equal(t, formatStatusTime(previousBucket), openAIModel.LastUpdated)
	assert.Equal(t, []float64{90}, openAIModel.RecentSuccessRates)
	require.Len(t, openAIModel.Groups, 2)
	defaultGroup := requireModelStatusGroup(t, openAIModel.Groups, "default")
	assert.Equal(t, int64(6), defaultGroup.RequestCount)
	assert.Equal(t, "healthy", defaultGroup.Status)
	vipGroup := requireModelStatusGroup(t, openAIModel.Groups, "vip")
	assert.Equal(t, int64(4), vipGroup.RequestCount)
	assert.Equal(t, "down", vipGroup.Status)

	claudeModel := requireModelStatusItem(t, result.Models, "claude-test")
	assert.Equal(t, "CatalogClaude", claudeModel.Provider)
	assert.Equal(t, fixture.ClaudeProvider, claudeModel.ProviderID)
	assert.Equal(t, int64(90), claudeModel.FastestTtftMs)
	assert.Equal(t, int64(700), claudeModel.SlowestTtftMs)
	assert.Equal(t, int64(2), claudeModel.RequestCount)
	assert.Equal(t, "healthy", claudeModel.Status)
	assert.Equal(t, formatStatusTime(currentBucket), claudeModel.LastUpdated)
	assert.Equal(t, []float64{100}, claudeModel.RecentSuccessRates)

	idleModel := requireModelStatusItem(t, result.Models, "idle-test")
	assert.Equal(t, "CatalogIdle", idleModel.Provider)
	assert.Equal(t, fixture.IdleProvider, idleModel.ProviderID)
	assert.Equal(t, int64(0), idleModel.RequestCount)
	assert.Equal(t, int64(0), idleModel.FastestTtftMs)
	assert.Equal(t, int64(0), idleModel.SlowestTtftMs)
	assert.Equal(t, "unknown", idleModel.Status)
	assert.Empty(t, idleModel.RecentSuccessRates)
	require.Len(t, idleModel.Groups, 2)
	assert.Equal(t, "unknown", requireModelStatusGroup(t, idleModel.Groups, "default").Status)
	assert.Equal(t, "unknown", requireModelStatusGroup(t, idleModel.Groups, "vip").Status)

	openAIProvider := requireModelStatusProvider(t, result.Providers, fixture.OpenAIProvider)
	assert.Equal(t, "CatalogOpenAI", openAIProvider.Provider)
	assert.Equal(t, int64(10), openAIProvider.RequestCount)
	assert.Equal(t, int64(120), openAIProvider.FastestTtftMs)
	assert.Equal(t, int64(1500), openAIProvider.SlowestTtftMs)
	assert.Equal(t, "degraded", openAIProvider.Status)
	require.Len(t, openAIProvider.Models, 1)

	idleProvider := requireModelStatusProvider(t, result.Providers, fixture.IdleProvider)
	assert.Equal(t, "CatalogIdle", idleProvider.Provider)
	assert.Equal(t, int64(0), idleProvider.RequestCount)
	assert.Equal(t, "unknown", idleProvider.Status)
	require.Len(t, idleProvider.Models, 2)
}

func TestQueryModelStatusAppliesGroupFilterToCatalogGroups(t *testing.T) {
	setupModelStatusTestDB(t)
	insertModelStatusCatalogFixture(t)

	bucketTs := bucketStart(time.Now().Unix()) - 600
	require.NoError(t, model.DB.Create([]model.PerfMetric{
		{
			ModelName:    "gpt-test",
			Group:        "default",
			ChannelType:  constant.ChannelTypeOpenAI,
			BucketTs:     bucketTs,
			RequestCount: 1,
			SuccessCount: 1,
		},
		{
			ModelName:    "gpt-test",
			Group:        "vip",
			ChannelType:  constant.ChannelTypeOpenAI,
			BucketTs:     bucketTs,
			RequestCount: 9,
			SuccessCount: 0,
		},
	}).Error)

	result, err := QueryModelStatus(ModelStatusQueryParams{Hours: 24, Groups: []string{"default"}})
	require.NoError(t, err)
	assert.False(t, hasModelStatusItem(result.Models, "vip-only"))

	item := requireModelStatusItem(t, result.Models, "gpt-test")
	require.Len(t, item.Groups, 1)
	assert.Equal(t, "default", item.Groups[0].Group)
	assert.Equal(t, int64(1), item.RequestCount)
	assert.Equal(t, "healthy", item.Status)
}

func TestQueryModelStatusReturnsEmptyCollectionsWithoutCatalogModels(t *testing.T) {
	setupModelStatusTestDB(t)

	result, err := QueryModelStatus(ModelStatusQueryParams{Hours: 24, Groups: []string{"default"}})
	require.NoError(t, err)
	assert.Empty(t, result.Models)
	assert.Empty(t, result.Providers)
	assert.Equal(t, formatStatusTime(result.GeneratedAt), result.LastUpdated)
	assert.NotEmpty(t, result.LastUpdated)
}

func TestStatusTrendRatesOrdersByTimeAndDownsamplesEvenly(t *testing.T) {
	buckets := make(map[int64]counters)
	for i := int64(0); i < 10; i++ {
		// requestCount 10, successCount increments → rates 10, 20, ... 100.
		buckets[1000+i*600] = counters{requestCount: 10, successCount: i + 1}
	}

	all := statusTrendRates(buckets, 0)
	assert.Nil(t, all)

	full := statusTrendRates(buckets, 20)
	require.Len(t, full, 10)
	assert.Equal(t, 10.0, full[0])
	assert.Equal(t, 100.0, full[9])

	downsampled := statusTrendRates(buckets, 4)
	require.Len(t, downsampled, 4)
	assert.Equal(t, 10.0, downsampled[0])
	assert.Equal(t, 100.0, downsampled[3])

	assert.Nil(t, statusTrendRates(nil, 4))
}

func requireModelStatusItem(t *testing.T, items []ModelStatusItem, modelName string) ModelStatusItem {
	t.Helper()
	for _, item := range items {
		if item.ModelName == modelName {
			return item
		}
	}
	require.Failf(t, "model status item missing", "model=%s", modelName)
	return ModelStatusItem{}
}

func hasModelStatusItem(items []ModelStatusItem, modelName string) bool {
	for _, item := range items {
		if item.ModelName == modelName {
			return true
		}
	}
	return false
}

func requireModelStatusGroup(t *testing.T, groups []ModelStatusGroup, groupName string) ModelStatusGroup {
	t.Helper()
	for _, group := range groups {
		if group.Group == groupName {
			return group
		}
	}
	require.Failf(t, "model status group missing", "group=%s", groupName)
	return ModelStatusGroup{}
}

func requireModelStatusProvider(t *testing.T, providers []ModelStatusProvider, providerID string) ModelStatusProvider {
	t.Helper()
	for _, provider := range providers {
		if provider.ProviderID == providerID {
			return provider
		}
	}
	require.Failf(t, "model status provider missing", "provider_id=%s", providerID)
	return ModelStatusProvider{}
}
