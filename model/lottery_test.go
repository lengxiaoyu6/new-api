package model

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func lotteryTestUser(t *testing.T, quota int) User {
	t.Helper()
	user := User{Username: "lottery-" + common.GetRandomString(8), AffCode: common.GetRandomString(12), Password: "unused", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, Quota: quota}
	require.NoError(t, DB.Create(&user).Error)
	return user
}

func lotteryTestActivity(t *testing.T, now time.Time) (*LotteryActivity, LotteryVersion, []LotteryPrize) {
	t.Helper()
	activity := &LotteryActivity{Name: "lottery-" + common.GetRandomString(8), StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(time.Hour).Unix(), ConsumeStartAt: now.Add(-24 * time.Hour).Unix(), ConsumeEndAt: now.Add(24 * time.Hour).Unix(), Status: LotteryActivityActive, MaxAttempts: LotteryMaxAttempts}
	require.NoError(t, DB.Create(activity).Error)
	prizes := []LotteryPrize{
		{ActivityId: activity.Id, Code: "balance-2-" + common.GetRandomString(5), Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2, TotalStock: 10},
		{ActivityId: activity.Id, Code: "again-" + common.GetRandomString(5), Type: LotteryPrizeAgain},
		{ActivityId: activity.Id, Code: "thanks-" + common.GetRandomString(5), Type: LotteryPrizeThanks},
	}
	for i := range prizes {
		require.NoError(t, DB.Create(&prizes[i]).Error)
	}
	version := LotteryVersion{ActivityId: activity.Id, BusinessDate: LotteryBusinessDate(now), Status: LotteryVersionPublished, ThresholdQuota: 100, QuotaPerUnit: 1, Title: LotteryLocalizedText{"en": "Daily draw"}}
	require.NoError(t, DB.Create(&version).Error)
	weights := []int64{300000, 300000, 400000}
	for i := range prizes {
		require.NoError(t, DB.Create(&LotteryVersionPrize{VersionId: version.Id, PrizeId: prizes[i].Id, Weight: weights[i], DailyLimit: 0, SortOrder: i, Enabled: true}).Error)
	}
	return activity, version, prizes
}

func TestLotteryBusinessDateUsesShanghai(t *testing.T) {
	utc := time.Date(2026, 1, 1, 16, 30, 0, 0, time.UTC)
	assert.Equal(t, "2026-01-02", LotteryBusinessDate(utc))
}

func TestChooseLotteryPrizeUsesHalfOpenRanges(t *testing.T) {
	items := []LotteryVersionPrizeView{
		{LotteryVersionPrize: LotteryVersionPrize{Weight: 2}, Prize: LotteryPrize{Id: 1}},
		{LotteryVersionPrize: LotteryVersionPrize{Weight: 3}, Prize: LotteryPrize{Id: 2}},
	}
	got, start, end, err := chooseLotteryPrize(items, 2)
	require.NoError(t, err)
	assert.Equal(t, 2, got.Prize.Id)
	assert.EqualValues(t, 2, start)
	assert.EqualValues(t, 5, end)
}

func TestNormalizeLotteryPrizeDefinitionDerivesBalanceQuota(t *testing.T) {
	prize := LotteryPrize{ActivityId: 1, Code: " balance-2 ", Type: LotteryPrizeBalance, BalanceAmount: 2, TotalStock: 10}
	require.NoError(t, NormalizeLotteryPrizeDefinition(&prize, 500000))
	assert.Equal(t, "balance-2", prize.Code)
	assert.EqualValues(t, 1_000_000, prize.BalanceQuota)

	prize.BalanceQuota++
	assert.ErrorIs(t, NormalizeLotteryPrizeDefinition(&prize, 500000), ErrLotteryInvalidConfig)
}

func TestDrawLotteryIsIdempotentAndSecondAgainBecomesThanks(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, _, prizes := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 0)
	require.NoError(t, DB.Create(&Log{UserId: user.Id, CreatedAt: now.Add(-time.Second).Unix(), Type: LogTypeConsume, Quota: 100, Other: `{"billing_source":"wallet"}`}).Error)

	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	lotteryRandomSource = func() (int64, error) { return 350000, nil }
	first, err := DrawLottery(activity.Id, user.Id, "first", now)
	require.NoError(t, err)
	assert.Equal(t, LotteryPrizeAgain, first.Prize.Type)
	assert.Equal(t, 1, first.Draw.AttemptNo)
	assert.Equal(t, LotteryRandomAlgorithm, first.Draw.RandomAlgorithm)

	lotteryRandomSource = func() (int64, error) { return 350000, nil }
	second, err := DrawLottery(activity.Id, user.Id, "second", now)
	require.NoError(t, err)
	assert.Equal(t, LotteryPrizeThanks, second.Prize.Type)
	assert.Equal(t, "extra_attempt_limit", second.Draw.ConversionReason)
	assert.Equal(t, 2, second.Draw.AttemptNo)

	reused, err := DrawLottery(activity.Id, user.Id, "second", now)
	require.NoError(t, err)
	assert.True(t, reused.Reused)
	assert.Equal(t, second.Draw.Id, reused.Draw.Id)

	var participation LotteryParticipation
	require.NoError(t, DB.Where("activity_id = ? AND user_id = ?", activity.Id, user.Id).First(&participation).Error)
	assert.Equal(t, 1, participation.ExtraGranted)
	assert.Equal(t, 1, participation.ExtraUsed)
	assert.NotEqual(t, prizes[0].Id, second.Draw.FinalPrizeId)
}

func TestDrawLotteryCreditsBalanceAndConsumesStock(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, _, prizes := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 10)
	require.NoError(t, DB.Create(&Log{UserId: user.Id, CreatedAt: now.Add(-time.Second).Unix(), Type: LogTypeConsume, Quota: 100, Other: `{"billing_source":"wallet"}`}).Error)
	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	lotteryRandomSource = func() (int64, error) { return 0, nil }
	result, err := DrawLottery(activity.Id, user.Id, "balance", now)
	require.NoError(t, err)
	assert.Equal(t, prizes[0].Id, result.Draw.FinalPrizeId)
	require.NotNil(t, result.Award)
	var userRow User
	require.NoError(t, DB.First(&userRow, user.Id).Error)
	assert.Equal(t, 12, userRow.Quota)
	var prize LotteryPrize
	require.NoError(t, DB.First(&prize, prizes[0].Id).Error)
	assert.EqualValues(t, 1, prize.IssuedStock)
	var daily LotteryPrizeDailyStock
	require.NoError(t, DB.Where("prize_id = ?", prizes[0].Id).First(&daily).Error)
	assert.EqualValues(t, 1, daily.Issued)

	var awardLog Log
	require.NoError(t, LOG_DB.Where("user_id = ? AND type = ?", user.Id, LogTypeTopup).First(&awardLog).Error)
	assert.Equal(t, result.Award.CreatedAt, awardLog.CreatedAt)
	assert.EqualValues(t, result.Award.Quota, awardLog.Quota)
	assert.Equal(t, fmt.Sprintf("lottery-award-%d", result.Award.Id), awardLog.RequestId)
	assert.Contains(t, awardLog.Content, "抽奖余额奖励到账")
	assert.JSONEq(t, fmt.Sprintf(`{"lottery_activity_id":%d,"lottery_draw_id":%d,"lottery_award_id":%d,"lottery_prize_id":%d}`, activity.Id, result.Draw.Id, result.Award.Id, prizes[0].Id), awardLog.Other)

	reused, err := DrawLottery(activity.Id, user.Id, "balance", now)
	require.NoError(t, err)
	assert.True(t, reused.Reused)
	var awardLogCount int64
	require.NoError(t, LOG_DB.Model(&Log{}).Where("user_id = ? AND type = ?", user.Id, LogTypeTopup).Count(&awardLogCount).Error)
	assert.EqualValues(t, 1, awardLogCount)
}

func TestDrawLotteryReusesLatestResultAfterAttemptsAreUsed(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, _, _ := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 0)
	require.NoError(t, DB.Create(&Log{UserId: user.Id, CreatedAt: now.Add(-time.Second).Unix(), Type: LogTypeConsume, Quota: 100, Other: `{"billing_source":"wallet"}`}).Error)
	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	lotteryRandomSource = func() (int64, error) { return 350000, nil }
	_, err := DrawLottery(activity.Id, user.Id, "first", now)
	require.NoError(t, err)
	_, err = DrawLottery(activity.Id, user.Id, "second", now)
	require.NoError(t, err)
	third, err := DrawLottery(activity.Id, user.Id, "third", now)
	require.NoError(t, err)
	assert.True(t, third.Reused)
	assert.Equal(t, 2, third.Draw.AttemptNo)

	var draws int64
	require.NoError(t, DB.Model(&LotteryDraw{}).Where("activity_id = ? AND user_id = ?", activity.Id, user.Id).Count(&draws).Error)
	assert.EqualValues(t, 2, draws)
}

func TestDrawLotteryConvertsUnavailableBalancePrizeToThanks(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, _, prizes := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 0)
	require.NoError(t, DB.Create(&Log{UserId: user.Id, CreatedAt: now.Add(-time.Second).Unix(), Type: LogTypeConsume, Quota: 100, Other: `{"billing_source":"wallet"}`}).Error)
	require.NoError(t, DB.Model(&LotteryPrize{}).Where("id = ?", prizes[0].Id).Update("total_stock", 0).Error)
	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	lotteryRandomSource = func() (int64, error) { return 0, nil }
	result, err := DrawLottery(activity.Id, user.Id, "empty-stock", now)
	require.NoError(t, err)
	assert.Equal(t, LotteryPrizeThanks, result.Prize.Type)
	var draw LotteryDraw
	require.NoError(t, DB.First(&draw, result.Draw.Id).Error)
	assert.Equal(t, "stock_unavailable", draw.ConversionReason)
}

func TestDrawLotteryWalletLimitRollsBackTransaction(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, _, prizes := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 1)
	require.NoError(t, DB.Create(&Log{UserId: user.Id, CreatedAt: now.Add(-time.Second).Unix(), Type: LogTypeConsume, Quota: 100, Other: `{"billing_source":"wallet"}`}).Error)
	require.NoError(t, DB.Model(&LotteryPrize{}).Where("id = ?", prizes[0].Id).Updates(map[string]any{"balance_amount": float64(common.MaxWalletQuota), "balance_quota": common.MaxWalletQuota}).Error)
	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	lotteryRandomSource = func() (int64, error) { return 0, nil }
	_, err := DrawLottery(activity.Id, user.Id, "wallet-limit", now)
	assert.ErrorIs(t, err, ErrLotteryWalletLimit)
	var prize LotteryPrize
	require.NoError(t, DB.First(&prize, prizes[0].Id).Error)
	assert.Zero(t, prize.IssuedStock)
	var userRow User
	require.NoError(t, DB.First(&userRow, user.Id).Error)
	assert.Equal(t, 1, userRow.Quota)
	var draws int64
	require.NoError(t, DB.Model(&LotteryDraw{}).Where("activity_id = ? AND user_id = ?", activity.Id, user.Id).Count(&draws).Error)
	assert.Zero(t, draws)
}

func TestCalculateLotteryConsumptionSubtractsRefundsAndSkipsSubscriptionUsage(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	user := lotteryTestUser(t, 0)
	start := now.Add(-time.Hour).Unix()
	accepted := now.Unix()
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, CreatedAt: start + 10, Type: LogTypeConsume, Quota: 100, RequestId: "wallet-request", Other: `{"billing_source":"wallet"}`}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, CreatedAt: start + 20, Type: LogTypeRefund, Quota: 40, RequestId: "refund-request", Other: `{"task_id":"wallet-task"}`}).Error)
	// A refund linked by task_id must reduce the matching consume record.
	require.NoError(t, LOG_DB.Model(&Log{}).Where("request_id = ?", "wallet-request").Update("other", `{"billing_source":"wallet","task_id":"wallet-task"}`).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, CreatedAt: start + 30, Type: LogTypeConsume, Quota: 900, RequestId: "subscription-request", Other: `{"billing_source":"subscription"}`}).Error)
	require.NoError(t, DB.Create(&SubscriptionOrder{UserId: user.Id, Money: 1, PaymentMethod: "stripe", Status: common.TopUpStatusSuccess, CompleteTime: start + 40}).Error)

	got, err := calculateLotteryConsumption(user.Id, start, now.Add(time.Hour).Unix(), accepted)
	require.NoError(t, err)
	assert.EqualValues(t, 500060, got)
}

func TestCalculateLotteryConsumptionSubtractsRefundBeforeDrawAfterSpendWindow(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	user := lotteryTestUser(t, 0)
	start := now.Add(-2 * time.Hour).Unix()
	spendEnd := now.Add(-time.Hour).Unix()
	accepted := now.Unix()
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, CreatedAt: start + 10, Type: LogTypeConsume, Quota: 100, RequestId: "windowed-request", Other: `{"billing_source":"wallet","task_id":"windowed-task"}`}).Error)
	// The refund is after the configured spend window but before the draw is
	// accepted, so it must still reduce the current qualification.
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, CreatedAt: spendEnd + 10, Type: LogTypeRefund, Quota: 40, RequestId: "windowed-refund", Other: `{"task_id":"windowed-task"}`}).Error)

	got, err := calculateLotteryConsumption(user.Id, start, spendEnd, accepted)
	require.NoError(t, err)
	assert.EqualValues(t, 60, got)
}

func TestCalculateLotteryConsumptionSkipsFailedSettlementLogs(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	user := lotteryTestUser(t, 0)
	start := now.Add(-time.Hour).Unix()
	accepted := now.Unix()
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, CreatedAt: start + 10, Type: LogTypeConsume, Quota: 100, Other: `{"settlement_failed":true}`}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, CreatedAt: start + 20, Type: LogTypeConsume, Quota: 60, Other: `{"settlement_status":"success"}`}).Error)

	got, err := calculateLotteryConsumption(user.Id, start, now.Add(time.Hour).Unix(), accepted)
	require.NoError(t, err)
	assert.EqualValues(t, 60, got)
}

func TestLotteryPrizeCodesAreUniqueWithinActivity(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	first := &LotteryActivity{Name: "lottery-first-" + common.GetRandomString(8), StartAt: now.Unix(), EndAt: now.Add(time.Hour).Unix(), ConsumeStartAt: now.Add(-time.Hour).Unix(), ConsumeEndAt: now.Add(time.Hour).Unix(), MaxAttempts: 2}
	require.NoError(t, CreateLotteryActivity(first))
	second := &LotteryActivity{Name: "lottery-second-" + common.GetRandomString(8), StartAt: now.Unix(), EndAt: now.Add(time.Hour).Unix(), ConsumeStartAt: now.Add(-time.Hour).Unix(), ConsumeEndAt: now.Add(time.Hour).Unix(), MaxAttempts: 2}
	require.NoError(t, CreateLotteryActivity(second))
	firstPrize := LotteryPrize{ActivityId: first.Id, Code: "balance", Type: LotteryPrizeBalance, BalanceAmount: 1, BalanceQuota: 1, TotalStock: 1}
	duplicatePrize := LotteryPrize{ActivityId: first.Id, Code: "balance", Type: LotteryPrizeBalance, BalanceAmount: 1, BalanceQuota: 1, TotalStock: 1}
	secondPrize := LotteryPrize{ActivityId: second.Id, Code: "balance", Type: LotteryPrizeBalance, BalanceAmount: 1, BalanceQuota: 1, TotalStock: 1}
	require.NoError(t, DB.Create(&firstPrize).Error)
	assert.Error(t, DB.Create(&duplicatePrize).Error)
	assert.NoError(t, DB.Create(&secondPrize).Error)
}

func TestCreateLotteryVersionStoresPrizeLinks(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity := &LotteryActivity{
		Name:           "lottery-version-" + common.GetRandomString(8),
		StartAt:        now.Add(time.Hour).Unix(),
		EndAt:          now.Add(48 * time.Hour).Unix(),
		ConsumeStartAt: now.Add(-time.Hour).Unix(),
		ConsumeEndAt:   now.Add(24 * time.Hour).Unix(),
		MaxAttempts:    LotteryMaxAttempts,
	}
	require.NoError(t, CreateLotteryActivity(activity))
	prizes := []LotteryPrize{
		{ActivityId: activity.Id, Code: "version-balance-" + common.GetRandomString(5), Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2, TotalStock: 1},
		{ActivityId: activity.Id, Code: "version-again-" + common.GetRandomString(5), Type: LotteryPrizeAgain},
		{ActivityId: activity.Id, Code: "version-thanks-" + common.GetRandomString(5), Type: LotteryPrizeThanks},
	}
	for i := range prizes {
		require.NoError(t, DB.Create(&prizes[i]).Error)
	}
	version := &LotteryVersion{
		ActivityId:     activity.Id,
		BusinessDate:   LotteryBusinessDate(now.Add(24 * time.Hour)),
		ThresholdQuota: 0,
		QuotaPerUnit:   1,
	}
	items := make([]LotteryVersionPrizeView, 0, len(prizes))
	weights := []int64{300000, 300000, 400000}
	for i := range prizes {
		items = append(items, LotteryVersionPrizeView{
			LotteryVersionPrize: LotteryVersionPrize{Weight: weights[i], SortOrder: i, Enabled: true},
			Prize:               prizes[i],
		})
	}
	require.NoError(t, CreateLotteryVersion(version, items))

	var links []LotteryVersionPrize
	require.NoError(t, DB.Where("version_id = ?", version.Id).Order("sort_order asc").Find(&links).Error)
	require.Len(t, links, len(prizes))
	for i := range links {
		assert.Equal(t, prizes[i].Id, links[i].PrizeId)
	}
}

func TestInitialLotteryConfigurationCanBePublishedAfterActivityStart(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity := &LotteryActivity{
		Name:           "started-draft-" + common.GetRandomString(8),
		StartAt:        now.Add(-time.Hour).Unix(),
		EndAt:          now.Add(24 * time.Hour).Unix(),
		ConsumeStartAt: now.Add(-2 * time.Hour).Unix(),
		ConsumeEndAt:   now.Add(24 * time.Hour).Unix(),
		MaxAttempts:    LotteryMaxAttempts,
	}
	require.NoError(t, CreateLotteryActivity(activity))
	prizes := []LotteryPrize{
		{ActivityId: activity.Id, Code: "started-balance", Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2, TotalStock: 0},
		{ActivityId: activity.Id, Code: "started-thanks", Type: LotteryPrizeThanks},
	}
	for i := range prizes {
		require.NoError(t, DB.Create(&prizes[i]).Error)
	}
	version := &LotteryVersion{ActivityId: activity.Id, ThresholdQuota: 0, QuotaPerUnit: 1}
	items := []LotteryVersionPrizeView{
		{LotteryVersionPrize: LotteryVersionPrize{Weight: 500_000, SortOrder: 0, Enabled: true}, Prize: prizes[0]},
		{LotteryVersionPrize: LotteryVersionPrize{Weight: 500_000, SortOrder: 1, Enabled: true}, Prize: prizes[1]},
	}

	require.NoError(t, CreateLotteryVersion(version, items))
	require.NoError(t, PublishLotteryVersion(version.Id, 42))
	nextVersion := &LotteryVersion{ActivityId: activity.Id, ThresholdQuota: 0, QuotaPerUnit: 1}
	assert.Error(t, CreateLotteryVersion(nextVersion, items))
	adjustment, err := AdjustLotteryStock(activity.Id, prizes[0].Id, 42, "started-stock", 10, "initial stock")
	require.NoError(t, err)
	assert.EqualValues(t, 10, adjustment.AfterStock)

	var stored LotteryActivity
	require.NoError(t, DB.First(&stored, activity.Id).Error)
	assert.Equal(t, LotteryActivityActive, stored.Status)
}

func TestDrawLotteryRejectsIdempotencyKeyAcrossActivities(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	firstActivity, firstVersion, prizes := lotteryTestActivity(t, now)
	secondActivity := &LotteryActivity{
		Name: "lottery-second-" + common.GetRandomString(8), StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(time.Hour).Unix(),
		ConsumeStartAt: now.Add(-24 * time.Hour).Unix(), ConsumeEndAt: now.Add(24 * time.Hour).Unix(), Status: LotteryActivityActive, MaxAttempts: LotteryMaxAttempts,
	}
	require.NoError(t, DB.Create(secondActivity).Error)
	secondVersion := LotteryVersion{ActivityId: secondActivity.Id, BusinessDate: LotteryBusinessDate(now), Status: LotteryVersionPublished, ThresholdQuota: firstVersion.ThresholdQuota, QuotaPerUnit: firstVersion.QuotaPerUnit}
	require.NoError(t, DB.Create(&secondVersion).Error)
	for i := range prizes {
		secondPrize := prizes[i]
		secondPrize.Id = 0
		secondPrize.ActivityId = secondActivity.Id
		secondPrize.Code = "second-" + secondPrize.Code
		secondPrize.IssuedStock = 0
		require.NoError(t, DB.Create(&secondPrize).Error)
		require.NoError(t, DB.Create(&LotteryVersionPrize{VersionId: secondVersion.Id, PrizeId: secondPrize.Id, Weight: []int64{300000, 300000, 400000}[i], SortOrder: i, Enabled: true}).Error)
	}
	user := lotteryTestUser(t, 0)
	require.NoError(t, DB.Create(&Log{UserId: user.Id, CreatedAt: now.Add(-time.Second).Unix(), Type: LogTypeConsume, Quota: 100, Other: `{"billing_source":"wallet"}`}).Error)
	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	randomValues := []int64{350000, 900000}
	lotteryRandomSource = func() (int64, error) {
		value := randomValues[0]
		randomValues = randomValues[1:]
		return value, nil
	}
	_, err := DrawLottery(firstActivity.Id, user.Id, "shared-key", now)
	require.NoError(t, err)
	_, err = DrawLottery(secondActivity.Id, user.Id, "shared-key", now)
	assert.ErrorIs(t, err, ErrLotteryIdempotencyConflict)
}

func TestDrawLotteryDisabledAccountCannotCreateResult(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, _, _ := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 0)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("status", common.UserStatusDisabled).Error)
	_, err := DrawLottery(activity.Id, user.Id, "disabled", now)
	assert.ErrorIs(t, err, ErrLotteryAccountUnavailable)
	var draws int64
	require.NoError(t, DB.Model(&LotteryDraw{}).Where("user_id = ?", user.Id).Count(&draws).Error)
	assert.Zero(t, draws)
}

func TestLotteryActivityViewUsesPublishedConfigurationAcrossBusinessDates(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, version, _ := lotteryTestActivity(t, now)
	require.NoError(t, DB.Model(&version).Update("business_date", LotteryBusinessDate(now.Add(-24*time.Hour))).Error)
	view, err := GetLotteryActivityView(activity.Id, 1, now)
	require.NoError(t, err)
	assert.Equal(t, version.Id, view.Version.Id)
	assert.NotEmpty(t, view.Prizes)
}

func TestPublishLotteryVersionAllowsSameDayActivityAndActivatesIt(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity := &LotteryActivity{
		Name:           "same-day-" + common.GetRandomString(8),
		StartAt:        now.Add(time.Hour).Unix(),
		EndAt:          now.Add(2 * time.Hour).Unix(),
		ConsumeStartAt: now.Add(-time.Hour).Unix(),
		ConsumeEndAt:   now.Add(2 * time.Hour).Unix(),
		MaxAttempts:    LotteryMaxAttempts,
	}
	require.NoError(t, CreateLotteryActivity(activity))
	prizes := []LotteryPrize{
		{ActivityId: activity.Id, Code: "same-day-balance", Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2, TotalStock: 10},
		{ActivityId: activity.Id, Code: "same-day-thanks", Type: LotteryPrizeThanks},
	}
	for i := range prizes {
		require.NoError(t, DB.Create(&prizes[i]).Error)
	}
	version := &LotteryVersion{
		ActivityId:     activity.Id,
		BusinessDate:   LotteryBusinessDate(now),
		ThresholdQuota: 0,
		QuotaPerUnit:   1,
	}
	items := []LotteryVersionPrizeView{
		{LotteryVersionPrize: LotteryVersionPrize{Weight: 500_000, Enabled: true}, Prize: prizes[0]},
		{LotteryVersionPrize: LotteryVersionPrize{Weight: 500_000, Enabled: true}, Prize: prizes[1]},
	}
	require.NoError(t, CreateLotteryVersion(version, items))
	require.NoError(t, PublishLotteryVersion(version.Id, 42))

	var stored LotteryActivity
	require.NoError(t, DB.First(&stored, activity.Id).Error)
	assert.Equal(t, LotteryActivityActive, stored.Status)

	require.NoError(t, DB.Model(&stored).Update("status", LotteryActivityDraft).Error)
	require.NoError(t, PublishLotteryVersion(version.Id, 43))
	require.NoError(t, DB.First(&stored, activity.Id).Error)
	assert.Equal(t, LotteryActivityActive, stored.Status)

	require.NoError(t, DB.Model(&stored).Update("status", LotteryActivityPaused).Error)
	require.NoError(t, PublishLotteryVersion(version.Id, 44))
	require.NoError(t, DB.First(&stored, activity.Id).Error)
	assert.Equal(t, LotteryActivityPaused, stored.Status)
}

func TestLotteryActivityViewDoesNotRecheckConsumptionForExtraAttempt(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, _, _ := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 0)
	require.NoError(t, DB.Create(&LotteryParticipation{
		ActivityId: activity.Id, UserId: user.Id, BusinessDate: LotteryBusinessDate(now),
		BaseUsed: true, ExtraGranted: 1, CreatedAt: now.Unix(), UpdatedAt: now.Unix(),
	}).Error)

	logDB := LOG_DB
	LOG_DB = nil
	t.Cleanup(func() { LOG_DB = logDB })
	view, err := GetLotteryActivityView(activity.Id, user.Id, now)
	require.NoError(t, err)
	assert.Equal(t, "extra_available", view.Status)
	assert.True(t, view.Qualification.Eligible)
}

func TestGetLotteryHistoryPageReturnsMetadataAndItems(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	activity, _, _ := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 0)
	require.NoError(t, DB.Create(&Log{UserId: user.Id, CreatedAt: now.Add(-time.Second).Unix(), Type: LogTypeConsume, Quota: 100, Other: `{"billing_source":"wallet"}`}).Error)
	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	randomValues := []int64{350000, 900000}
	lotteryRandomSource = func() (int64, error) {
		value := randomValues[0]
		randomValues = randomValues[1:]
		return value, nil
	}
	_, err := DrawLottery(activity.Id, user.Id, "history-1", now)
	require.NoError(t, err)
	_, err = DrawLottery(activity.Id, user.Id, "history-2", now)
	require.NoError(t, err)
	page, err := GetLotteryHistoryPage(activity.Id, user.Id, LotteryBusinessDate(now), 1, 1)
	require.NoError(t, err)
	assert.EqualValues(t, 2, page.Total)
	assert.Equal(t, 1, page.Page)
	assert.Equal(t, 1, page.PageSize)
	require.Len(t, page.Items, 1)
}

func TestGetLotteryUserHistoryPageIncludesDrawsFromAllActivities(t *testing.T) {
	truncateTables(t)
	now := time.Now()
	firstActivity, _, _ := lotteryTestActivity(t, now)
	secondActivity, _, _ := lotteryTestActivity(t, now)
	user := lotteryTestUser(t, 0)
	require.NoError(t, DB.Create(&Log{UserId: user.Id, CreatedAt: now.Add(-time.Second).Unix(), Type: LogTypeConsume, Quota: 100, Other: `{"billing_source":"wallet"}`}).Error)

	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	lotteryRandomSource = func() (int64, error) { return 350000, nil }
	_, err := DrawLottery(firstActivity.Id, user.Id, "all-history-first", now)
	require.NoError(t, err)
	_, err = DrawLottery(secondActivity.Id, user.Id, "all-history-second", now)
	require.NoError(t, err)

	page, err := GetLotteryUserHistoryPage(user.Id, LotteryBusinessDate(now), 1, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 2, page.Total)
	require.Len(t, page.Items, 2)
	assert.NotEqual(t, page.Items[0].Draw.ActivityId, page.Items[1].Draw.ActivityId)
}

func TestSubscriptionOrderQuotaPrefersCompletionSnapshot(t *testing.T) {
	order := SubscriptionOrder{Money: 2, PaymentMethod: "stripe", ChargedQuota: 123}
	quota, err := subscriptionOrderQuotaWithUnit(order, 999999)
	require.NoError(t, err)
	assert.EqualValues(t, 123, quota)
}

// TestLotteryMigrationMatrix covers upgrades, repeated migration, indexes,
// uniqueness, JSON values, and prize settlement on all supported databases.
func TestLotteryMigrationMatrix(t *testing.T) {
	tests := []struct {
		name      string
		env       string
		database  common.DatabaseType
		dialector func(string) gorm.Dialector
	}{
		{
			name: "sqlite", database: common.DatabaseTypeSQLite,
			dialector: func(string) gorm.Dialector { return sqlite.Open(":memory:") },
		},
		{
			name: "mysql", env: "TEST_MYSQL_DSN", database: common.DatabaseTypeMySQL,
			dialector: func(dsn string) gorm.Dialector {
				return mysqlMigrationDialector{mysql.Dialector{Config: &mysql.Config{DSN: dsn}}}
			},
		},
		{
			name: "postgresql", env: "TEST_POSTGRES_DSN", database: common.DatabaseTypePostgreSQL,
			dialector: func(dsn string) gorm.Dialector {
				return postgresMigrationDialector{postgres.Dialector{Config: &postgres.Config{DSN: dsn}}}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dsn := os.Getenv(test.env)
			if test.env != "" && dsn == "" {
				t.Skipf("%s is not configured", test.env)
			}
			db, err := gorm.Open(test.dialector(dsn), newGormConfig(false))
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			var databaseVersion string
			versionQuery := "SELECT VERSION()"
			if test.database == common.DatabaseTypeSQLite {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&databaseVersion).Error)
			t.Logf("database version: %s", databaseVersion)

			oldDB, oldLogDB := DB, LOG_DB
			oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(test.database, test.database)
			initCol()
			t.Cleanup(func() {
				DB, LOG_DB = oldDB, oldLogDB
				common.SetDatabaseTypes(oldMainType, oldLogType)
				initCol()
			})

			lotteryTables := []any{
				&LotteryAttemptGrant{},
				&LotteryPaymentUsage{},
				&LotteryStockAdjustment{}, &LotteryAward{}, &LotteryDraw{},
				&LotteryPrizeDailyStock{}, &LotteryParticipation{},
				&LotteryVersionPrize{}, &LotteryVersion{}, &LotteryPrize{},
				&LotteryActivity{},
			}
			for _, table := range lotteryTables {
				require.NoError(t, db.Migrator().DropTable(table))
			}

			// Representative latest-release structure: users and subscription
			// orders already exist while lottery tables and ChargedQuota do not.
			require.NoError(t, db.AutoMigrate(&User{}, &SubscriptionOrder{}, &TopUp{}, &Log{}))
			if db.Migrator().HasColumn(&SubscriptionOrder{}, "charged_quota") {
				require.NoError(t, db.Migrator().DropColumn(&SubscriptionOrder{}, "charged_quota"))
			}
			user := &User{Username: "lottery-upgrade-" + common.GetRandomString(8), Password: "unused", AffCode: common.GetRandomString(12), Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Quota: 17}
			require.NoError(t, db.Create(user).Error)

			migrationTables := append([]any{&SubscriptionOrder{}}, lotteryTables...)
			require.NoError(t, db.AutoMigrate(migrationTables...))
			require.NoError(t, migrateLotteryIndexes())

			var kept User
			require.NoError(t, db.First(&kept, user.Id).Error)
			assert.Equal(t, 17, kept.Quota)
			assert.True(t, db.Migrator().HasColumn(&SubscriptionOrder{}, "charged_quota"))

			activity := &LotteryActivity{Name: "matrix-" + test.name + "-" + common.GetRandomString(6), StartAt: 1, EndAt: 3, ConsumeStartAt: 1, ConsumeEndAt: 2, Status: LotteryActivityDraft, MaxAttempts: 2}
			require.NoError(t, db.Create(activity).Error)
			second := &LotteryActivity{Name: "matrix-second-" + test.name + "-" + common.GetRandomString(6), StartAt: 1, EndAt: 3, ConsumeStartAt: 1, ConsumeEndAt: 2, Status: LotteryActivityDraft, MaxAttempts: 2}
			require.NoError(t, db.Create(second).Error)
			prize := &LotteryPrize{ActivityId: activity.Id, Code: "balance", Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2, TotalStock: 10}
			require.NoError(t, db.Create(prize).Error)
			require.NoError(t, db.Create(&LotteryPrize{ActivityId: second.Id, Code: "balance", Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2, TotalStock: 10}).Error)
			duplicate := &LotteryPrize{ActivityId: activity.Id, Code: "balance", Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2, TotalStock: 10}
			assert.Error(t, db.Create(duplicate).Error)

			version := &LotteryVersion{ActivityId: activity.Id, BusinessDate: "2026-09-24", Revision: 1, Status: LotteryVersionPublished, Title: LotteryLocalizedText{"en": "Daily draw", "zh-CN": "每日抽奖"}, RuleText: LotteryLocalizedText{"en": "Rules"}, QuotaPerUnit: 1}
			require.NoError(t, db.Create(version).Error)
			var loaded LotteryVersion
			require.NoError(t, db.First(&loaded, version.Id).Error)
			assert.Equal(t, "每日抽奖", loaded.Title["zh-CN"])
			selected, err := findLotteryVersionTx(db, activity.Id)
			require.NoError(t, err)
			assert.Equal(t, version.Id, selected.Id)

			now := time.Now()
			startedActivity := &LotteryActivity{
				Name:           "matrix-started-" + test.name + "-" + common.GetRandomString(6),
				StartAt:        now.Add(-time.Hour).Unix(),
				EndAt:          now.Add(24 * time.Hour).Unix(),
				ConsumeStartAt: now.Add(-2 * time.Hour).Unix(),
				ConsumeEndAt:   now.Add(24 * time.Hour).Unix(),
				MaxAttempts:    LotteryMaxAttempts,
			}
			require.NoError(t, CreateLotteryActivity(startedActivity))
			startedPrizes := []LotteryPrize{
				{ActivityId: startedActivity.Id, Code: "started-balance", Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2},
				{ActivityId: startedActivity.Id, Code: "started-thanks", Type: LotteryPrizeThanks},
			}
			for i := range startedPrizes {
				require.NoError(t, db.Create(&startedPrizes[i]).Error)
			}
			startedVersion := &LotteryVersion{ActivityId: startedActivity.Id, QuotaPerUnit: 1}
			startedItems := []LotteryVersionPrizeView{
				{LotteryVersionPrize: LotteryVersionPrize{Weight: 500_000, SortOrder: 0, Enabled: true}, Prize: startedPrizes[0]},
				{LotteryVersionPrize: LotteryVersionPrize{Weight: 500_000, SortOrder: 1, Enabled: true}, Prize: startedPrizes[1]},
			}
			require.NoError(t, CreateLotteryVersion(startedVersion, startedItems))
			require.NoError(t, PublishLotteryVersion(startedVersion.Id, user.Id))
			adjustment, err := AdjustLotteryStock(startedActivity.Id, startedPrizes[0].Id, user.Id, "matrix-stock-"+test.name, 10, "initial stock")
			require.NoError(t, err)
			assert.EqualValues(t, 10, adjustment.AfterStock)
			oldRandom := lotteryRandomSource
			lotteryRandomSource = func() (int64, error) { return 0, nil }
			t.Cleanup(func() { lotteryRandomSource = oldRandom })
			result, err := DrawLottery(startedActivity.Id, user.Id, "matrix-balance-"+test.name, now)
			require.NoError(t, err)
			require.NotNil(t, result.Award)
			var awardLog Log
			require.NoError(t, db.Where("request_id = ?", fmt.Sprintf("lottery-award-%d", result.Award.Id)).First(&awardLog).Error)
			assert.EqualValues(t, result.Award.Quota, awardLog.Quota)

			draw := &LotteryDraw{ActivityId: activity.Id, VersionId: version.Id, UserId: user.Id, BusinessDate: version.BusinessDate, AttemptNo: 1, IdempotencyKey: "matrix-key", RawPrizeId: prize.Id, FinalPrizeId: prize.Id, RandomAlgorithm: LotteryRandomAlgorithm, Status: LotteryDrawCompleted}
			require.NoError(t, db.Create(draw).Error)
			duplicateDraw := *draw
			duplicateDraw.Id = 0
			err = db.Create(&duplicateDraw).Error
			assert.True(t, err != nil && !errors.Is(err, gorm.ErrRecordNotFound), fmt.Sprintf("expected draw uniqueness error, got %v", err))

			recorder := &migrationSQLRecorder{}
			require.NoError(t, db.Session(&gorm.Session{Logger: recorder}).AutoMigrate(migrationTables...))
			require.NoError(t, migrateLotteryIndexes())
			assert.Empty(t, recorder.schemaMutations(), "repeated startup must preserve the lottery schema")
			var preservedPrize LotteryPrize
			require.NoError(t, db.First(&preservedPrize, prize.Id).Error)
			assert.Equal(t, prize.BalanceAmount, preservedPrize.BalanceAmount)
			assert.Equal(t, prize.BalanceQuota, preservedPrize.BalanceQuota)
			assert.Equal(t, prize.Code, preservedPrize.Code)

			// Upgrade the prior lottery schema with existing draw history.
			require.NoError(t, db.Migrator().DropTable(&LotteryPaymentUsage{}))
			require.NoError(t, db.AutoMigrate(&LotteryPaymentUsage{}))
			require.NoError(t, db.AutoMigrate(&LotteryPaymentUsage{}))
			var keptDraw LotteryDraw
			require.NoError(t, db.First(&keptDraw, draw.Id).Error)
			assert.Equal(t, draw.IdempotencyKey, keptDraw.IdempotencyKey)
			t.Run("payment_lottery", testPaymentLottery)

			// Upgrade an existing payment pool without losing history or usage.
			require.NoError(t, db.Migrator().DropTable(&LotteryAttemptGrant{}))
			require.NoError(t, db.AutoMigrate(&LotteryAttemptGrant{}))
			recorder = &migrationSQLRecorder{}
			require.NoError(t, db.Session(&gorm.Session{Logger: recorder}).AutoMigrate(&LotteryAttemptGrant{}))
			assert.Empty(t, recorder.schemaMutations())
			require.NoError(t, db.First(&keptDraw, draw.Id).Error)
			assert.Equal(t, draw.IdempotencyKey, keptDraw.IdempotencyKey)
			t.Run("granted_attempts", testGrantedLotteryAttempts)
			t.Run("attempt_history", testLotteryAttemptHistory)
		})
	}
}

func TestLotteryAttemptHistory(t *testing.T) {
	truncateTables(t)
	testLotteryAttemptHistory(t)
}

func testLotteryAttemptHistory(t *testing.T) {
	t.Helper()
	var activity *LotteryActivity
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		var err error
		activity, err = EnsurePaymentLotteryTx(tx, 1)
		return err
	}))
	now := time.Unix(activity.StartAt, 0).Add(time.Hour)
	user, otherUser := lotteryTestUser(t, 0), lotteryTestUser(t, 0)
	empty, err := GetLotteryAttemptHistoryPage(user.Id, 0, 0, now)
	require.NoError(t, err)
	assert.Equal(t, &LotteryAttemptHistoryPage{
		Items: []LotteryAttemptHistoryItem{}, Page: 1, PageSize: 20,
	}, empty)

	payments := []TopUp{
		{PaymentProvider: PaymentProviderStripe, PaymentMethod: PaymentMethodStripe, Money: 1, CompleteTime: now.Unix() - 20, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderEpay, PaymentMethod: "alipay", Money: 1, CompleteTime: now.Unix() - 10, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderCreem, PaymentMethod: PaymentMethodCreem, Money: 1, CompleteTime: now.Unix() - 15, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderWaffo, PaymentMethod: PaymentMethodWaffo, Money: 1, CompleteTime: now.Unix() - 16, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderWaffoPancake, PaymentMethod: PaymentMethodWaffoPancake, Money: 1, CompleteTime: now.Unix() - 17, Status: common.TopUpStatusSuccess},
		{PaymentMethod: PaymentMethodStripe, Money: 1, CompleteTime: now.Unix() - 18, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderStripe, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusPending},
		{PaymentProvider: PaymentProviderStripe, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusExpired},
		{PaymentProvider: PaymentProviderStripe, Money: 0, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderStripe, PaymentMethod: PaymentMethodBalance, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderBalance, PaymentMethod: PaymentMethodBalance, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderStripe, Money: 1, CompleteTime: activity.StartAt - 1, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderStripe, Money: 1, CompleteTime: now.Unix() + 1, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderStripe, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess, UserId: otherUser.Id},
		{PaymentMethod: PaymentMethodBalance, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentMethod: PaymentMethodStripe, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderPerPay, PaymentMethod: PaymentProviderPerPay, Money: 1, CompleteTime: now.Unix() - 12, Status: common.TopUpStatusSuccess},
	}
	for i := range payments {
		if payments[i].UserId == 0 {
			payments[i].UserId = user.Id
		}
		payments[i].TradeNo = fmt.Sprintf("attempt-history-%d-%d", user.Id, i)
		require.NoError(t, DB.Create(&payments[i]).Error)
	}
	subscriptions := []SubscriptionOrder{
		{UserId: user.Id, TradeNo: payments[5].TradeNo, Money: 1, PaymentMethod: PaymentMethodStripe, PaymentProvider: PaymentProviderStripe, Status: common.TopUpStatusSuccess},
		{UserId: user.Id, TradeNo: payments[15].TradeNo, Money: 1, PaymentMethod: PaymentMethodBalance, PaymentProvider: PaymentProviderBalance, Status: common.TopUpStatusSuccess},
		{UserId: otherUser.Id, TradeNo: payments[16].TradeNo, Money: 1, PaymentMethod: PaymentMethodStripe, PaymentProvider: PaymentProviderStripe, Status: common.TopUpStatusSuccess},
	}
	require.NoError(t, DB.Create(&subscriptions).Error)
	require.NoError(t, DB.Create(&LotteryPaymentUsage{
		TopUpId: payments[0].Id, UserId: user.Id, DrawId: payments[0].Id,
	}).Error)
	grants := []LotteryAttemptGrant{
		{UserId: user.Id, Count: 3, Remaining: 0, RequestId: fmt.Sprintf("history-grant-%d", user.Id), OperatorId: otherUser.Id, Reason: "Support gift", CreatedAt: now.Unix() - 10},
		{UserId: user.Id, Count: 1, Remaining: 1, RequestId: fmt.Sprintf("lottery-gift-20261024-user-%d", user.Id), OperatorId: otherUser.Id, Reason: "全员赠送一次抽奖机会", CreatedAt: now.Unix() - 10},
		{UserId: otherUser.Id, Count: 2, Remaining: 2, RequestId: fmt.Sprintf("other-history-grant-%d", user.Id), OperatorId: otherUser.Id, CreatedAt: now.Unix()},
	}
	require.NoError(t, DB.Create(&grants).Error)
	expected := []LotteryAttemptHistoryItem{
		{Id: grants[1].Id, Source: "admin_grant", Count: 1, Reason: grants[1].Reason, CreatedAt: grants[1].CreatedAt},
		{Id: grants[0].Id, Source: "admin_grant", Count: 3, Reason: grants[0].Reason, CreatedAt: grants[0].CreatedAt},
	}
	for _, index := range []int{1, 17, 2, 3, 4, 5, 0} {
		expected = append(expected, LotteryAttemptHistoryItem{
			Id: payments[index].Id, Source: "payment", Count: 1, CreatedAt: payments[index].CompleteTime,
		})
	}
	page, err := GetLotteryAttemptHistoryPage(user.Id, 1, 1000, now)
	require.NoError(t, err)
	assert.EqualValues(t, len(expected), page.Total)
	assert.Equal(t, 100, page.PageSize)
	assert.Equal(t, expected, page.Items)
	for _, number := range []int{1, 2, 3} {
		page, err = GetLotteryAttemptHistoryPage(user.Id, number, 3, now)
		require.NoError(t, err)
		assert.EqualValues(t, len(expected), page.Total)
		assert.Equal(t, expected[(number-1)*3:min(number*3, len(expected))], page.Items)
	}
	page, err = GetLotteryAttemptHistoryPage(user.Id, 999999999, 100, now)
	require.NoError(t, err)
	assert.Empty(t, page.Items)
	assert.EqualValues(t, len(expected), page.Total)

	require.NoError(t, DB.Model(&LotteryActivity{}).Where("id = ?", activity.Id).Update("status", LotteryActivityPaused).Error)
	page, err = GetLotteryAttemptHistoryPage(user.Id, 1, 20, now)
	require.NoError(t, err)
	assert.Equal(t, expected, page.Items, "pausing the pool preserves acquisition history")
	require.NoError(t, DB.Delete(activity).Error)
	page, err = GetLotteryAttemptHistoryPage(user.Id, 1, 20, now)
	require.NoError(t, err)
	assert.Equal(t, expected[:2], page.Items, "manual gift history remains available without a pool")
}

func TestPaymentLottery(t *testing.T) {
	truncateTables(t)
	testPaymentLottery(t)
}

func TestGrantedLotteryAttempts(t *testing.T) {
	truncateTables(t)
	user := lotteryTestUser(t, 0)
	_, err := GrantLotteryAttempts(user.Id, user.Id, common.RoleRootUser, 1, "missing-pool", "")
	require.ErrorIs(t, err, ErrLotteryPoolMissing)
	testPaymentLottery(t)
	testGrantedLotteryAttempts(t)
}

func testGrantedLotteryAttempts(t *testing.T) {
	t.Helper()
	var activity LotteryActivity
	require.NoError(t, DB.Where("name = ?", PaymentLotteryName).First(&activity).Error)
	now := time.Unix(activity.StartAt, 0).Add(time.Hour)
	operator := lotteryTestUser(t, 0)
	require.NoError(t, DB.Model(&operator).Update("role", common.RoleRootUser).Error)
	user := lotteryTestUser(t, 0)

	grant, err := GrantLotteryAttempts(user.Id, operator.Id, common.RoleRootUser, 2, "manual-grant", "support")
	require.NoError(t, err)
	assert.Equal(t, 2, grant.Remaining)
	assert.Equal(t, operator.Id, grant.OperatorId)
	retried, err := GrantLotteryAttempts(user.Id, operator.Id, common.RoleRootUser, 2, "manual-grant", "support")
	require.NoError(t, err)
	assert.Equal(t, grant.Id, retried.Id)
	_, err = GrantLotteryAttempts(user.Id, operator.Id, common.RoleRootUser, 3, "manual-grant", "support")
	assert.ErrorIs(t, err, ErrLotteryIdempotencyConflict)

	for _, count := range []int{0, -1, LotteryMaxGrantedAttempts + 1} {
		_, err := GrantLotteryAttempts(user.Id, operator.Id, common.RoleRootUser, count, "invalid-grant", "")
		assert.ErrorIs(t, err, ErrLotteryGrantInvalid)
	}
	_, err = GrantLotteryAttempts(operator.Id, user.Id, common.RoleAdminUser, 1, "denied-role", "")
	assert.ErrorIs(t, err, ErrLotteryGrantPermission)
	_, err = GrantLotteryAttempts(user.Id, operator.Id, common.RoleCommonUser, 1, "denied-user", "")
	assert.ErrorIs(t, err, ErrLotteryGrantPermission)
	_, err = GrantLotteryAttempts(user.Id, operator.Id, common.RoleRootUser, LotteryMaxGrantedAttempts, "too-many", "")
	assert.ErrorIs(t, err, ErrLotteryGrantLimit)
	_, err = GrantLotteryAttempts(0, operator.Id, common.RoleRootUser, 1, "invalid-user", "")
	assert.ErrorIs(t, err, ErrLotteryGrantInvalid)

	duplicate := *grant
	duplicate.Id = 0
	assert.Error(t, DB.Create(&duplicate).Error, "request identifiers are unique at the database level")

	view, err := GetLotteryActivityView(activity.Id, user.Id, now)
	require.NoError(t, err)
	assert.Equal(t, 2, view.RemainingAttempts)
	assert.True(t, view.Qualification.Eligible)
	otherUser := lotteryTestUser(t, 0)
	view, err = GetLotteryActivityView(activity.Id, otherUser.Id, now)
	require.NoError(t, err)
	assert.Zero(t, view.RemainingAttempts)
	require.NoError(t, SetLotteryActivityStatus(activity.Id, LotteryActivityPaused, operator.Id))
	_, err = DrawLottery(activity.Id, user.Id, "grant-paused", now)
	assert.ErrorIs(t, err, ErrLotteryUnavailable)
	require.NoError(t, DB.First(grant, grant.Id).Error)
	assert.Equal(t, 2, grant.Remaining)
	require.NoError(t, SetLotteryActivityStatus(activity.Id, LotteryActivityActive, operator.Id))

	payment := TopUp{UserId: user.Id, TradeNo: "grant-with-payment", PaymentProvider: PaymentProviderStripe,
		PaymentMethod: PaymentMethodStripe, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess}
	require.NoError(t, DB.Create(&payment).Error)
	view, err = GetLotteryActivityView(activity.Id, user.Id, now)
	require.NoError(t, err)
	assert.Equal(t, 3, view.RemainingAttempts)
	_, err = DrawLottery(activity.Id, user.Id, "grant-payment-first", now)
	require.NoError(t, err)
	require.NoError(t, DB.First(grant, grant.Id).Error)
	assert.Equal(t, 2, grant.Remaining, "payment attempts are consumed first")

	// Failed awards and repeated draw requests must preserve the grant balance.
	var balancePrize LotteryPrize
	require.NoError(t, DB.Where("activity_id = ? AND type = ?", activity.Id, LotteryPrizeBalance).First(&balancePrize).Error)
	_, err = AdjustLotteryStock(activity.Id, balancePrize.Id, operator.Id, "grant-stock", 2, "test")
	require.NoError(t, err)
	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	lotteryRandomSource = func() (int64, error) { return 0, nil }
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("quota", common.MaxWalletQuota).Error)
	_, err = DrawLottery(activity.Id, user.Id, "grant-wallet-full", now)
	assert.ErrorIs(t, err, ErrLotteryWalletLimit)
	require.NoError(t, DB.First(grant, grant.Id).Error)
	assert.Equal(t, 2, grant.Remaining)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("quota", 0).Error)

	result, err := DrawLottery(activity.Id, user.Id, "grant-draw", now.Add(24*time.Hour))
	require.NoError(t, err)
	require.NotNil(t, result.Award)
	retry, err := DrawLottery(activity.Id, user.Id, "grant-draw", now.Add(48*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, result.Draw.Id, retry.Draw.Id)
	require.NoError(t, DB.First(grant, grant.Id).Error)
	assert.Equal(t, 1, grant.Remaining)

	// Real row locks serialize two draws competing for the last granted attempt.
	if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		sqlDB, err := DB.DB()
		require.NoError(t, err)
		sqlDB.SetMaxOpenConns(4)
		t.Cleanup(func() { sqlDB.SetMaxOpenConns(1) })
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var group sync.WaitGroup
	for i := range 2 {
		group.Go(func() {
			<-start
			_, err := DrawLottery(activity.Id, user.Id, fmt.Sprintf("grant-concurrent-%d", i), now.Add(48*time.Hour))
			results <- err
		})
	}
	close(start)
	group.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else {
			assert.ErrorIs(t, err, ErrLotteryNotEligible)
		}
	}
	assert.Equal(t, 1, successes)
	require.NoError(t, DB.First(grant, grant.Id).Error)
	assert.Zero(t, grant.Remaining)
	assert.Equal(t, 2, grant.Count)
	require.NoError(t, DB.AutoMigrate(&LotteryAttemptGrant{}))
	require.NoError(t, DB.First(grant, grant.Id).Error)
	assert.Zero(t, grant.Remaining)
	assert.Equal(t, "support", grant.Reason)
	var usageCount int64
	require.NoError(t, DB.Model(&LotteryPaymentUsage{}).Where("user_id = ?", user.Id).Count(&usageCount).Error)
	assert.EqualValues(t, 1, usageCount, "manual attempts must not consume a payment twice")
	view, err = GetLotteryActivityView(activity.Id, user.Id, now.Add(48*time.Hour))
	require.NoError(t, err)
	assert.Zero(t, view.RemainingAttempts)
}

func testPaymentLottery(t *testing.T) {
	t.Helper()
	now := time.Now()
	var activity *LotteryActivity
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		var err error
		activity, err = EnsurePaymentLotteryTx(tx, 1)
		return err
	}))
	now = time.Unix(activity.StartAt, 0)
	user := lotteryTestUser(t, 10)
	prizes := []LotteryPrize{
		{ActivityId: activity.Id, Code: "balance", Type: LotteryPrizeBalance, BalanceAmount: 2, BalanceQuota: 2, TotalStock: 2},
		{ActivityId: activity.Id, Code: "thanks", Type: LotteryPrizeThanks},
	}
	for i := range prizes {
		require.NoError(t, DB.Create(&prizes[i]).Error)
	}
	items := []LotteryVersionPrizeView{
		{LotteryVersionPrize: LotteryVersionPrize{Weight: 500_000, Enabled: true}, Prize: prizes[0]},
		{LotteryVersionPrize: LotteryVersionPrize{Weight: 500_000, Enabled: true}, Prize: prizes[1]},
	}
	version := LotteryVersion{ActivityId: activity.Id, QuotaPerUnit: 1}
	require.NoError(t, CreateLotteryVersion(&version, items))
	require.NoError(t, PublishLotteryVersion(version.Id, 1))

	// Successful online subscriptions are mirrored in top_ups with an empty
	// provider. The subscription and its mirror must grant one chance together.
	subscription := SubscriptionOrder{
		UserId: user.Id, TradeNo: "payment-lottery-subscription", Money: 1,
		PaymentMethod: PaymentMethodStripe, PaymentProvider: PaymentProviderStripe,
		Status: common.TopUpStatusSuccess, CompleteTime: now.Unix(),
	}
	require.NoError(t, DB.Create(&subscription).Error)
	payments := []TopUp{
		{PaymentProvider: PaymentProviderEpay, PaymentMethod: "alipay", Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderPerPay, PaymentMethod: PaymentProviderPerPay, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentMethod: PaymentMethodStripe, Money: 1, TradeNo: subscription.TradeNo, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderCreem, PaymentMethod: PaymentMethodCreem, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderEpay, PaymentMethod: "alipay", Money: 1, CompleteTime: now.Unix() - 1, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderStripe, Money: 1, Status: common.TopUpStatusPending},
		{PaymentProvider: PaymentProviderStripe, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusExpired},
		{PaymentProvider: PaymentProviderStripe, Money: 0, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderBalance, PaymentMethod: PaymentMethodBalance, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderPerPay, PaymentMethod: PaymentProviderPerPay, Money: 1, Status: common.TopUpStatusPending},
		{PaymentProvider: PaymentProviderPerPay, PaymentMethod: PaymentProviderPerPay, Money: 0, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderPerPay, PaymentMethod: PaymentProviderPerPay, Money: 1, CompleteTime: now.Unix() - 1, Status: common.TopUpStatusSuccess},
		{PaymentProvider: PaymentProviderStripe, Money: 1, CompleteTime: now.Add(time.Hour).Unix(), Status: common.TopUpStatusSuccess},
	}
	for i := range payments {
		payments[i].UserId = user.Id
		if payments[i].TradeNo == "" {
			payments[i].TradeNo = fmt.Sprintf("payment-lottery-%d", i)
		}
		require.NoError(t, DB.Create(&payments[i]).Error)
	}
	view, err := GetLotteryActivityView(activity.Id, user.Id, now)
	require.NoError(t, err)
	assert.Equal(t, 4, view.RemainingAttempts)
	assert.True(t, view.Qualification.Eligible)
	otherUser := lotteryTestUser(t, 0)
	_, err = DrawLottery(activity.Id, otherUser.Id, "other-user", now)
	assert.ErrorIs(t, err, ErrLotteryNotEligible)

	oldRandom := lotteryRandomSource
	t.Cleanup(func() { lotteryRandomSource = oldRandom })
	lotteryRandomSource = func() (int64, error) { return 0, nil }
	first, err := DrawLottery(activity.Id, user.Id, "payment-first", now)
	require.NoError(t, err)
	require.NotNil(t, first.Award)
	for i := range 2 {
		result, err := DrawLottery(activity.Id, user.Id, fmt.Sprintf("payment-next-%d", i), now)
		require.NoError(t, err)
		assert.Equal(t, i+2, result.Draw.AttemptNo)
		if i == 1 {
			assert.Equal(t, LotteryPrizeThanks, result.Prize.Type)
			assert.Equal(t, "stock_unavailable", result.Draw.ConversionReason)
		}
	}
	retry, err := DrawLottery(activity.Id, user.Id, "payment-first", now.Add(24*time.Hour))
	require.NoError(t, err)
	assert.True(t, retry.Reused)
	assert.Equal(t, first.Draw.Id, retry.Draw.Id)
	// Future-completed orders must not affect the current view.
	view, err = GetLotteryActivityView(activity.Id, user.Id, now)
	require.NoError(t, err)
	assert.Equal(t, 1, view.RemainingAttempts)
	require.NoError(t, DB.Delete(&payments[len(payments)-1]).Error)
	nextDay, err := DrawLottery(activity.Id, user.Id, "payment-tomorrow", now.Add(24*time.Hour))
	require.NoError(t, err)
	assert.False(t, nextDay.Reused)
	_, err = DrawLottery(activity.Id, user.Id, "payment-exhausted", now.Add(24*time.Hour))
	assert.ErrorIs(t, err, ErrLotteryNotEligible)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 14, user.Quota)
	require.NoError(t, DB.First(&prizes[0], prizes[0].Id).Error)
	assert.EqualValues(t, 2, prizes[0].IssuedStock)

	// Configuration changes preserve outstanding chances and inventory.
	require.NoError(t, SetLotteryActivityStatus(activity.Id, LotteryActivityPaused, 1))
	updatedVersion := LotteryVersion{ActivityId: activity.Id, QuotaPerUnit: 1}
	items[0].Prize = prizes[0]
	require.NoError(t, CreateLotteryVersion(&updatedVersion, items))
	require.NoError(t, PublishLotteryVersion(updatedVersion.Id, 1))
	require.NoError(t, DB.First(activity, activity.Id).Error)
	assert.Equal(t, LotteryActivityPaused, activity.Status)
	assert.Equal(t, now.Unix(), activity.StartAt)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		existing, err := EnsurePaymentLotteryTx(tx, 1)
		if err == nil {
			assert.Equal(t, activity.Id, existing.Id)
			assert.Equal(t, activity.StartAt, existing.StartAt)
		}
		return err
	}))
	require.NoError(t, SetLotteryActivityStatus(activity.Id, LotteryActivityActive, 1))

	additional := TopUp{UserId: user.Id, TradeNo: "payment-rollback", PaymentProvider: PaymentProviderStripe,
		PaymentMethod: PaymentMethodStripe, Money: 1, CompleteTime: now.Unix(), Status: common.TopUpStatusSuccess}
	require.NoError(t, DB.Create(&additional).Error)
	_, err = AdjustLotteryStock(activity.Id, prizes[0].Id, 1, "payment-stock", 1, "restock")
	require.NoError(t, err)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("quota", common.MaxWalletQuota).Error)
	_, err = DrawLottery(activity.Id, user.Id, "payment-rollback", now)
	assert.ErrorIs(t, err, ErrLotteryWalletLimit)
	view, err = GetLotteryActivityView(activity.Id, user.Id, now)
	require.NoError(t, err)
	assert.Equal(t, 1, view.RemainingAttempts)
	require.NoError(t, DB.First(&prizes[0], prizes[0].Id).Error)
	assert.EqualValues(t, 2, prizes[0].IssuedStock)

	// Two different requests compete for the same remaining order.
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("quota", 0).Error)
	if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		sqlDB, err := DB.DB()
		require.NoError(t, err)
		sqlDB.SetMaxOpenConns(4)
		t.Cleanup(func() { sqlDB.SetMaxOpenConns(1) })
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var group sync.WaitGroup
	for i := range 2 {
		group.Go(func() {
			<-start
			_, err := DrawLottery(activity.Id, user.Id, fmt.Sprintf("payment-concurrent-%d", i), now)
			results <- err
		})
	}
	close(start)
	group.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else {
			assert.ErrorIs(t, err, ErrLotteryNotEligible)
		}
	}
	assert.Equal(t, 1, successes)
	var usages int64
	require.NoError(t, DB.Model(&LotteryPaymentUsage{}).Where("user_id = ?", user.Id).Count(&usages).Error)
	assert.EqualValues(t, 5, usages)
	require.NoError(t, DB.AutoMigrate(&LotteryPaymentUsage{}))
	var keptUsages int64
	require.NoError(t, DB.Model(&LotteryPaymentUsage{}).Where("user_id = ?", user.Id).Count(&keptUsages).Error)
	assert.Equal(t, usages, keptUsages)
	duplicate := LotteryPaymentUsage{TopUpId: payments[1].Id, UserId: user.Id, DrawId: first.Draw.Id + 10000, CreatedAt: now.Unix()}
	assert.Error(t, DB.Create(&duplicate).Error)
}
