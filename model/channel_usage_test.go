package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedChannelUsageLog(t *testing.T, log Log) {
	t.Helper()
	require.NoError(t, LOG_DB.Create(&log).Error)
}

func TestGetChannelQuotaBetweenAggregatesConsumeLogsByChannel(t *testing.T) {
	truncateTables(t)

	const dayStart int64 = 1_700_000_000
	seedChannelUsageLog(t, Log{CreatedAt: dayStart + 10, Type: LogTypeConsume, ChannelId: 1, Quota: 100})
	seedChannelUsageLog(t, Log{CreatedAt: dayStart + 20, Type: LogTypeConsume, ChannelId: 1, Quota: 50})
	seedChannelUsageLog(t, Log{CreatedAt: dayStart + 30, Type: LogTypeConsume, ChannelId: 2, Quota: 300})

	usage, err := GetChannelQuotaBetween(dayStart, 0)
	require.NoError(t, err)

	require.Len(t, usage, 2)
	assert.Equal(t, int64(150), usage[1])
	assert.Equal(t, int64(300), usage[2])
}

func TestGetChannelQuotaBetweenHonorsTimeBounds(t *testing.T) {
	truncateTables(t)

	const dayStart int64 = 1_700_000_000
	seedChannelUsageLog(t, Log{CreatedAt: dayStart - 1, Type: LogTypeConsume, ChannelId: 1, Quota: 999})
	seedChannelUsageLog(t, Log{CreatedAt: dayStart + 10, Type: LogTypeConsume, ChannelId: 1, Quota: 100})
	seedChannelUsageLog(t, Log{CreatedAt: dayStart + 30, Type: LogTypeConsume, ChannelId: 1, Quota: 999})

	usage, err := GetChannelQuotaBetween(dayStart, dayStart+20)
	require.NoError(t, err)

	require.Len(t, usage, 1)
	assert.Equal(t, int64(100), usage[1])
}

func TestGetChannelQuotaBetweenIgnoresOtherTypesAndZeroChannel(t *testing.T) {
	truncateTables(t)

	const dayStart int64 = 1_700_000_000
	seedChannelUsageLog(t, Log{CreatedAt: dayStart + 10, Type: LogTypeConsume, ChannelId: 1, Quota: 100})
	seedChannelUsageLog(t, Log{CreatedAt: dayStart + 20, Type: LogTypeTopup, ChannelId: 1, Quota: 999})
	seedChannelUsageLog(t, Log{CreatedAt: dayStart + 30, Type: LogTypeConsume, ChannelId: 0, Quota: 999})

	usage, err := GetChannelQuotaBetween(dayStart, 0)
	require.NoError(t, err)

	require.Len(t, usage, 1)
	assert.Equal(t, int64(100), usage[1])
}

func TestGetChannelQuotaBetweenReturnsEmptyMapWithoutLogs(t *testing.T) {
	truncateTables(t)

	usage, err := GetChannelQuotaBetween(1_700_000_000, 1_700_086_400)
	require.NoError(t, err)

	assert.Empty(t, usage)
}
