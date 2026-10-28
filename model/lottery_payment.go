package model

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const PaymentLotteryName = "online-payment-lottery"

const LotteryMaxGrantedAttempts = 1_000_000

var (
	ErrLotteryGrantInvalid    = errors.New("Draw attempts must be an integer between 1 and 1000000")
	ErrLotteryGrantLimit      = errors.New("The user has too many unused granted draw attempts")
	ErrLotteryGrantPermission = errors.New("No permission to update users of same or higher permission level")
	ErrLotteryPoolMissing     = errors.New("No lottery prize pool configured")
)

// LotteryAttemptGrant retains the operator and original count after consumption.
type LotteryAttemptGrant struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	UserId     int    `json:"user_id" gorm:"not null;index"`
	Count      int    `json:"count" gorm:"not null"`
	Remaining  int    `json:"remaining" gorm:"not null"`
	RequestId  string `json:"request_id" gorm:"type:varchar(128);not null;uniqueIndex"`
	OperatorId int    `json:"operator_id" gorm:"not null;index"`
	Reason     string `json:"reason" gorm:"type:varchar(255);not null"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint;not null"`
}

func GrantLotteryAttempts(userID, operatorID, operatorRole, count int, requestID, reason string) (*LotteryAttemptGrant, error) {
	requestID, reason = strings.TrimSpace(requestID), strings.TrimSpace(reason)
	if userID <= 0 || operatorID <= 0 || count <= 0 || count > LotteryMaxGrantedAttempts {
		return nil, ErrLotteryGrantInvalid
	}
	if len(requestID) == 0 || len(requestID) > 128 || utf8.RuneCountInString(reason) > 255 {
		return nil, ErrLotteryInvalidConfig
	}
	if operatorRole < common.RoleAdminUser {
		return nil, ErrLotteryGrantPermission
	}
	var grant LotteryAttemptGrant
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Draws take the same user lock, serializing grants and consumption.
		var user User
		if err := lockForUpdate(tx).Select("id, role").First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && operatorRole <= user.Role {
			return ErrLotteryGrantPermission
		}
		err := tx.Where("request_id = ?", requestID).First(&grant).Error
		if err == nil {
			if grant.UserId != userID || grant.OperatorId != operatorID || grant.Count != count || grant.Reason != reason {
				return ErrLotteryIdempotencyConflict
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var activity LotteryActivity
		if err := tx.Select("id").Where("name = ?", PaymentLotteryName).First(&activity).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrLotteryPoolMissing
			}
			return err
		}
		var remaining int64
		if err := tx.Model(&LotteryAttemptGrant{}).Where("user_id = ?", userID).
			Select("COALESCE(SUM(remaining), 0)").Scan(&remaining).Error; err != nil {
			return err
		}
		if remaining > int64(LotteryMaxGrantedAttempts-count) {
			return ErrLotteryGrantLimit
		}
		grant = LotteryAttemptGrant{
			UserId: userID, Count: count, Remaining: count, RequestId: requestID,
			OperatorId: operatorID, Reason: reason, CreatedAt: common.GetTimestamp(),
		}
		return tx.Create(&grant).Error
	})
	if err != nil {
		return nil, err
	}
	return &grant, nil
}

// LotteryPaymentUsage binds a completed online payment to exactly one draw.
// Subscription payments already have a unique mirrored TopUp trade number.
type LotteryPaymentUsage struct {
	TopUpId   int   `json:"top_up_id" gorm:"primaryKey;autoIncrement:false"`
	UserId    int   `json:"user_id" gorm:"not null;index"`
	DrawId    int   `json:"draw_id" gorm:"not null;uniqueIndex"`
	CreatedAt int64 `json:"created_at" gorm:"bigint;not null"`
}

func lotteryOnlinePayments(tx *gorm.DB, userID int) *gorm.DB {
	providers := []string{PaymentProviderEpay, PaymentProviderStripe, PaymentProviderCreem, PaymentProviderWaffo, PaymentProviderWaffoPancake, PaymentProviderPerPay}
	subscriptions := tx.Model(&SubscriptionOrder{}).Select("trade_no").
		Where("user_id = ? AND status = ? AND money > 0 AND payment_provider IN ? AND payment_method <> ?",
			userID, common.TopUpStatusSuccess, providers, PaymentMethodBalance)
	return tx.Model(&TopUp{}).
		Where("user_id = ? AND status = ? AND money > 0", userID, common.TopUpStatusSuccess).
		Where("payment_method <> ? AND (payment_provider IN ? OR trade_no IN (?))", PaymentMethodBalance, providers, subscriptions)
}

func paymentLotteryOrders(tx *gorm.DB, userID int, startAt, acceptedAt int64) *gorm.DB {
	used := tx.Model(&LotteryPaymentUsage{}).Select("top_up_id").Where("user_id = ?", userID)
	return lotteryOnlinePayments(tx, userID).
		Where("complete_time >= ? AND complete_time <= ?", startAt, acceptedAt).
		Where("id NOT IN (?)", used)
}

type LotteryAttemptHistoryItem struct {
	Id        int    `json:"id"`
	Source    string `json:"source"`
	Count     int    `json:"count"`
	Reason    string `json:"reason"`
	CreatedAt int64  `json:"created_at"`
}

type LotteryAttemptHistoryPage struct {
	Items    []LotteryAttemptHistoryItem `json:"items"`
	Total    int64                       `json:"total"`
	Page     int                         `json:"page"`
	PageSize int                         `json:"page_size"`
}

func GetLotteryAttemptHistoryPage(userID, page, pageSize int, now time.Time) (*LotteryAttemptHistoryPage, error) {
	page, pageSize = normalizeLotteryHistoryPage(page, pageSize)
	poolStart := DB.Model(&LotteryActivity{}).Select("start_at").Where("name = ?", PaymentLotteryName)
	// Acquisition history retains payments and grants after their attempts are used.
	payments := lotteryOnlinePayments(DB, userID).
		Where("complete_time >= (?) AND complete_time <= ?", poolStart, now.Unix()).
		Select("id, ? AS source, 1 AS count, ? AS reason, complete_time AS created_at", "payment", "")
	grants := DB.Model(&LotteryAttemptGrant{}).Where("user_id = ?", userID).
		Select("id, ? AS source, count, reason, created_at", "admin_grant")
	// GORM has no UNION builder; both subqueries retain parameter binding.
	query := DB.Table("(? UNION ALL ?) AS attempt_history", payments, grants)
	result := &LotteryAttemptHistoryPage{
		Items: make([]LotteryAttemptHistoryItem, 0), Page: page, PageSize: pageSize,
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, err
	}
	if int64(page-1) > result.Total/int64(pageSize) {
		return result, nil
	}
	if err := query.Order("created_at DESC, source ASC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).Scan(&result.Items).Error; err != nil {
		return nil, err
	}
	return result, nil
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
	var granted int64
	if err := DB.Model(&LotteryAttemptGrant{}).Where("user_id = ?", userID).
		Select("COALESCE(SUM(remaining), 0)").Scan(&granted).Error; err != nil {
		return nil, err
	}
	remaining += granted
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
