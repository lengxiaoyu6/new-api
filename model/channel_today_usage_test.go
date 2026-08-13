package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedTodayUsageLog(t *testing.T, log Log) {
	t.Helper()
	require.NoError(t, LOG_DB.Create(&log).Error)
}

func TestGetTodayChannelQuotaAggregatesConsumeLogsByChannel(t *testing.T) {
	truncateTables(t)

	const dayStart int64 = 1_700_000_000
	seedTodayUsageLog(t, Log{CreatedAt: dayStart + 10, Type: LogTypeConsume, ChannelId: 1, Quota: 100})
	seedTodayUsageLog(t, Log{CreatedAt: dayStart + 20, Type: LogTypeConsume, ChannelId: 1, Quota: 50})
	seedTodayUsageLog(t, Log{CreatedAt: dayStart + 30, Type: LogTypeConsume, ChannelId: 2, Quota: 300})

	usage, err := GetTodayChannelQuota(dayStart)
	require.NoError(t, err)

	require.Len(t, usage, 2)
	assert.Equal(t, int64(150), usage[1])
	assert.Equal(t, int64(300), usage[2])
}

func TestGetTodayChannelQuotaIgnoresOtherTypesBeforeStartAndZeroChannel(t *testing.T) {
	truncateTables(t)

	const dayStart int64 = 1_700_000_000
	seedTodayUsageLog(t, Log{CreatedAt: dayStart + 10, Type: LogTypeConsume, ChannelId: 1, Quota: 100})
	seedTodayUsageLog(t, Log{CreatedAt: dayStart - 10, Type: LogTypeConsume, ChannelId: 1, Quota: 999})
	seedTodayUsageLog(t, Log{CreatedAt: dayStart + 20, Type: LogTypeTopup, ChannelId: 1, Quota: 999})
	seedTodayUsageLog(t, Log{CreatedAt: dayStart + 30, Type: LogTypeConsume, ChannelId: 0, Quota: 999})

	usage, err := GetTodayChannelQuota(dayStart)
	require.NoError(t, err)

	require.Len(t, usage, 1)
	assert.Equal(t, int64(100), usage[1])
}

func TestGetTodayChannelQuotaReturnsEmptyMapWithoutLogs(t *testing.T) {
	truncateTables(t)

	usage, err := GetTodayChannelQuota(1_700_000_000)
	require.NoError(t, err)

	assert.Empty(t, usage)
}
