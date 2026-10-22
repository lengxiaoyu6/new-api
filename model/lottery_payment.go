package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const PaymentLotteryName = "online-payment-lottery"

// LotteryPaymentUsage binds a completed online payment to exactly one draw.
// Subscription payments already have a unique mirrored TopUp trade number.
type LotteryPaymentUsage struct {
	TopUpId   int   `json:"top_up_id" gorm:"primaryKey;autoIncrement:false"`
	UserId    int   `json:"user_id" gorm:"not null;index"`
	DrawId    int   `json:"draw_id" gorm:"not null;uniqueIndex"`
	CreatedAt int64 `json:"created_at" gorm:"bigint;not null"`
}

func paymentLotteryOrders(tx *gorm.DB, userID int, startAt, acceptedAt int64) *gorm.DB {
	providers := []string{PaymentProviderEpay, PaymentProviderStripe, PaymentProviderCreem, PaymentProviderWaffo, PaymentProviderWaffoPancake}
	subscriptions := tx.Model(&SubscriptionOrder{}).Select("trade_no").
		Where("user_id = ? AND status = ? AND money > 0 AND payment_provider IN ? AND payment_method <> ?",
			userID, common.TopUpStatusSuccess, providers, PaymentMethodBalance)
	used := tx.Model(&LotteryPaymentUsage{}).Select("top_up_id").Where("user_id = ?", userID)
	return tx.Model(&TopUp{}).
		Where("user_id = ? AND status = ? AND money > 0 AND complete_time >= ? AND complete_time <= ?",
			userID, common.TopUpStatusSuccess, startAt, acceptedAt).
		Where("payment_method <> ? AND (payment_provider IN ? OR trade_no IN (?))", PaymentMethodBalance, providers, subscriptions).
		Where("id NOT IN (?)", used)
}

// EnsurePaymentLotteryTx creates the permanent pool as part of its first
// configuration save. Unique naming also serializes concurrent first saves.
func EnsurePaymentLotteryTx(tx *gorm.DB, operatorID int) (*LotteryActivity, error) {
	now := common.GetTimestamp()
	seed := LotteryActivity{
		Name: PaymentLotteryName, StartAt: now, EndAt: 253402300799,
		ConsumeStartAt: now, ConsumeEndAt: 253402300799,
		Status: LotteryActivityDraft, MaxAttempts: 1,
		CreatedBy: operatorID, UpdatedBy: operatorID, CreatedAt: now, UpdatedAt: now,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
		return nil, err
	}
	var activity LotteryActivity
	if err := lockForUpdate(tx).Where("name = ?", PaymentLotteryName).First(&activity).Error; err != nil {
		return nil, err
	}
	return &activity, nil
}

func IsPaymentLottery(activityID int) (bool, error) {
	var activity LotteryActivity
	if err := DB.Select("id, name").First(&activity, activityID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrLotteryNotFound
		}
		return false, err
	}
	return activity.Name == PaymentLotteryName, nil
}

func paymentLotteryView(activity LotteryActivity, version LotteryVersion, prizes []LotteryVersionPrizeView, userID int, now time.Time) (*LotteryActivityView, error) {
	var remaining int64
	if err := paymentLotteryOrders(DB, userID, activity.StartAt, now.Unix()).Count(&remaining).Error; err != nil {
		return nil, err
	}
	status, reason := "ineligible", "payment_required"
	if remaining > 0 {
		status, reason = "eligible", "eligible"
	}
	if activity.Status == LotteryActivityPaused {
		status, reason = LotteryActivityPaused, "activity_paused"
	}
	return &LotteryActivityView{
		Activity: activity, Version: version, Prizes: prizes,
		Qualification: LotteryQualification{Eligible: remaining > 0, Reason: reason, CheckedAt: now.Unix()},
		BusinessDate:  LotteryBusinessDate(now), RemainingAttempts: int(remaining),
		Status: status, EligibilityReason: reason,
	}, nil
}
