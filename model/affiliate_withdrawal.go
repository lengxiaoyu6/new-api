package model

import (
	"errors"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	AffiliateWithdrawalPending  = "pending"
	AffiliateWithdrawalPaid     = "paid"
	AffiliateWithdrawalRejected = "rejected"
)

var (
	ErrAffiliateBalanceChanged         = errors.New("Referral balance changed. Please try again.")
	ErrAffiliateWithdrawalInvalid      = errors.New("Invalid withdrawal details.")
	ErrAffiliateWithdrawalInsufficient = errors.New("Insufficient withdrawable top-up rebates.")
	ErrAffiliateWithdrawalProcessed    = errors.New("This withdrawal has already been processed.")
	ErrAffiliateWithdrawalConflict     = errors.New("This withdrawal request ID has already been used.")
)

type AffiliateWithdrawal struct {
	ID          int    `json:"id" gorm:"primaryKey"`
	UserID      int    `json:"user_id" gorm:"not null;uniqueIndex:idx_aff_withdrawal_request;index:idx_aff_withdrawal_user"`
	RequestID   string `json:"request_id" gorm:"type:varchar(36);not null;uniqueIndex:idx_aff_withdrawal_request"`
	Quota       int    `json:"quota" gorm:"type:bigint;not null"`
	AmountUSD   string `json:"amount_usd" gorm:"type:varchar(64);not null"`
	Method      string `json:"method" gorm:"type:varchar(64);not null"`
	AccountName string `json:"account_name" gorm:"type:varchar(100);not null"`
	Account     string `json:"account" gorm:"type:varchar(200);not null"`
	Status      string `json:"status" gorm:"type:varchar(16);not null;index:idx_aff_withdrawal_status"`
	ReviewNote  string `json:"review_note" gorm:"type:varchar(500)"`
	ReviewerID  int    `json:"reviewer_id"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	ReviewedAt  int64  `json:"reviewed_at"`
}

type AffiliateWithdrawalRequest struct {
	RequestID   string `json:"request_id"`
	Quota       int    `json:"quota"`
	Method      string `json:"method"`
	AccountName string `json:"account_name"`
	Account     string `json:"account"`
}

func (request *AffiliateWithdrawalRequest) Normalize() error {
	id, err := uuid.Parse(request.RequestID)
	if err != nil || id == uuid.Nil || request.Quota <= 0 || request.Quota > common.MaxWalletQuota {
		return ErrAffiliateWithdrawalInvalid
	}
	request.RequestID = id.String()
	request.Method = strings.TrimSpace(request.Method)
	request.AccountName = strings.TrimSpace(request.AccountName)
	request.Account = strings.TrimSpace(request.Account)
	if request.Method == "" || utf8.RuneCountInString(request.Method) > 64 || request.AccountName == "" || utf8.RuneCountInString(request.AccountName) > 100 || request.Account == "" || utf8.RuneCountInString(request.Account) > 200 {
		return ErrAffiliateWithdrawalInvalid
	}
	return nil
}

// initializeAffiliateWithdrawal reconstructs legacy balances only when the complete
// earnings ledger reconciles with both stored totals. Incomplete histories retain
// their transferable balance. Subsequent eligibility is accounted for transactionally.
// The caller holds the user row lock, before recording any new reward or transfer.
func initializeAffiliateWithdrawal(tx *gorm.DB, user *User) error {
	if user.AffWithdrawalInitialized {
		return nil
	}
	logDB := LOG_DB
	if LOG_DB == DB {
		logDB = tx
	}
	var earned, registration, rebate int64
	complete := true
	lastID := 0
	if user.AffHistoryQuota > 0 && user.AffQuota > 0 {
		for {
			var logs []Log
			if err := logDB.Select("id", "quota", "other").Where("user_id = ? AND type = ? AND id > ?", user.Id, LogTypeAff, lastID).Order("id ASC").Limit(500).Find(&logs).Error; err != nil {
				return err
			}
			for _, entry := range logs {
				lastID = entry.Id
				var detail struct {
					Kind string `json:"kind"`
				}
				if common.UnmarshalJsonStr(entry.Other, &detail) != nil {
					complete = false
					break
				}
				amount := int64(entry.Quota)
				switch detail.Kind {
				case "register", "topup":
					if amount <= 0 || amount > int64(common.MaxWalletQuota)-earned {
						complete = false
						break
					}
					earned += amount
					if detail.Kind == "register" {
						registration += amount
					} else {
						rebate += amount
					}
				case "transfer":
					if amount >= 0 || amount < -(registration+rebate) {
						complete = false
						break
					}
					consumed := min(registration, -amount)
					registration -= consumed
					rebate -= -amount - consumed
				default:
					complete = false
				}
				if !complete {
					break
				}
			}
			if !complete || len(logs) < 500 {
				break
			}
		}
	}
	if complete && earned == int64(user.AffHistoryQuota) && registration+rebate == int64(user.AffQuota) {
		user.AffWithdrawableQuota = int(rebate)
	} else {
		user.AffWithdrawableQuota = 0
	}
	result := tx.Model(&User{}).Where("id = ? AND aff_withdrawal_initialized = ?", user.Id, false).Updates(map[string]any{
		"aff_withdrawable_quota":     user.AffWithdrawableQuota,
		"aff_withdrawal_initialized": true,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrAffiliateBalanceChanged
	}
	user.AffWithdrawalInitialized = true
	return nil
}

func GetAffiliateUser(userID int) (*User, error) {
	var user User
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		return initializeAffiliateWithdrawal(tx, &user)
	})
	return &user, err
}

func CreateAffiliateWithdrawal(userID int, request AffiliateWithdrawalRequest) (*AffiliateWithdrawal, error) {
	if err := request.Normalize(); err != nil {
		return nil, err
	}
	if common.QuotaPerUnit <= 0 || math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) {
		return nil, ErrAffiliateWithdrawalInvalid
	}
	var withdrawal AffiliateWithdrawal
	created := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if err := initializeAffiliateWithdrawal(tx, &user); err != nil {
			return err
		}
		err := tx.Where("user_id = ? AND request_id = ?", userID, request.RequestID).First(&withdrawal).Error
		if err == nil {
			if withdrawal.Quota != request.Quota || withdrawal.Method != request.Method || withdrawal.AccountName != request.AccountName || withdrawal.Account != request.Account {
				return ErrAffiliateWithdrawalConflict
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if user.AffWithdrawableQuota < request.Quota || user.AffQuota < request.Quota {
			return ErrAffiliateWithdrawalInsufficient
		}
		result := tx.Model(&User{}).Where("id = ? AND aff_quota >= ? AND aff_withdrawable_quota >= ?", userID, request.Quota, request.Quota).Updates(map[string]any{
			"aff_quota":              gorm.Expr("aff_quota - ?", request.Quota),
			"aff_withdrawable_quota": gorm.Expr("aff_withdrawable_quota - ?", request.Quota),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrAffiliateWithdrawalInsufficient
		}
		withdrawal = AffiliateWithdrawal{
			UserID: userID, RequestID: request.RequestID, Quota: request.Quota,
			AmountUSD: decimal.NewFromInt(int64(request.Quota)).Div(decimal.NewFromFloat(common.QuotaPerUnit)).String(),
			Method:    request.Method, AccountName: request.AccountName, Account: request.Account,
			Status: AffiliateWithdrawalPending,
		}
		if err := tx.Create(&withdrawal).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, err
	}
	if created {
		RecordAffiliateLog(userID, "withdrawal", -request.Quota, map[string]any{"withdrawal_id": withdrawal.ID})
	}
	return &withdrawal, nil
}

func ReviewAffiliateWithdrawal(id, reviewerID int, status, note string) (*AffiliateWithdrawal, error) {
	note = strings.TrimSpace(note)
	if id <= 0 || reviewerID <= 0 || (status != AffiliateWithdrawalPaid && status != AffiliateWithdrawalRejected) || note == "" || utf8.RuneCountInString(note) > 500 {
		return nil, ErrAffiliateWithdrawalInvalid
	}
	var withdrawal AffiliateWithdrawal
	refunded := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&withdrawal, id).Error; err != nil {
			return err
		}
		if withdrawal.Status == status {
			return nil
		}
		if withdrawal.Status != AffiliateWithdrawalPending {
			return ErrAffiliateWithdrawalProcessed
		}
		if status == AffiliateWithdrawalRejected {
			result := tx.Model(&User{}).Where("id = ? AND aff_quota <= ? AND aff_withdrawable_quota <= ?", withdrawal.UserID, common.MaxWalletQuota-withdrawal.Quota, common.MaxWalletQuota-withdrawal.Quota).Updates(map[string]any{
				"aff_quota":              gorm.Expr("aff_quota + ?", withdrawal.Quota),
				"aff_withdrawable_quota": gorm.Expr("aff_withdrawable_quota + ?", withdrawal.Quota),
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrAffiliateBalanceChanged
			}
			refunded = true
		}
		withdrawal.Status, withdrawal.ReviewNote, withdrawal.ReviewerID, withdrawal.ReviewedAt = status, note, reviewerID, common.GetTimestamp()
		result := tx.Model(&AffiliateWithdrawal{}).Where("id = ? AND status = ?", id, AffiliateWithdrawalPending).Updates(map[string]any{
			"status": status, "review_note": note, "reviewer_id": reviewerID, "reviewed_at": withdrawal.ReviewedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrAffiliateWithdrawalProcessed
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if refunded {
		RecordAffiliateLog(withdrawal.UserID, "withdrawal_refund", withdrawal.Quota, map[string]any{"withdrawal_id": id})
	}
	return &withdrawal, nil
}

func ListAffiliateWithdrawals(userID int, page *common.PageInfo) ([]AffiliateWithdrawal, error) {
	query := DB.Model(&AffiliateWithdrawal{})
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	items := make([]AffiliateWithdrawal, 0)
	if err := query.Order("id DESC").Limit(page.GetPageSize()).Offset(page.GetStartIdx()).Find(&items).Error; err != nil {
		return nil, err
	}
	page.SetTotal(int(total))
	return items, nil
}
