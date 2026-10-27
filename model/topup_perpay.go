package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const PaymentProviderPerPay = "perpay"
const TopUpStatusDisputed = "disputed"

// PerPayOrder keeps the immutable create request for recovery after an ambiguous
// timeout. Requested, payable and received amounts never determine wallet quota.
type PerPayOrder struct {
	TradeNo              string `gorm:"primaryKey;type:varchar(255)" json:"trade_no"`
	OrderID              string `gorm:"type:varchar(64);index" json:"order_id"`
	ClientID             string `gorm:"type:varchar(128)" json:"-"`
	Endpoint             string `gorm:"type:text" json:"-"`
	RequestBody          string `gorm:"type:text" json:"-"`
	RequestedAmountCents int64  `json:"requested_amount_cents"`
	PayableAmountCents   int64  `json:"payable_amount_cents"`
	ReceivedAmountCents  int64  `json:"received_amount_cents"`
	Version              int64  `json:"version"`
	PaymentStatus        string `gorm:"type:varchar(32)" json:"payment_status"`
	RefundStatus         string `gorm:"type:varchar(16)" json:"refund_status"`
	CheckoutStatus       string `gorm:"type:varchar(16)" json:"checkout_status"`
	CreateTime           int64  `gorm:"index" json:"-"`
	LastCheckedAt        int64  `gorm:"index" json:"-"`
}

type PerPayEvent struct {
	EventID     string `gorm:"primaryKey;type:varchar(64)"`
	TradeNo     string `gorm:"type:varchar(255);index"`
	Fingerprint string `gorm:"type:varchar(64)"`
	Version     int64
	CreateTime  int64
}

// PerPaySnapshot is constructed only from an authenticated server-side query.
type PerPaySnapshot struct {
	OrderID              string
	MerchantOrderNo      string
	RequestedAmountCents int64
	PayableAmountCents   int64
	ReceivedAmountCents  int64
	Currency             string
	PaymentStatus        string
	RefundStatus         string
	CheckoutStatus       string
	Version              int64
}

var ErrPerPayOrderMismatch = errors.New("PerPay order verification failed")

func CreatePerPayTopUp(topUp *TopUp, order *PerPayOrder) error {
	if topUp.PaymentProvider != PaymentProviderPerPay || topUp.TradeNo != order.TradeNo {
		return ErrPaymentMethodMismatch
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(topUp).Error; err != nil {
			return err
		}
		return tx.Create(order).Error
	})
}

func GetPerPayOrder(tradeNo string) (*PerPayOrder, error) {
	var order PerPayOrder
	err := DB.Where("trade_no = ?", tradeNo).First(&order).Error
	return &order, err
}

func GetPerPayOrdersToCheck(now int64, clientID, endpoint string) ([]PerPayOrder, error) {
	var orders []PerPayOrder
	// Recheck pending and terminal orders for 48 hours, including disputes.
	err := DB.Where("create_time >= ? AND last_checked_at < ? AND client_id = ? AND endpoint = ?", now-48*3600, now-60, clientID, endpoint).
		Order("last_checked_at asc").Limit(50).Find(&orders).Error
	return orders, err
}

// ApplyPerPaySnapshot records an event and applies its authoritative order
// snapshot in the same transaction as quota credit. Newer disputes are retained;
// an older confirmation cannot restore payment or credit the order again.
func ApplyPerPaySnapshot(clientID, endpoint string, snapshot PerPaySnapshot, event *PerPayEvent, callerIP string) error {
	var topUp TopUp
	var creditedQuota, inviterID, rebateQuota int
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("trade_no = ?", snapshot.MerchantOrderNo).First(&topUp).Error; err != nil {
			return err
		}
		if topUp.PaymentProvider != PaymentProviderPerPay {
			return ErrPaymentMethodMismatch
		}
		var order PerPayOrder
		if err := lockForUpdate(tx).Where("trade_no = ?", topUp.TradeNo).First(&order).Error; err != nil {
			return err
		}
		if clientID != order.ClientID || endpoint != order.Endpoint ||
			snapshot.OrderID == "" || (order.OrderID != "" && snapshot.OrderID != order.OrderID) ||
			snapshot.Currency != "CNY" || snapshot.RequestedAmountCents != order.RequestedAmountCents ||
			snapshot.PayableAmountCents <= snapshot.RequestedAmountCents ||
			snapshot.PayableAmountCents > 9_999_999_999 ||
			(order.PayableAmountCents != 0 && snapshot.PayableAmountCents != order.PayableAmountCents) ||
			snapshot.ReceivedAmountCents < 0 || snapshot.ReceivedAmountCents > 9_999_999_999 ||
			snapshot.Version < 1 {
			return ErrPerPayOrderMismatch
		}
		switch snapshot.PaymentStatus {
		case "UNPAID", "CONFIRMED", "DISPUTED":
		default:
			return ErrPerPayOrderMismatch
		}
		switch snapshot.RefundStatus {
		case "NONE", "PARTIAL", "FULL":
		default:
			return ErrPerPayOrderMismatch
		}
		if snapshot.PaymentStatus == "CONFIRMED" && snapshot.ReceivedAmountCents != snapshot.PayableAmountCents {
			return ErrPerPayOrderMismatch
		}
		if event != nil {
			if event.TradeNo != topUp.TradeNo || snapshot.Version < event.Version {
				return ErrPerPayOrderMismatch
			}
			var existing PerPayEvent
			err := tx.Where("event_id = ?", event.EventID).First(&existing).Error
			if err == nil {
				if existing.TradeNo != event.TradeNo || existing.Fingerprint != event.Fingerprint {
					return ErrPerPayOrderMismatch
				}
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err := tx.Create(event).Error; err != nil {
				return err
			}
		}
		if snapshot.Version < order.Version {
			return tx.Model(&order).Update("last_checked_at", common.GetTimestamp()).Error
		}
		if snapshot.Version == order.Version &&
			(snapshot.PaymentStatus != order.PaymentStatus || snapshot.RefundStatus != order.RefundStatus ||
				snapshot.ReceivedAmountCents != order.ReceivedAmountCents) {
			return ErrPerPayOrderMismatch
		}
		order.OrderID = snapshot.OrderID
		order.PayableAmountCents = snapshot.PayableAmountCents
		order.ReceivedAmountCents = snapshot.ReceivedAmountCents
		order.PaymentStatus = snapshot.PaymentStatus
		order.RefundStatus = snapshot.RefundStatus
		order.CheckoutStatus = snapshot.CheckoutStatus
		order.Version = snapshot.Version
		order.LastCheckedAt = common.GetTimestamp()
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		if snapshot.PaymentStatus == "DISPUTED" || snapshot.RefundStatus != "NONE" {
			topUp.Status = TopUpStatusDisputed
			return tx.Save(&topUp).Error
		}
		if snapshot.PaymentStatus != "CONFIRMED" {
			if topUp.Status == common.TopUpStatusPending && (snapshot.CheckoutStatus == "CLOSED" || snapshot.CheckoutStatus == "EXPIRED") {
				topUp.Status = common.TopUpStatusExpired
				return tx.Save(&topUp).Error
			}
			return nil
		}
		// CompleteTime also covers administrator completion before the callback.
		if topUp.CompleteTime != 0 || topUp.Status == common.TopUpStatusSuccess {
			topUp.Status = common.TopUpStatusSuccess
			return tx.Save(&topUp).Error
		}
		var err error
		creditedQuota, err = common.WalletQuotaFromDecimalStrict(
			decimal.NewFromFloat(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
		)
		if err != nil || creditedQuota <= 0 {
			return ErrInvalidTopUpQuota
		}
		topUp.Status = common.TopUpStatusSuccess
		topUp.CompleteTime = common.GetTimestamp()
		topUp.Money = decimal.NewFromInt(snapshot.ReceivedAmountCents).Div(decimal.NewFromInt(100)).InexactFloat64()
		if err := tx.Save(&topUp).Error; err != nil {
			return err
		}
		if err := creditTopUpQuota(tx, topUp.UserId, creditedQuota, nil); err != nil {
			return err
		}
		inviterID, rebateQuota, err = grantTopupInviterRebate(tx, topUp.UserId, creditedQuota)
		return err
	})
	if err != nil {
		return err
	}
	if creditedQuota > 0 {
		syncCreditUserQuotaCache(topUp.UserId, creditedQuota, common.LogText("PerPay topup"))
		RecordTopupLog(topUp.UserId, common.NewMessage("{{provider}} top-up succeeded, amount added: {{quota}}, payment amount: {{amount}}",
			map[string]any{"provider": "PerPay", "quota": logger.FormatQuota(creditedQuota), "amount": fmt.Sprintf("%.2f", topUp.Money)}),
			callerIP, PaymentProviderPerPay, PaymentProviderPerPay)
		recordTopupInviterRebateLog(inviterID, topUp.UserId, rebateQuota, creditedQuota, topUp.TradeNo)
	}
	return nil
}
