package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type legacyPerfMetric struct {
	Id             int    `gorm:"primaryKey"`
	ModelName      string `gorm:"size:128;uniqueIndex:idx_perf_model_group_bucket,priority:1"`
	Group          string `gorm:"column:group;size:64;uniqueIndex:idx_perf_model_group_bucket,priority:2"`
	BucketTs       int64  `gorm:"uniqueIndex:idx_perf_model_group_bucket,priority:3"`
	RequestCount   int64  `gorm:"default:0"`
	SuccessCount   int64  `gorm:"default:0"`
	TotalLatencyMs int64  `gorm:"default:0"`
	TtftSumMs      int64  `gorm:"default:0"`
	TtftCount      int64  `gorm:"default:0"`
	OutputTokens   int64  `gorm:"default:0"`
	GenerationMs   int64  `gorm:"default:0"`
}

func (legacyPerfMetric) TableName() string {
	return "perf_metrics"
}

func usePerfMetricTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	oldDB := DB
	oldLogDB := LOG_DB
	oldMainDatabaseType := common.MainDatabaseType()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	LOG_DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		DB = oldDB
		LOG_DB = oldLogDB
		common.SetMainDatabaseType(oldMainDatabaseType)
	})
	return db
}

func TestUpsertPerfMetricUsesChannelTypeAndMergesTtftBounds(t *testing.T) {
	db := usePerfMetricTestDB(t)
	require.NoError(t, db.AutoMigrate(&PerfMetric{}))
	require.NoError(t, migratePerfMetricIndexes())

	bucketTs := time.Now().Unix()
	require.NoError(t, UpsertPerfMetric(&PerfMetric{
		ModelName:      "gpt-test",
		Group:          "default",
		ChannelType:    constant.ChannelTypeOpenAI,
		BucketTs:       bucketTs,
		RequestCount:   3,
		SuccessCount:   2,
		TotalLatencyMs: 3000,
		TtftSumMs:      1200,
		TtftCount:      2,
		FastestTtftMs:  300,
		SlowestTtftMs:  900,
	}))
	require.NoError(t, UpsertPerfMetric(&PerfMetric{
		ModelName:      "gpt-test",
		Group:          "default",
		ChannelType:    constant.ChannelTypeOpenAI,
		BucketTs:       bucketTs,
		RequestCount:   2,
		SuccessCount:   2,
		TotalLatencyMs: 2000,
		TtftSumMs:      200,
		TtftCount:      1,
		FastestTtftMs:  200,
		SlowestTtftMs:  1200,
	}))
	require.NoError(t, UpsertPerfMetric(&PerfMetric{
		ModelName:      "gpt-test",
		Group:          "default",
		ChannelType:    constant.ChannelTypeOpenAI,
		BucketTs:       bucketTs,
		RequestCount:   1,
		SuccessCount:   1,
		TotalLatencyMs: 1000,
	}))
	require.NoError(t, UpsertPerfMetric(&PerfMetric{
		ModelName:    "gpt-test",
		Group:        "default",
		ChannelType:  constant.ChannelTypeAnthropic,
		BucketTs:     bucketTs,
		RequestCount: 1,
		SuccessCount: 1,
	}))

	var openAI PerfMetric
	require.NoError(t, db.Where("model_name = ? AND channel_type = ?", "gpt-test", constant.ChannelTypeOpenAI).First(&openAI).Error)
	assert.Equal(t, int64(6), openAI.RequestCount)
	assert.Equal(t, int64(5), openAI.SuccessCount)
	assert.Equal(t, int64(6000), openAI.TotalLatencyMs)
	assert.Equal(t, int64(1400), openAI.TtftSumMs)
	assert.Equal(t, int64(3), openAI.TtftCount)
	assert.Equal(t, int64(200), openAI.FastestTtftMs)
	assert.Equal(t, int64(1200), openAI.SlowestTtftMs)

	var count int64
	require.NoError(t, db.Model(&PerfMetric{}).Where("model_name = ?", "gpt-test").Count(&count).Error)
	assert.Equal(t, int64(2), count)
}

func TestMigratePerfMetricIndexesReplacesLegacyUniqueIndex(t *testing.T) {
	db := usePerfMetricTestDB(t)
	require.NoError(t, db.AutoMigrate(&legacyPerfMetric{}))
	migrator := db.Migrator()
	require.True(t, migrator.HasIndex(&PerfMetric{}, "idx_perf_model_group_bucket"))

	require.NoError(t, db.AutoMigrate(&PerfMetric{}))
	require.NoError(t, migratePerfMetricIndexes())
	assert.False(t, migrator.HasIndex(&PerfMetric{}, "idx_perf_model_group_bucket"))
	assert.True(t, migrator.HasIndex(&PerfMetric{}, "idx_perf_model_group_channel_bucket"))

	bucketTs := time.Now().Unix()
	require.NoError(t, db.Create(&PerfMetric{
		ModelName:    "gpt-test",
		Group:        "default",
		ChannelType:  constant.ChannelTypeOpenAI,
		BucketTs:     bucketTs,
		RequestCount: 1,
	}).Error)
	require.NoError(t, db.Create(&PerfMetric{
		ModelName:    "gpt-test",
		Group:        "default",
		ChannelType:  constant.ChannelTypeAnthropic,
		BucketTs:     bucketTs,
		RequestCount: 1,
	}).Error)
}
