package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetInvitedUsersByInviterIdMasksAndPaginates(t *testing.T) {
	inviter := newTopupRebateTestUser(t, "invited_list_inviter", 0)
	names := []string{"alice", "bobxx", "carol"}
	inviteeIds := make([]int, 0, len(names))
	for _, name := range names {
		invitee := newTopupRebateTestUser(t, name, inviter.Id)
		inviteeIds = append(inviteeIds, invitee.Id)
	}

	// 无关用户不应出现
	newTopupRebateTestUser(t, "outguy", 0)

	pageInfo := &common.PageInfo{Page: 1, PageSize: 2}
	invited, total, err := GetInvitedUsersByInviterId(inviter.Id, pageInfo)
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, invited, 2)
	assert.Equal(t, inviteeIds[2], invited[0].Id, "ordered by id desc")
	assert.Equal(t, inviteeIds[1], invited[1].Id)
	assert.Equal(t, "ca***", invited[0].Username, "username must be masked")
	assert.Equal(t, "bo***", invited[1].Username, "username must be masked")
	for _, u := range invited {
		assert.NotEqual(t, 0, u.CreatedAt)
	}

	pageInfo = &common.PageInfo{Page: 2, PageSize: 2}
	invited, total, err = GetInvitedUsersByInviterId(inviter.Id, pageInfo)
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, invited, 1)
	assert.Equal(t, inviteeIds[0], invited[0].Id)
}
