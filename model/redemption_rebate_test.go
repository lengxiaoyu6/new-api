package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRedeemGrantsInviterRebateOnce(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	setupTopupRebateTestState(t, 10, true)
	inviter := newTopupRebateTestUser(t, "redeem_inviter", 0)
	invitee := newTopupRebateTestUser(t, "redeem_invitee", inviter.Id)

	redemption := &Redemption{
		UserId: inviter.Id,
		Name:   "rebate-test",
		Key:    common.GetRandomString(32),
		Quota:  1000000,
		Status: common.RedemptionCodeStatusEnabled,
	}
	require.NoError(t, DB.Create(redemption).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Unscoped().Where("id = ?", redemption.Id).Delete(&Redemption{}).Error)
	})

	quota, err := Redeem(redemption.Key, invitee.Id)
	require.NoError(t, err)
	assert.Equal(t, 1000000, quota)

	var reloaded User
	require.NoError(t, DB.First(&reloaded, "id = ?", inviter.Id).Error)
	assert.Equal(t, 100000, reloaded.AffQuota, "inviter should receive 10% of redeemed quota")

	var affLog Log
	require.NoError(t, LOG_DB.Where("user_id = ? AND type = ?", inviter.Id, LogTypeAff).First(&affLog).Error)
	assert.Equal(t, 100000, affLog.Quota)
	assert.Contains(t, affLog.Other, "\"kind\":\"topup\"")
	assert.Contains(t, affLog.Other, "\"redemption_id\"")

	// 同码重复兑换不重复返利
	_, err = Redeem(redemption.Key, invitee.Id)
	require.Error(t, err)
	require.NoError(t, DB.First(&reloaded, "id = ?", inviter.Id).Error)
	assert.Equal(t, 100000, reloaded.AffQuota, "failed redeem must not grant rebate again")
}
