package model

import (
	"crypto/rand"
	"database/sql/driver"
	"errors"
	"math"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	LotteryTimezone = "Asia/Shanghai"

	LotteryActivityDraft  = "draft"
	LotteryActivityActive = "active"
	LotteryActivityPaused = "paused"
	LotteryActivityEnded  = "ended"

	LotteryVersionDraft     = "draft"
	LotteryVersionPublished = "published"

	LotteryPrizeBalance = "balance"
	LotteryPrizeAgain   = "again"
	LotteryPrizeThanks  = "thanks"

	LotteryDrawCompleted = "completed"
	LotteryAwardGranted  = "granted"

	LotteryRandomAlgorithm = "crypto-rand-v1"

	LotteryWeightTotal int64 = 1_000_000
	LotteryMaxPrizes         = 50
	LotteryMaxAttempts       = 2
)

var (
	ErrLotteryNotFound            = errors.New("lottery activity not found")
	ErrLotteryNotEligible         = errors.New("lottery qualification is not satisfied")
	ErrLotteryUnavailable         = errors.New("lottery is unavailable")
	ErrLotteryAlreadyDrawn        = errors.New("lottery attempt has already been completed")
	ErrLotteryInvalidConfig       = errors.New("invalid lottery configuration")
	ErrLotteryQualification       = errors.New("lottery qualification is unavailable")
	ErrLotteryIdempotencyConflict = errors.New("lottery idempotency key conflicts with an existing request")
	ErrLotteryAccountUnavailable  = errors.New("lottery account is unavailable")
	ErrLotteryWalletLimit         = errors.New("lottery wallet capacity is insufficient")
)

// LotteryLocalizedText stores server-owned localized copy. The fallback is
// selected by the API layer; clients never need to interpret this field.
type LotteryLocalizedText map[string]string

func (v LotteryLocalizedText) Value() (driver.Value, error) {
	if v == nil {
		return "{}", nil
	}
	b, err := common.Marshal(v)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (v *LotteryLocalizedText) Scan(value any) error {
	if v == nil {
		return errors.New("nil localized text receiver")
	}
	data := jsonScanBytes(value)
	if len(data) == 0 {
		*v = nil
		return nil
	}
	var result map[string]string
	if err := common.Unmarshal(data, &result); err != nil {
		return err
	}
	*v = result
	return nil
}

type LotteryActivity struct {
	Id             int    `json:"id" gorm:"primaryKey"`
	Name           string `json:"name" gorm:"type:varchar(128);not null;uniqueIndex"`
	StartAt        int64  `json:"start_at" gorm:"bigint;not null;index"`
	EndAt          int64  `json:"end_at" gorm:"bigint;not null;index"`
	ConsumeStartAt int64  `json:"consume_start_at" gorm:"bigint;not null"`
	ConsumeEndAt   int64  `json:"consume_end_at" gorm:"bigint;not null"`
	Status         string `json:"status" gorm:"type:varchar(16);not null;index"`
	MaxAttempts    int    `json:"max_attempts" gorm:"not null"`
	CreatedBy      int    `json:"created_by" gorm:"index"`
	UpdatedBy      int    `json:"updated_by" gorm:"index"`
	CreatedAt      int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt      int64  `json:"updated_at" gorm:"bigint"`
}

type LotteryVersion struct {
	Id             int                  `json:"id" gorm:"primaryKey"`
	ActivityId     int                  `json:"activity_id" gorm:"not null;index:idx_lottery_version_day,priority:1"`
	BusinessDate   string               `json:"business_date" gorm:"type:char(10);not null;index:idx_lottery_version_day,priority:2"`
	Revision       int                  `json:"revision" gorm:"not null"`
	Status         string               `json:"status" gorm:"type:varchar(16);not null;index"`
	Title          LotteryLocalizedText `json:"title" gorm:"type:text"`
	RuleText       LotteryLocalizedText `json:"rule_text" gorm:"type:text"`
	ThresholdQuota int64                `json:"threshold_quota" gorm:"not null"`
	QuotaPerUnit   float64              `json:"quota_per_unit" gorm:"not null"`
	PublishedAt    int64                `json:"published_at" gorm:"bigint"`
	PublishedBy    int                  `json:"published_by" gorm:"index"`
	CreatedBy      int                  `json:"created_by" gorm:"index"`
	CreatedAt      int64                `json:"created_at" gorm:"bigint"`
	UpdatedAt      int64                `json:"updated_at" gorm:"bigint"`
}

type LotteryPrize struct {
	Id            int     `json:"id" gorm:"primaryKey"`
	ActivityId    int     `json:"activity_id" gorm:"not null;index;uniqueIndex:idx_lottery_prize_code,priority:1"`
	Code          string  `json:"code" gorm:"type:varchar(64);not null;uniqueIndex:idx_lottery_prize_code,priority:2"`
	Type          string  `json:"type" gorm:"type:varchar(16);not null;index"`
	BalanceAmount float64 `json:"balance_amount" gorm:"type:decimal(20,8);not null"`
	BalanceQuota  int64   `json:"balance_quota" gorm:"not null"`
	TotalStock    int64   `json:"total_stock" gorm:"not null"`
	IssuedStock   int64   `json:"issued_stock" gorm:"not null"`
	CreatedAt     int64   `json:"created_at" gorm:"bigint"`
	UpdatedAt     int64   `json:"updated_at" gorm:"bigint"`
}

type LotteryVersionPrize struct {
	Id          int                  `json:"id" gorm:"primaryKey"`
	VersionId   int                  `json:"version_id" gorm:"not null;uniqueIndex:idx_lottery_version_prize,priority:1"`
	PrizeId     int                  `json:"prize_id" gorm:"not null;uniqueIndex:idx_lottery_version_prize,priority:2"`
	Title       LotteryLocalizedText `json:"title" gorm:"type:text"`
	Description LotteryLocalizedText `json:"description" gorm:"type:text"`
	Weight      int64                `json:"weight" gorm:"not null"`
	DailyLimit  int64                `json:"daily_limit" gorm:"not null"`
	SortOrder   int                  `json:"sort_order" gorm:"not null"`
	Enabled     bool                 `json:"enabled" gorm:"not null"`
}

type LotteryParticipation struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	ActivityId   int    `json:"activity_id" gorm:"not null;uniqueIndex:idx_lottery_participation_day,priority:1"`
	UserId       int    `json:"user_id" gorm:"not null;uniqueIndex:idx_lottery_participation_day,priority:2"`
	BusinessDate string `json:"business_date" gorm:"type:char(10);not null;uniqueIndex:idx_lottery_participation_day,priority:3"`
	BaseUsed     bool   `json:"base_used" gorm:"not null"`
	ExtraGranted int    `json:"extra_granted" gorm:"not null"`
	ExtraUsed    int    `json:"extra_used" gorm:"not null"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt    int64  `json:"updated_at" gorm:"bigint"`
}

type LotteryPrizeDailyStock struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	PrizeId      int    `json:"prize_id" gorm:"not null;uniqueIndex:idx_lottery_prize_day,priority:1"`
	BusinessDate string `json:"business_date" gorm:"type:char(10);not null;uniqueIndex:idx_lottery_prize_day,priority:2"`
	Issued       int64  `json:"issued" gorm:"not null"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt    int64  `json:"updated_at" gorm:"bigint"`
}

type LotteryDraw struct {
	Id               int    `json:"id" gorm:"primaryKey"`
	ActivityId       int    `json:"activity_id" gorm:"not null;uniqueIndex:idx_lottery_draw_attempt,priority:1;uniqueIndex:idx_lottery_draw_key,priority:1;index"`
	VersionId        int    `json:"version_id" gorm:"not null;index"`
	UserId           int    `json:"user_id" gorm:"not null;uniqueIndex:idx_lottery_draw_attempt,priority:2;uniqueIndex:idx_lottery_draw_key,priority:2;index"`
	BusinessDate     string `json:"business_date" gorm:"type:char(10);not null;uniqueIndex:idx_lottery_draw_attempt,priority:3;uniqueIndex:idx_lottery_draw_key,priority:3"`
	AttemptNo        int    `json:"attempt_no" gorm:"not null;uniqueIndex:idx_lottery_draw_attempt,priority:4"`
	IdempotencyKey   string `json:"idempotency_key" gorm:"type:varchar(128);not null;uniqueIndex:idx_lottery_draw_key,priority:4"`
	RawPrizeId       int    `json:"-" gorm:"not null"`
	FinalPrizeId     int    `json:"-" gorm:"not null"`
	RandomValue      int64  `json:"-" gorm:"not null"`
	RangeStart       int64  `json:"-" gorm:"not null"`
	RangeEnd         int64  `json:"-" gorm:"not null"`
	RandomAlgorithm  string `json:"-" gorm:"type:varchar(32);not null;default:'crypto-rand-v1'"`
	ConversionReason string `json:"-" gorm:"type:varchar(64);not null"`
	Status           string `json:"-" gorm:"type:varchar(16);not null"`
	BalanceQuota     int64  `json:"-" gorm:"not null"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;index"`
}

type LotteryAward struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	DrawId     int    `json:"draw_id" gorm:"not null;uniqueIndex"`
	ActivityId int    `json:"activity_id" gorm:"not null;index"`
	UserId     int    `json:"user_id" gorm:"not null;index"`
	PrizeId    int    `json:"prize_id" gorm:"not null"`
	Quota      int64  `json:"quota" gorm:"not null"`
	Status     string `json:"status" gorm:"type:varchar(16);not null"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint"`
}

type LotteryStockAdjustment struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	RequestId   string `json:"request_id" gorm:"type:varchar(128);not null;uniqueIndex"`
	ActivityId  int    `json:"activity_id" gorm:"not null;index"`
	PrizeId     int    `json:"prize_id" gorm:"not null;index"`
	Delta       int64  `json:"delta" gorm:"not null"`
	BeforeStock int64  `json:"before_stock" gorm:"not null"`
	AfterStock  int64  `json:"after_stock" gorm:"not null"`
	OperatorId  int    `json:"operator_id" gorm:"not null;index"`
	Reason      string `json:"reason" gorm:"type:varchar(255);not null"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint"`
}

func (LotteryActivity) TableName() string        { return "lottery_activities" }
func (LotteryVersion) TableName() string         { return "lottery_versions" }
func (LotteryPrize) TableName() string           { return "lottery_prizes" }
func (LotteryVersionPrize) TableName() string    { return "lottery_version_prizes" }
func (LotteryParticipation) TableName() string   { return "lottery_participations" }
func (LotteryPrizeDailyStock) TableName() string { return "lottery_prize_daily_stocks" }
func (LotteryDraw) TableName() string            { return "lottery_draws" }
func (LotteryAward) TableName() string           { return "lottery_awards" }
func (LotteryStockAdjustment) TableName() string { return "lottery_stock_adjustments" }

type LotteryVersionPrizeView struct {
	LotteryVersionPrize
	Prize       LotteryPrize `json:"prize"`
	DailyIssued int64        `json:"daily_issued"`
}

type LotteryDrawResult struct {
	Draw   LotteryDraw   `json:"draw"`
	Prize  LotteryPrize  `json:"prize"`
	Award  *LotteryAward `json:"award,omitempty"`
	Reused bool          `json:"reused"`
}

type LotteryQualification struct {
	Eligible       bool   `json:"eligible"`
	ThresholdQuota int64  `json:"threshold_quota"`
	Reason         string `json:"reason"`
	CheckedAt      int64  `json:"checked_at"`
}

type LotteryActivityView struct {
	Activity          LotteryActivity           `json:"activity"`
	Version           LotteryVersion            `json:"version"`
	Prizes            []LotteryVersionPrizeView `json:"prizes"`
	Qualification     LotteryQualification      `json:"qualification"`
	BusinessDate      string                    `json:"business_date"`
	BaseUsed          bool                      `json:"base_used"`
	RemainingAttempts int                       `json:"remaining_attempts"`
	ExtraGranted      bool                      `json:"extra_granted"`
	ExtraAvailable    bool                      `json:"extra_available"`
	Status            string                    `json:"status"`
	EligibilityReason string                    `json:"eligibility_reason"`
}

type LotteryHistoryPage struct {
	Items    []LotteryDrawResult `json:"items"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
}

func lotteryLocation() *time.Location {
	loc, err := time.LoadLocation(LotteryTimezone)
	if err != nil {
		return time.FixedZone("Asia/Shanghai", 8*60*60)
	}
	return loc
}

func LotteryBusinessDate(at time.Time) string {
	return at.In(lotteryLocation()).Format("2006-01-02")
}

func validateLotteryActivity(activity *LotteryActivity) error {
	if activity == nil || strings.TrimSpace(activity.Name) == "" || activity.StartAt <= 0 || activity.EndAt <= activity.StartAt {
		return ErrLotteryInvalidConfig
	}
	if activity.ConsumeStartAt <= 0 || activity.ConsumeEndAt <= activity.ConsumeStartAt || activity.MaxAttempts < 1 || activity.MaxAttempts > LotteryMaxAttempts {
		return ErrLotteryInvalidConfig
	}
	return nil
}

// NormalizeLotteryPrizeDefinition validates the immutable part of a prize and
// derives its wallet quota from the configured display amount. TotalStock is
// mutable only through the dedicated stock-adjustment operation after create.
func NormalizeLotteryPrizeDefinition(prize *LotteryPrize, quotaPerUnit float64) error {
	if prize == nil || prize.ActivityId <= 0 || strings.TrimSpace(prize.Code) == "" || prize.TotalStock < 0 || prize.IssuedStock < 0 || prize.IssuedStock > prize.TotalStock || prize.TotalStock > int64(common.MaxWalletQuota) {
		return ErrLotteryInvalidConfig
	}
	prize.Code = strings.TrimSpace(prize.Code)
	prize.Type = strings.TrimSpace(prize.Type)
	switch prize.Type {
	case LotteryPrizeBalance:
		if prize.BalanceAmount <= 0 || math.IsNaN(prize.BalanceAmount) || math.IsInf(prize.BalanceAmount, 0) {
			return ErrLotteryInvalidConfig
		}
		amount := decimal.NewFromFloat(prize.BalanceAmount)
		if !amount.Equal(amount.Round(8)) {
			return ErrLotteryInvalidConfig
		}
		quota, err := LotteryQuotaFromAmount(prize.BalanceAmount, quotaPerUnit)
		if err != nil || prize.BalanceQuota != 0 && prize.BalanceQuota != quota {
			return ErrLotteryInvalidConfig
		}
		prize.BalanceQuota = quota
	case LotteryPrizeAgain, LotteryPrizeThanks:
		if prize.BalanceAmount != 0 || prize.BalanceQuota != 0 || prize.TotalStock != 0 || prize.IssuedStock != 0 {
			return ErrLotteryInvalidConfig
		}
	default:
		return ErrLotteryInvalidConfig
	}
	return nil
}

func ValidateLotteryVersion(version *LotteryVersion, prizes []LotteryVersionPrizeView) error {
	if version == nil || version.ActivityId <= 0 || strings.TrimSpace(version.BusinessDate) == "" || version.ThresholdQuota < 0 || version.QuotaPerUnit <= 0 || math.IsNaN(version.QuotaPerUnit) || math.IsInf(version.QuotaPerUnit, 0) || len(prizes) < 2 || len(prizes) > LotteryMaxPrizes {
		return ErrLotteryInvalidConfig
	}
	parsedDate, err := time.ParseInLocation("2006-01-02", version.BusinessDate, lotteryLocation())
	if err != nil || LotteryBusinessDate(parsedDate) != version.BusinessDate {
		return ErrLotteryInvalidConfig
	}
	var total int64
	thanks := 0
	again := 0
	enabled := 0
	for _, item := range prizes {
		prize := item.Prize
		if prize.Id <= 0 || prize.ActivityId != version.ActivityId || NormalizeLotteryPrizeDefinition(&prize, version.QuotaPerUnit) != nil || prize.BalanceQuota != item.Prize.BalanceQuota {
			return ErrLotteryInvalidConfig
		}
		if item.DailyLimit < 0 || item.Prize.Type != LotteryPrizeBalance && item.DailyLimit != 0 {
			return ErrLotteryInvalidConfig
		}
		if !item.Enabled {
			if item.Weight != 0 {
				return ErrLotteryInvalidConfig
			}
			continue
		}
		enabled++
		if item.Weight <= 0 || total > LotteryWeightTotal-item.Weight {
			return ErrLotteryInvalidConfig
		}
		if item.Prize.Type == LotteryPrizeThanks {
			thanks++
		}
		if item.Prize.Type == LotteryPrizeAgain {
			again++
		}
		total += item.Weight
	}
	if enabled < 2 || thanks != 1 || again > 1 || total != LotteryWeightTotal {
		return ErrLotteryInvalidConfig
	}
	return nil
}

func findLotteryVersionTx(tx *gorm.DB, activityID int, businessDate string) (*LotteryVersion, error) {
	var version LotteryVersion
	err := tx.Where("activity_id = ? AND business_date = ? AND status = ?", activityID, businessDate, LotteryVersionPublished).
		Order("revision desc, id desc").First(&version).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrLotteryUnavailable
	}
	return &version, err
}

func loadLotteryVersionPrizesTx(tx *gorm.DB, versionID int) ([]LotteryVersionPrizeView, error) {
	var rows []LotteryVersionPrize
	if err := tx.Where("version_id = ? AND enabled = ?", versionID, true).Order("sort_order asc, id asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]LotteryVersionPrizeView, 0, len(rows))
	for _, row := range rows {
		var prize LotteryPrize
		if err := tx.First(&prize, row.PrizeId).Error; err != nil {
			return nil, err
		}
		result = append(result, LotteryVersionPrizeView{LotteryVersionPrize: row, Prize: prize})
	}
	return result, nil
}

func lotteryRandomValue() (int64, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(LotteryWeightTotal))
	if err != nil {
		return 0, err
	}
	return n.Int64(), nil
}

var lotteryRandomSource = lotteryRandomValue

func chooseLotteryPrize(prizes []LotteryVersionPrizeView, randomValue int64) (LotteryVersionPrizeView, int64, int64, error) {
	var cursor int64
	for _, item := range prizes {
		next := cursor + item.Weight
		if randomValue >= cursor && randomValue < next {
			return item, cursor, next, nil
		}
		cursor = next
	}
	return LotteryVersionPrizeView{}, 0, 0, ErrLotteryInvalidConfig
}

func parseChargedQuota(payload string) int64 {
	for part := range strings.SplitSeq(payload, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && key == "charged_quota" {
			parsed, _ := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
			return parsed
		}
	}
	return 0
}

func subscriptionOrderQuota(order SubscriptionOrder) (int64, error) {
	return subscriptionOrderQuotaWithUnit(order, common.QuotaPerUnit)
}

func subscriptionOrderQuotaWithUnit(order SubscriptionOrder, quotaPerUnit float64) (int64, error) {
	if order.ChargedQuota > 0 {
		if order.ChargedQuota > int64(common.MaxWalletQuota) {
			return 0, errors.New("subscription quota exceeds wallet limit")
		}
		return order.ChargedQuota, nil
	}
	if order.PaymentMethod == PaymentMethodBalance {
		charged := parseChargedQuota(order.ProviderPayload)
		if charged > 0 {
			if charged > int64(common.MaxWalletQuota) {
				return 0, errors.New("subscription quota exceeds wallet limit")
			}
			return charged, nil
		}
		if order.Money <= 0 || quotaPerUnit <= 0 || math.IsNaN(order.Money) || math.IsInf(order.Money, 0) || math.IsNaN(quotaPerUnit) || math.IsInf(quotaPerUnit, 0) {
			return 0, nil
		}
	}
	if order.Money <= 0 || quotaPerUnit <= 0 || math.IsNaN(order.Money) || math.IsInf(order.Money, 0) || math.IsNaN(quotaPerUnit) || math.IsInf(quotaPerUnit, 0) {
		return 0, nil
	}
	value := decimal.NewFromFloat(order.Money).Mul(decimal.NewFromFloat(quotaPerUnit))
	quota, err := common.WalletQuotaFromDecimalStrict(value)
	if err != nil {
		return 0, err
	}
	return int64(quota), nil
}

func LotteryQuotaFromAmount(amount, quotaPerUnit float64) (int64, error) {
	if amount <= 0 || quotaPerUnit <= 0 || math.IsNaN(amount) || math.IsInf(amount, 0) || math.IsNaN(quotaPerUnit) || math.IsInf(quotaPerUnit, 0) {
		return 0, ErrLotteryInvalidConfig
	}
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(amount).Mul(decimal.NewFromFloat(quotaPerUnit)).Ceil())
	if err != nil {
		return 0, err
	}
	return int64(quota), nil
}

type lotteryLogFact struct {
	Id        int
	RequestId string
	Quota     int64
	Type      int
	Other     string
}

func lotteryConsumeFactCounts(other string) bool {
	var values map[string]any
	if common.UnmarshalJsonStr(other, &values) != nil {
		return true
	}
	if failed, ok := values["settlement_failed"].(bool); ok && failed {
		return false
	}
	if status, ok := values["settlement_status"].(string); ok && status != "success" {
		return false
	}
	return true
}

func lotteryFactKeys(requestID, other string) []string {
	keys := make([]string, 0, 2)
	if requestID != "" {
		keys = append(keys, "request:"+requestID)
	}
	var values map[string]any
	if common.UnmarshalJsonStr(other, &values) == nil {
		if taskID, ok := values["task_id"].(string); ok && taskID != "" {
			keys = append(keys, "task:"+taskID)
		}
	}
	return keys
}

type lotteryRefundFact struct {
	Keys      []string
	Remaining int64
}

func lotteryFactKeysOverlap(left, right []string) bool {
	for _, key := range left {
		if slices.Contains(right, key) {
			return true
		}
	}
	return false
}

func calculateLotteryConsumptionFromDB(logDB, mainDB *gorm.DB, userID int, startAt, endAt, acceptedAt int64, quotaPerUnit ...float64) (int64, error) {
	upper := endAt
	if acceptedAt < upper {
		upper = acceptedAt
	}
	if upper <= startAt {
		return 0, nil
	}
	if logDB == nil || mainDB == nil {
		return 0, ErrLotteryQualification
	}
	var consumeFacts []lotteryLogFact
	if err := logDB.Table("logs").Select("id, request_id, quota, type, other").Where("user_id = ? AND type = ? AND created_at >= ? AND created_at < ?", userID, LogTypeConsume, startAt, upper).Find(&consumeFacts).Error; err != nil {
		return 0, errors.Join(ErrLotteryQualification, err)
	}
	// A refund can be settled after the configured spend window. It still
	// reduces qualification when it is completed before the draw request is
	// accepted, so query refunds through acceptedAt separately from consumes.
	var refundFacts []lotteryLogFact
	if err := logDB.Table("logs").Select("id, request_id, quota, type, other").Where("user_id = ? AND type = ? AND created_at >= ? AND created_at < ?", userID, LogTypeRefund, startAt, acceptedAt).Find(&refundFacts).Error; err != nil {
		return 0, errors.Join(ErrLotteryQualification, err)
	}
	facts := make([]lotteryLogFact, 0, len(consumeFacts)+len(refundFacts))
	facts = append(facts, consumeFacts...)
	facts = append(facts, refundFacts...)
	refunds := make([]lotteryRefundFact, 0, len(refundFacts))
	for _, fact := range facts {
		if fact.Type != LogTypeRefund || fact.Quota <= 0 {
			continue
		}
		if !lotteryConsumeFactCounts(fact.Other) {
			continue
		}
		keys := lotteryFactKeys(fact.RequestId, fact.Other)
		if len(keys) > 0 {
			refunds = append(refunds, lotteryRefundFact{Keys: keys, Remaining: fact.Quota})
		}
	}
	var total int64
	for _, fact := range facts {
		if fact.Type != LogTypeConsume || fact.Quota <= 0 {
			continue
		}
		if !lotteryConsumeFactCounts(fact.Other) {
			continue
		}
		var values map[string]any
		_ = common.UnmarshalJsonStr(fact.Other, &values)
		if source, ok := values["billing_source"].(string); ok && source == "subscription" {
			continue
		}
		net := fact.Quota
		keys := lotteryFactKeys(fact.RequestId, fact.Other)
		for i := range refunds {
			if net <= 0 {
				break
			}
			if refunds[i].Remaining <= 0 || !lotteryFactKeysOverlap(keys, refunds[i].Keys) {
				continue
			}
			deduction := min(net, refunds[i].Remaining)
			net -= deduction
			refunds[i].Remaining -= deduction
		}
		if total > math.MaxInt64-net {
			total = math.MaxInt64
		} else {
			total += net
		}
	}
	unit := common.QuotaPerUnit
	if len(quotaPerUnit) > 0 && quotaPerUnit[0] > 0 && !math.IsNaN(quotaPerUnit[0]) && !math.IsInf(quotaPerUnit[0], 0) {
		unit = quotaPerUnit[0]
	}
	var orders []SubscriptionOrder
	if err := mainDB.Where("user_id = ? AND status = ? AND complete_time >= ? AND complete_time < ?", userID, common.TopUpStatusSuccess, startAt, upper).Find(&orders).Error; err != nil {
		return 0, errors.Join(ErrLotteryQualification, err)
	}
	for _, order := range orders {
		quota, err := subscriptionOrderQuotaWithUnit(order, unit)
		if err != nil {
			return 0, errors.Join(ErrLotteryQualification, err)
		}
		if quota < 0 {
			return 0, errors.Join(ErrLotteryQualification, errors.New("subscription quota is negative"))
		}
		if total > math.MaxInt64-quota {
			total = math.MaxInt64
		} else {
			total += quota
		}
	}
	return total, nil
}

func calculateLotteryConsumption(userID int, startAt, endAt, acceptedAt int64, quotaPerUnit ...float64) (int64, error) {
	return calculateLotteryConsumptionFromDB(LOG_DB, DB, userID, startAt, endAt, acceptedAt, quotaPerUnit...)
}

func GetLotteryActivityView(activityID, userID int, now time.Time) (*LotteryActivityView, error) {
	var activity LotteryActivity
	if err := DB.First(&activity, activityID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLotteryNotFound
		}
		return nil, err
	}
	date := LotteryBusinessDate(now)
	version, err := findLotteryVersionTx(DB, activityID, date)
	if err != nil && !errors.Is(err, ErrLotteryUnavailable) {
		return nil, err
	}
	var participation LotteryParticipation
	participationErr := DB.Where("activity_id = ? AND user_id = ? AND business_date = ?", activityID, userID, date).First(&participation).Error
	if participationErr != nil && !errors.Is(participationErr, gorm.ErrRecordNotFound) {
		return nil, participationErr
	}
	remainingAttempts := 0
	if !participation.BaseUsed {
		remainingAttempts = 1
	} else if participation.ExtraGranted > participation.ExtraUsed {
		remainingAttempts = participation.ExtraGranted - participation.ExtraUsed
	}
	// A missing published version is an intentional unavailable day. Return a
	// server-owned not-started view so the client can explain the state without
	// inventing a fallback version from a previous day.
	if errors.Is(err, ErrLotteryUnavailable) {
		status := "not_started"
		reason := "version_unavailable"
		if now.Unix() >= activity.EndAt || activity.Status == LotteryActivityEnded {
			status, reason = "ended", "activity_ended"
		} else if activity.Status == LotteryActivityPaused {
			status, reason = LotteryActivityPaused, "activity_paused"
		}
		return &LotteryActivityView{
			Activity:      activity,
			Version:       LotteryVersion{ActivityId: activityID, BusinessDate: date},
			Prizes:        []LotteryVersionPrizeView{},
			Qualification: LotteryQualification{Reason: reason, CheckedAt: now.Unix()},
			BusinessDate:  date, BaseUsed: participation.BaseUsed,
			RemainingAttempts: remainingAttempts,
			ExtraGranted:      participation.ExtraGranted > 0,
			ExtraAvailable:    participation.ExtraGranted > participation.ExtraUsed,
			Status:            status, EligibilityReason: reason,
		}, nil
	}
	prizes, err := loadLotteryVersionPrizesTx(DB, version.Id)
	if err != nil {
		return nil, err
	}
	prizeIDs := make([]int, 0, len(prizes))
	for _, item := range prizes {
		if item.Prize.Type == LotteryPrizeBalance {
			prizeIDs = append(prizeIDs, item.Prize.Id)
		}
	}
	if len(prizeIDs) > 0 {
		var dailyStocks []LotteryPrizeDailyStock
		if err := DB.Where("business_date = ? AND prize_id IN ?", date, prizeIDs).Find(&dailyStocks).Error; err != nil {
			return nil, err
		}
		dailyIssued := make(map[int]int64, len(dailyStocks))
		for _, stock := range dailyStocks {
			dailyIssued[stock.PrizeId] = stock.Issued
		}
		for i := range prizes {
			prizes[i].DailyIssued = dailyIssued[prizes[i].Prize.Id]
		}
	}
	consumed := int64(0)
	qualified := participation.BaseUsed
	if !participation.BaseUsed {
		consumed, err = calculateLotteryConsumption(userID, activity.ConsumeStartAt, activity.ConsumeEndAt, now.Unix(), version.QuotaPerUnit)
		if err != nil {
			return nil, err
		}
		qualified = consumed >= version.ThresholdQuota
	}
	status := LotteryActivityActive
	reason := "eligible"
	if now.Unix() < activity.StartAt {
		status = "not_started"
		reason = "activity_not_started"
	} else if now.Unix() >= activity.EndAt {
		status = "ended"
		reason = "activity_ended"
	} else if activity.Status == LotteryActivityDraft {
		status = "not_started"
		reason = "activity_not_started"
	} else if activity.Status == LotteryActivityEnded {
		status = "ended"
		reason = "activity_ended"
	} else if activity.Status == LotteryActivityPaused {
		status = LotteryActivityPaused
		reason = "activity_paused"
	} else if participation.BaseUsed && participation.ExtraUsed >= participation.ExtraGranted {
		status = "completed"
		reason = "attempts_exhausted"
	} else if participation.BaseUsed && participation.ExtraGranted > participation.ExtraUsed {
		status = "extra_available"
		reason = "extra_available"
	} else if qualified {
		status = "eligible"
		reason = "eligible"
	} else {
		status = "ineligible"
		reason = "threshold_not_met"
	}
	return &LotteryActivityView{
		Activity: activity, Version: *version, Prizes: prizes,
		Qualification: LotteryQualification{Eligible: qualified, ThresholdQuota: version.ThresholdQuota, Reason: reason, CheckedAt: now.Unix()},
		BusinessDate:  date, BaseUsed: participation.BaseUsed,
		RemainingAttempts: remainingAttempts,
		ExtraGranted:      participation.ExtraGranted > 0,
		ExtraAvailable:    participation.ExtraGranted > participation.ExtraUsed,
		Status:            status, EligibilityReason: reason,
	}, nil
}

func GetLotteryActivities(userID int, now time.Time) ([]LotteryActivityView, error) {
	var activities []LotteryActivity
	if err := DB.Where("end_at > ? AND status IN ?", now.Unix(), []string{LotteryActivityActive, LotteryActivityPaused}).Order("start_at asc, id asc").Find(&activities).Error; err != nil {
		return nil, err
	}
	result := make([]LotteryActivityView, 0, len(activities))
	for _, activity := range activities {
		view, err := GetLotteryActivityView(activity.Id, userID, now)
		if errors.Is(err, ErrLotteryUnavailable) {
			continue
		}
		if err != nil {
			return nil, err
		}
		result = append(result, *view)
	}
	return result, nil
}

func getOrCreateLotteryParticipationTx(tx *gorm.DB, activityID, userID int, businessDate string, now int64) (*LotteryParticipation, error) {
	seed := &LotteryParticipation{ActivityId: activityID, UserId: userID, BusinessDate: businessDate, ExtraGranted: 0, ExtraUsed: 0, CreatedAt: now, UpdatedAt: now}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(seed).Error; err != nil {
		return nil, err
	}
	var participation LotteryParticipation
	if err := lockForUpdate(tx).Where("activity_id = ? AND user_id = ? AND business_date = ?", activityID, userID, businessDate).First(&participation).Error; err != nil {
		return nil, err
	}
	return &participation, nil
}

func prizeHasStockTx(tx *gorm.DB, prize LotteryPrize, versionPrize LotteryVersionPrize, businessDate string) (bool, *LotteryPrizeDailyStock, error) {
	if prize.Type != LotteryPrizeBalance {
		return true, nil, nil
	}
	var current LotteryPrize
	if err := lockForUpdate(tx).First(&current, prize.Id).Error; err != nil {
		return false, nil, err
	}
	if current.TotalStock <= 0 || current.IssuedStock >= current.TotalStock {
		return false, nil, nil
	}
	var daily LotteryPrizeDailyStock
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&LotteryPrizeDailyStock{PrizeId: prize.Id, BusinessDate: businessDate}).Error; err != nil {
		return false, nil, err
	}
	if err := lockForUpdate(tx).Where("prize_id = ? AND business_date = ?", prize.Id, businessDate).First(&daily).Error; err != nil {
		return false, nil, err
	}
	if versionPrize.DailyLimit > 0 && daily.Issued >= versionPrize.DailyLimit {
		return false, &daily, nil
	}
	return true, &daily, nil
}

func lotteryDrawResultTx(tx *gorm.DB, draw *LotteryDraw, reused bool) (*LotteryDrawResult, error) {
	if draw == nil {
		return nil, ErrLotteryNotFound
	}
	var prize LotteryPrize
	if err := tx.First(&prize, draw.FinalPrizeId).Error; err != nil {
		return nil, err
	}
	var award LotteryAward
	if err := tx.Where("draw_id = ?", draw.Id).First(&award).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	result := &LotteryDrawResult{Draw: *draw, Prize: prize, Reused: reused}
	if award.Id != 0 {
		result.Award = &award
	}
	return result, nil
}

func drawLotteryTx(tx *gorm.DB, activityID, userID int, idempotencyKey string, acceptedAt time.Time, qualification *int64) (*LotteryDrawResult, error) {
	date := LotteryBusinessDate(acceptedAt)
	var user User
	if err := lockForUpdate(tx).Select("id, status, quota").First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLotteryAccountUnavailable
		}
		return nil, err
	}
	var activity LotteryActivity
	if err := lockForUpdate(tx).First(&activity, activityID).Error; err != nil {
		return nil, ErrLotteryNotFound
	}
	// Idempotency keys are scoped to a user. The user row lock serializes draws
	// across activities and business dates, so a key cannot be accepted twice
	// even when requests arrive concurrently for different activities.
	var keyedDraws []LotteryDraw
	if err := lockForUpdate(tx).Where("user_id = ? AND idempotency_key = ?", userID, idempotencyKey).Order("id asc").Find(&keyedDraws).Error; err != nil {
		return nil, err
	}
	for i := range keyedDraws {
		if keyedDraws[i].ActivityId != activityID || keyedDraws[i].BusinessDate != date {
			return nil, ErrLotteryIdempotencyConflict
		}
		return lotteryDrawResultTx(tx, &keyedDraws[i], true)
	}
	if user.Status != common.UserStatusEnabled {
		return nil, ErrLotteryAccountUnavailable
	}
	if activity.Status != LotteryActivityActive || acceptedAt.Unix() < activity.StartAt || acceptedAt.Unix() >= activity.EndAt {
		var latest LotteryDraw
		if latestErr := tx.Where("activity_id = ? AND user_id = ? AND business_date = ?", activityID, userID, date).
			Order("attempt_no desc, id desc").First(&latest).Error; latestErr == nil {
			var participation LotteryParticipation
			participationErr := tx.Where("activity_id = ? AND user_id = ? AND business_date = ?", activityID, userID, date).First(&participation).Error
			maxExtra := max(0, min(activity.MaxAttempts, LotteryMaxAttempts)-1)
			if participationErr == nil && participation.BaseUsed && (participation.ExtraGranted <= participation.ExtraUsed || participation.ExtraUsed >= maxExtra) {
				return lotteryDrawResultTx(tx, &latest, true)
			}
			if participationErr != nil && !errors.Is(participationErr, gorm.ErrRecordNotFound) {
				return nil, participationErr
			}
		}
		return nil, ErrLotteryUnavailable
	}
	participation, err := getOrCreateLotteryParticipationTx(tx, activityID, userID, date, acceptedAt.Unix())
	if err != nil {
		return nil, err
	}
	attemptNo := 1
	usingExtra := false
	if participation.BaseUsed {
		maxExtra := max(0, min(activity.MaxAttempts, LotteryMaxAttempts)-1)
		if participation.ExtraGranted <= participation.ExtraUsed || participation.ExtraUsed >= maxExtra {
			var latest LotteryDraw
			latestErr := tx.Where("activity_id = ? AND user_id = ? AND business_date = ?", activityID, userID, date).
				Order("attempt_no desc, id desc").First(&latest).Error
			if latestErr == nil {
				return lotteryDrawResultTx(tx, &latest, true)
			}
			if !errors.Is(latestErr, gorm.ErrRecordNotFound) {
				return nil, latestErr
			}
			return nil, ErrLotteryAlreadyDrawn
		}
		attemptNo = participation.ExtraUsed + 2
		usingExtra = true
	}
	version, err := findLotteryVersionTx(tx, activityID, date)
	if err != nil {
		return nil, err
	}
	prizes, err := loadLotteryVersionPrizesTx(tx, version.Id)
	if err != nil {
		return nil, err
	}
	if err := ValidateLotteryVersion(version, prizes); err != nil {
		return nil, err
	}
	if !usingExtra {
		if qualification == nil {
			logDB := LOG_DB
			if LOG_DB == DB {
				// Tests and single-database deployments can point both handles at
				// the same pool. Reuse the transaction connection in that case;
				// opening a second query while the transaction owns the only
				// SQLite connection would otherwise block indefinitely.
				logDB = tx
			}
			consumed, err := calculateLotteryConsumptionFromDB(logDB, tx, userID, activity.ConsumeStartAt, activity.ConsumeEndAt, acceptedAt.Unix(), version.QuotaPerUnit)
			if err != nil {
				return nil, err
			}
			qualification = &consumed
		}
		if qualification == nil || *qualification < version.ThresholdQuota {
			return nil, ErrLotteryNotEligible
		}
	}
	randomValue, err := lotteryRandomSource()
	if err != nil {
		return nil, err
	}
	raw, rangeStart, rangeEnd, err := chooseLotteryPrize(prizes, randomValue)
	if err != nil {
		return nil, err
	}
	final := raw
	conversionReason := ""
	if raw.Prize.Type == LotteryPrizeBalance {
		available, _, err := prizeHasStockTx(tx, raw.Prize, raw.LotteryVersionPrize, date)
		if err != nil {
			return nil, err
		}
		if !available {
			for _, candidate := range prizes {
				if candidate.Prize.Type == LotteryPrizeThanks {
					final = candidate
					break
				}
			}
			conversionReason = "stock_unavailable"
		}
		if final.Prize.Id == raw.Prize.Id && int64(user.Quota) > int64(common.MaxWalletQuota)-raw.Prize.BalanceQuota {
			return nil, ErrLotteryWalletLimit
		}
	}
	if raw.Prize.Type == LotteryPrizeAgain {
		if usingExtra || activity.MaxAttempts <= 1 {
			for _, candidate := range prizes {
				if candidate.Prize.Type == LotteryPrizeThanks {
					final = candidate
					break
				}
			}
			conversionReason = "extra_attempt_limit"
		} else {
			participation.ExtraGranted++
		}
	}
	if raw.Prize.Type == LotteryPrizeBalance && final.Prize.Id == raw.Prize.Id {
		var daily LotteryPrizeDailyStock
		if err := lockForUpdate(tx).Where("prize_id = ? AND business_date = ?", raw.Prize.Id, date).First(&daily).Error; err != nil {
			return nil, err
		}
		stockUpdate := tx.Model(&LotteryPrize{}).Where("id = ? AND issued_stock < total_stock", raw.Prize.Id).Update("issued_stock", gorm.Expr("issued_stock + 1"))
		if stockUpdate.Error != nil {
			return nil, stockUpdate.Error
		}
		if stockUpdate.RowsAffected != 1 {
			return nil, errors.New("lottery prize stock exhausted")
		}
		if err := tx.Model(&LotteryPrizeDailyStock{}).Where("id = ?", daily.Id).Updates(map[string]any{"issued": gorm.Expr("issued + 1"), "updated_at": acceptedAt.Unix()}).Error; err != nil {
			return nil, err
		}
	}
	if !participation.BaseUsed {
		participation.BaseUsed = true
	}
	if usingExtra {
		participation.ExtraUsed++
	}
	participation.UpdatedAt = acceptedAt.Unix()
	if err := tx.Save(participation).Error; err != nil {
		return nil, err
	}
	draw := &LotteryDraw{
		ActivityId: activityID, VersionId: version.Id, UserId: userID, BusinessDate: date,
		AttemptNo: attemptNo, IdempotencyKey: idempotencyKey, RawPrizeId: raw.Prize.Id,
		FinalPrizeId: final.Prize.Id, RandomValue: randomValue, RangeStart: rangeStart,
		RangeEnd: rangeEnd, RandomAlgorithm: LotteryRandomAlgorithm, ConversionReason: conversionReason, Status: LotteryDrawCompleted,
		BalanceQuota: final.Prize.BalanceQuota,
		CreatedAt:    acceptedAt.Unix(),
	}
	if err := tx.Create(draw).Error; err != nil {
		// All mutable state has already been changed in this transaction. Do not
		// turn a late unique-key conflict into a successful retry response: that
		// would commit a second wallet credit and inventory decrement. Returning
		// the error rolls the transaction back; the caller can retry and receive
		// the committed idempotent result.
		return nil, err
	}
	var award *LotteryAward
	if final.Prize.Type == LotteryPrizeBalance && final.Prize.BalanceQuota > 0 {
		walletUpdate := tx.Model(&User{}).Where("id = ? AND status = ? AND quota <= ?", userID, common.UserStatusEnabled, int64(common.MaxWalletQuota)-final.Prize.BalanceQuota).Update("quota", gorm.Expr("quota + ?", final.Prize.BalanceQuota))
		if walletUpdate.Error != nil {
			return nil, walletUpdate.Error
		}
		if walletUpdate.RowsAffected != 1 {
			return nil, ErrLotteryWalletLimit
		}
		award = &LotteryAward{DrawId: draw.Id, ActivityId: activityID, UserId: userID, PrizeId: final.Prize.Id, Quota: final.Prize.BalanceQuota, Status: LotteryAwardGranted, CreatedAt: acceptedAt.Unix()}
		if err := tx.Create(award).Error; err != nil {
			return nil, err
		}
	}
	return &LotteryDrawResult{Draw: *draw, Prize: final.Prize, Award: award}, nil
}

func findLotteryDrawByIdempotencyKey(activityID, userID int, businessDate, idempotencyKey string) (*LotteryDrawResult, error) {
	var draw LotteryDraw
	err := DB.Where("activity_id = ? AND user_id = ? AND business_date = ? AND idempotency_key = ?", activityID, userID, businessDate, idempotencyKey).First(&draw).Error
	if err != nil {
		return nil, err
	}
	result, err := lotteryDrawResultTx(DB, &draw, true)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func DrawLottery(activityID, userID int, idempotencyKey string, acceptedAt time.Time) (*LotteryDrawResult, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if len(idempotencyKey) == 0 || len(idempotencyKey) > 128 {
		return nil, errors.New("invalid idempotency key")
	}
	date := LotteryBusinessDate(acceptedAt)
	existing, existingErr := findLotteryDrawByIdempotencyKey(activityID, userID, date, idempotencyKey)
	if existingErr == nil {
		return existing, nil
	}
	if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		return nil, existingErr
	}
	var result *LotteryDrawResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = drawLotteryTx(tx, activityID, userID, idempotencyKey, acceptedAt, nil)
		return err
	})
	if err != nil {
		// A concurrent request with the same key can commit immediately before
		// this transaction's unique insert fails. Resolve that race to the
		// committed result so retries remain idempotent across all databases.
		if existing, lookupErr := findLotteryDrawByIdempotencyKey(activityID, userID, date, idempotencyKey); lookupErr == nil {
			return existing, nil
		}
		return nil, err
	}
	if result.Award != nil && !result.Reused {
		syncCreditUserQuotaCache(userID, int(result.Award.Quota), "lottery award")
	}
	return result, nil
}

func normalizeLotteryHistoryPage(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func loadLotteryDrawResults(tx *gorm.DB, draws []LotteryDraw) ([]LotteryDrawResult, error) {
	result := make([]LotteryDrawResult, 0, len(draws))
	for i := range draws {
		item, err := lotteryDrawResultTx(tx, &draws[i], false)
		if err != nil {
			return nil, err
		}
		result = append(result, *item)
	}
	return result, nil
}

func GetLotteryHistoryPage(activityID, userID int, businessDate string, page, pageSize int) (*LotteryHistoryPage, error) {
	page, pageSize = normalizeLotteryHistoryPage(page, pageSize)
	query := DB.Model(&LotteryDraw{}).Where("activity_id = ? AND user_id = ?", activityID, userID)
	if businessDate != "" {
		query = query.Where("business_date = ?", businessDate)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var draws []LotteryDraw
	if err := query.Order("created_at desc, attempt_no desc, id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&draws).Error; err != nil {
		return nil, err
	}
	items, err := loadLotteryDrawResults(DB, draws)
	if err != nil {
		return nil, err
	}
	return &LotteryHistoryPage{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

// GetLotteryHistory remains as a compatibility helper for callers that need
// the complete history. New API handlers should use GetLotteryHistoryPage.
func GetLotteryHistory(activityID, userID int, businessDate string) ([]LotteryDrawResult, error) {
	query := DB.Where("activity_id = ? AND user_id = ?", activityID, userID)
	if businessDate != "" {
		query = query.Where("business_date = ?", businessDate)
	}
	var draws []LotteryDraw
	if err := query.Order("created_at desc, attempt_no desc, id desc").Find(&draws).Error; err != nil {
		return nil, err
	}
	return loadLotteryDrawResults(DB, draws)
}

type LotteryAuditRecord struct {
	DrawID           int    `json:"draw_id"`
	UserID           int    `json:"user_id"`
	BusinessDate     string `json:"business_date"`
	AttemptNo        int    `json:"attempt_no"`
	IdempotencyKey   string `json:"idempotency_key"`
	VersionID        int    `json:"version_id"`
	RawPrizeID       int    `json:"raw_prize_id"`
	FinalPrizeID     int    `json:"final_prize_id"`
	RandomValue      int64  `json:"random_value"`
	RangeStart       int64  `json:"range_start"`
	RangeEnd         int64  `json:"range_end"`
	RandomAlgorithm  string `json:"random_algorithm"`
	ConversionReason string `json:"conversion_reason"`
	Status           string `json:"status"`
	AwardID          int    `json:"award_id"`
	AwardStatus      string `json:"award_status"`
	CreatedAt        int64  `json:"created_at"`
}

type LotteryAuditPage struct {
	Items    []LotteryAuditRecord `json:"items"`
	Total    int64                `json:"total"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"page_size"`
}

func GetLotteryAuditPage(activityID int, businessDate string, page, pageSize int) (*LotteryAuditPage, error) {
	page, pageSize = normalizeLotteryHistoryPage(page, pageSize)
	var activity LotteryActivity
	if err := DB.First(&activity, activityID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLotteryNotFound
		}
		return nil, err
	}
	query := DB.Model(&LotteryDraw{}).Where("activity_id = ?", activityID)
	if businessDate != "" {
		query = query.Where("business_date = ?", businessDate)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var draws []LotteryDraw
	if err := query.Order("created_at desc, id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&draws).Error; err != nil {
		return nil, err
	}
	items := make([]LotteryAuditRecord, 0, len(draws))
	for i := range draws {
		item := LotteryAuditRecord{
			DrawID: draws[i].Id, UserID: draws[i].UserId, BusinessDate: draws[i].BusinessDate,
			AttemptNo: draws[i].AttemptNo, IdempotencyKey: draws[i].IdempotencyKey, VersionID: draws[i].VersionId, RawPrizeID: draws[i].RawPrizeId,
			FinalPrizeID: draws[i].FinalPrizeId, RandomValue: draws[i].RandomValue, RangeStart: draws[i].RangeStart,
			RangeEnd: draws[i].RangeEnd, RandomAlgorithm: draws[i].RandomAlgorithm,
			ConversionReason: draws[i].ConversionReason, Status: draws[i].Status, CreatedAt: draws[i].CreatedAt,
		}
		var award LotteryAward
		if err := DB.Where("draw_id = ?", draws[i].Id).First(&award).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		if award.Id != 0 {
			item.AwardID, item.AwardStatus = award.Id, award.Status
		}
		items = append(items, item)
	}
	return &LotteryAuditPage{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func CreateLotteryActivity(activity *LotteryActivity) error {
	if activity == nil {
		return ErrLotteryInvalidConfig
	}
	if activity.MaxAttempts == 0 {
		activity.MaxAttempts = LotteryMaxAttempts
	}
	activity.Name = strings.TrimSpace(activity.Name)
	if err := validateLotteryActivity(activity); err != nil {
		return err
	}
	now := common.GetTimestamp()
	activity.Status = LotteryActivityDraft
	activity.CreatedAt, activity.UpdatedAt = now, now
	return DB.Create(activity).Error
}

// CreateLotteryVersionTx creates an immutable draft and its version-prize rows
// in the caller's transaction. New prize definitions can be resolved by the
// caller in the same transaction before invoking this function.
func CreateLotteryVersionTx(tx *gorm.DB, version *LotteryVersion, prizes []LotteryVersionPrizeView) error {
	if tx == nil {
		return ErrLotteryInvalidConfig
	}
	if version == nil || len(prizes) == 0 {
		return ErrLotteryInvalidConfig
	}
	if version.QuotaPerUnit == 0 {
		version.QuotaPerUnit = common.QuotaPerUnit
	}
	if err := ValidateLotteryVersion(version, prizes); err != nil {
		return err
	}
	now := common.GetTimestamp()
	var activity LotteryActivity
	if err := lockForUpdate(tx).First(&activity, version.ActivityId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLotteryNotFound
		}
		return err
	}
	var count int64
	if err := tx.Model(&LotteryVersion{}).Where("activity_id = ? AND business_date = ?", version.ActivityId, version.BusinessDate).Count(&count).Error; err != nil {
		return err
	}
	version.Revision = int(count) + 1
	version.Status = LotteryVersionDraft
	version.CreatedAt, version.UpdatedAt = now, now
	if err := tx.Create(version).Error; err != nil {
		return err
	}
	for i := range prizes {
		item := prizes[i].LotteryVersionPrize
		item.Id = 0
		item.VersionId = version.Id
		if item.PrizeId == 0 {
			item.PrizeId = prizes[i].Prize.Id
		}
		if item.PrizeId <= 0 || item.PrizeId != prizes[i].Prize.Id {
			return ErrLotteryInvalidConfig
		}
		if err := tx.Create(&item).Error; err != nil {
			return err
		}
	}
	return nil
}

func CreateLotteryVersion(version *LotteryVersion, prizes []LotteryVersionPrizeView) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		return CreateLotteryVersionTx(tx, version, prizes)
	})
}

func ListLotteryVersions(activityID int) ([]LotteryVersion, error) {
	var versions []LotteryVersion
	if err := DB.Where("activity_id = ?", activityID).Order("business_date asc, revision desc").Find(&versions).Error; err != nil {
		return nil, err
	}
	return versions, nil
}

func PublishLotteryVersion(versionID, operatorID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var version LotteryVersion
		if err := lockForUpdate(tx).First(&version, versionID).Error; err != nil {
			return err
		}
		if version.Status == LotteryVersionPublished {
			return nil
		}
		var activity LotteryActivity
		if err := lockForUpdate(tx).First(&activity, version.ActivityId).Error; err != nil {
			return err
		}
		date, err := time.ParseInLocation("2006-01-02", version.BusinessDate, lotteryLocation())
		tomorrow := LotteryBusinessDate(time.Now().In(lotteryLocation()).Add(24 * time.Hour))
		if err != nil || version.BusinessDate < tomorrow || LotteryBusinessDate(date) != version.BusinessDate {
			return errors.New("version must be published for a future business date")
		}
		var existing LotteryVersion
		existingErr := tx.Where("activity_id = ? AND business_date = ? AND status = ?", version.ActivityId, version.BusinessDate, LotteryVersionPublished).First(&existing).Error
		if existingErr == nil && existing.Id != version.Id {
			return errors.New("a published version already exists for this business date")
		}
		if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		prizes, err := loadLotteryVersionPrizesTx(tx, version.Id)
		if err != nil {
			return err
		}
		if err := ValidateLotteryVersion(&version, prizes); err != nil {
			return err
		}
		version.Status, version.PublishedAt, version.PublishedBy = LotteryVersionPublished, common.GetTimestamp(), operatorID
		return tx.Save(&version).Error
	})
}

func SetLotteryActivityStatus(activityID int, status string, operatorID int) error {
	if status != LotteryActivityActive && status != LotteryActivityPaused && status != LotteryActivityEnded {
		return ErrLotteryInvalidConfig
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var activity LotteryActivity
		if err := lockForUpdate(tx).First(&activity, activityID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrLotteryNotFound
			}
			return err
		}
		if activity.Status == LotteryActivityEnded && status != LotteryActivityEnded {
			return ErrLotteryInvalidConfig
		}
		if status == LotteryActivityActive && common.GetTimestamp() >= activity.EndAt {
			return ErrLotteryInvalidConfig
		}
		return tx.Model(&activity).Updates(map[string]any{"status": status, "updated_by": operatorID, "updated_at": common.GetTimestamp()}).Error
	})
}

func AdjustLotteryStock(activityID, prizeID, operatorID int, requestID string, delta int64, reason string) (*LotteryStockAdjustment, error) {
	requestID = strings.TrimSpace(requestID)
	reason = strings.TrimSpace(reason)
	if activityID <= 0 || prizeID <= 0 || delta <= 0 || delta > common.MaxWalletQuota || requestID == "" || len(requestID) > 128 || len(reason) > 255 {
		return nil, ErrLotteryInvalidConfig
	}
	var adjustment LotteryStockAdjustment
	err := DB.Transaction(func(tx *gorm.DB) error {
		var activity LotteryActivity
		if err := lockForUpdate(tx).First(&activity, activityID).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where("request_id = ?", requestID).First(&adjustment).Error; err == nil {
			if adjustment.ActivityId != activityID || adjustment.PrizeId != prizeID || adjustment.Delta != delta {
				return ErrLotteryInvalidConfig
			}
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var linked LotteryVersionPrize
		versionIDs := tx.Model(&LotteryVersion{}).Select("id").Where("activity_id = ?", activityID)
		if err := tx.Where("prize_id = ? AND version_id IN (?)", prizeID, versionIDs).First(&linked).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrLotteryInvalidConfig
			}
			return err
		}
		var prize LotteryPrize
		if err := lockForUpdate(tx).First(&prize, prizeID).Error; err != nil {
			return err
		}
		if prize.ActivityId != activityID || prize.Type != LotteryPrizeBalance {
			return ErrLotteryInvalidConfig
		}
		before := prize.TotalStock
		if before > common.MaxWalletQuota-delta {
			return ErrLotteryInvalidConfig
		}
		prize.TotalStock += delta
		prize.UpdatedAt = common.GetTimestamp()
		if err := tx.Save(&prize).Error; err != nil {
			return err
		}
		adjustment = LotteryStockAdjustment{RequestId: requestID, ActivityId: activityID, PrizeId: prizeID, Delta: delta, BeforeStock: before, AfterStock: prize.TotalStock, OperatorId: operatorID, Reason: reason, CreatedAt: common.GetTimestamp()}
		return tx.Create(&adjustment).Error
	})
	return &adjustment, err
}
