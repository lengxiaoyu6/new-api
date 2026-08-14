package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newTopupRebateTestUser(t *testing.T, username string, inviterId int) *User {
	t.Helper()
	user := &User{
		Username:    username,
		DisplayName: username,
		AffCode:     "rebate_" + username,
		InviterId:   inviterId,
	}
	require.NoError(t, DB.Create(user).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Unscoped().Where("id = ?", user.Id).Delete(&User{}).Error)
	})
	return user
}

func setupTopupRebateTestState(t *testing.T, percent float64, complianceConfirmed bool) {
	t.Helper()
	setting := operation_setting.GetPaymentSetting()
	originConfirmed := setting.ComplianceConfirmed
	originVersion := setting.ComplianceTermsVersion
	originPercent := common.InviterTopupRebatePercent
	originQuotaPerUnit := common.QuotaPerUnit
	common.InviterTopupRebatePercent = percent
	common.QuotaPerUnit = 500000
	setting.ComplianceConfirmed = complianceConfirmed
	setting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	t.Cleanup(func() {
		common.InviterTopupRebatePercent = originPercent
		common.QuotaPerUnit = originQuotaPerUnit
		setting.ComplianceConfirmed = originConfirmed
		setting.ComplianceTermsVersion = originVersion
	})
}

func TestGrantTopupInviterRebate(t *testing.T) {
	tests := []struct {
		name             string
		percent          float64
		compliance       bool
		inviterIdForUser func(inviter *User) int
		creditedQuota    int
		wantRebate       int
	}{
		{
			name:             "grants percent of credited quota to inviter",
			percent:          10,
			compliance:       true,
			inviterIdForUser: func(inviter *User) int { return inviter.Id },
			creditedQuota:    1000,
			wantRebate:       100,
		},
		{
			name:             "fractional rebate rounds half away from zero",
			percent:          2.5,
			compliance:       true,
			inviterIdForUser: func(inviter *User) int { return inviter.Id },
			creditedQuota:    999,
			wantRebate:       25,
		},
		{
			name:             "zero percent disables rebate",
			percent:          0,
			compliance:       true,
			inviterIdForUser: func(inviter *User) int { return inviter.Id },
			creditedQuota:    1000,
			wantRebate:       0,
		},
		{
			name:             "compliance not confirmed skips rebate",
			percent:          10,
			compliance:       false,
			inviterIdForUser: func(inviter *User) int { return inviter.Id },
			creditedQuota:    1000,
			wantRebate:       0,
		},
		{
			name:             "invitee without inviter skips rebate",
			percent:          10,
			compliance:       true,
			inviterIdForUser: func(inviter *User) int { return 0 },
			creditedQuota:    1000,
			wantRebate:       0,
		},
		{
			name:             "self invite skips rebate",
			percent:          10,
			compliance:       true,
			inviterIdForUser: func(inviter *User) int { return -1 },
			creditedQuota:    1000,
			wantRebate:       0,
		},
		{
			name:             "missing inviter row skips rebate without error",
			percent:          10,
			compliance:       true,
			inviterIdForUser: func(inviter *User) int { return 99999999 },
			creditedQuota:    1000,
			wantRebate:       0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupTopupRebateTestState(t, tt.percent, tt.compliance)
			inviter := newTopupRebateTestUser(t, "rebate_inv_"+t.Name(), 0)
			invitee := newTopupRebateTestUser(t, "rebate_invtee_"+t.Name(), tt.inviterIdForUser(inviter))
			if tt.inviterIdForUser(inviter) == -1 {
				require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Update("inviter_id", invitee.Id).Error)
			}

			var gotInviterId, gotRebate int
			err := DB.Transaction(func(tx *gorm.DB) error {
				var grantErr error
				gotInviterId, gotRebate, grantErr = grantTopupInviterRebate(tx, invitee.Id, tt.creditedQuota)
				return grantErr
			})
			require.NoError(t, err)

			if tt.wantRebate > 0 {
				assert.Equal(t, inviter.Id, gotInviterId)
				assert.Equal(t, tt.wantRebate, gotRebate)
			} else {
				assert.Equal(t, 0, gotRebate)
			}

			var reloaded User
			require.NoError(t, DB.First(&reloaded, "id = ?", inviter.Id).Error)
			assert.Equal(t, tt.wantRebate, reloaded.AffQuota, "aff_quota should change by rebate")
			assert.Equal(t, tt.wantRebate, reloaded.AffHistoryQuota, "aff_history should change by rebate")
		})
	}
}

func TestRechargeEpayGrantsInviterRebateOnce(t *testing.T) {
	setupTopupRebateTestState(t, 10, true)
	inviter := newTopupRebateTestUser(t, "rebate_e2e_inviter", 0)
	invitee := newTopupRebateTestUser(t, "rebate_e2e_invitee", inviter.Id)

	topUp := &TopUp{
		UserId:          invitee.Id,
		Amount:          1,
		Money:           1,
		TradeNo:         "rebate_epay_test_trade",
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		CreateTime:      common.GetTimestamp(),
		Status:          common.TopUpStatusPending,
	}
	require.NoError(t, topUp.Insert())
	t.Cleanup(func() {
		require.NoError(t, DB.Unscoped().Where("trade_no = ?", topUp.TradeNo).Delete(&TopUp{}).Error)
	})

	alreadyDone, err := RechargeEpay(topUp.TradeNo, "", "")
	require.NoError(t, err)
	require.False(t, alreadyDone)

	var reloaded User
	require.NoError(t, DB.First(&reloaded, "id = ?", inviter.Id).Error)
	assert.Equal(t, 50000, reloaded.AffQuota, "inviter should receive 10% of 500000 credited quota")
	assert.Equal(t, 50000, reloaded.AffHistoryQuota)

	alreadyDone, err = RechargeEpay(topUp.TradeNo, "", "")
	require.NoError(t, err)
	assert.True(t, alreadyDone, "duplicate callback should be idempotent")

	require.NoError(t, DB.First(&reloaded, "id = ?", inviter.Id).Error)
	assert.Equal(t, 50000, reloaded.AffQuota, "duplicate callback must not grant rebate twice")
}
