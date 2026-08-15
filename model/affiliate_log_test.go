package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAffiliateEarningsLogRecordsAllKinds(t *testing.T) {
	// 10% 返利 + 合规确认
	setupTopupRebateTestState(t, 10, true)
	originQuotaForInviter := common.QuotaForInviter
	common.QuotaForInviter = 1000
	t.Cleanup(func() { common.QuotaForInviter = originQuotaForInviter })

	inviter := newTopupRebateTestUser(t, "afflog_inviter", 0)
	invitee := newTopupRebateTestUser(t, "afflog_invitee", inviter.Id)

	// 注册奖励
	require.NoError(t, inviteUser(inviter.Id))
	// 充值返利：10% of 10,000,000 = 1,000,000
	var rebateInviterId, rebate int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var grantErr error
		rebateInviterId, rebate, grantErr = grantTopupInviterRebate(tx, invitee.Id, 10000000)
		return grantErr
	})
	require.NoError(t, err)
	recordTopupInviterRebateLog(rebateInviterId, invitee.Id, rebate, 10000000, "afflog_trade_no")
	// 划转到余额（注册 1000 + 返利 1000000）
	require.NoError(t, inviter.TransferAffQuotaToQuota(1001000))

	logs, total, err := GetAffiliateLogsByUserId(inviter.Id, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, logs, 3)
	// 倒序：transfer(-1001000), topup(1000000), register(1000)
	assert.Equal(t, -1001000, logs[0].Quota)
	assert.Contains(t, logs[0].Other, "\"kind\":\"transfer\"")
	assert.Equal(t, 1000000, logs[1].Quota)
	assert.Contains(t, logs[1].Other, "\"kind\":\"topup\"")
	assert.Equal(t, 1000, logs[2].Quota)
	assert.Contains(t, logs[2].Other, "\"kind\":\"register\"")
}

func TestTransferAffQuotaHasNoMinimum(t *testing.T) {
	user := newTopupRebateTestUser(t, "aff_transfer_min", 0)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("aff_quota", 100).Error)

	require.NoError(t, user.TransferAffQuotaToQuota(1), "any positive quota must be transferable")

	var reloaded User
	require.NoError(t, DB.First(&reloaded, "id = ?", user.Id).Error)
	assert.Equal(t, 99, reloaded.AffQuota)
	assert.Equal(t, 1, reloaded.Quota)

	err := user.TransferAffQuotaToQuota(0)
	require.Error(t, err, "zero transfer must be rejected")
}
