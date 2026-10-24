package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdminLotteryAuditReturnsUsernamesAndHistoricalPrizeNames(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(
		&model.LotteryActivity{}, &model.LotteryVersion{},
		&model.LotteryPrize{}, &model.LotteryVersionPrize{},
		&model.LotteryDraw{}, &model.LotteryAward{},
	))
	user := model.User{Username: "audit-customer"}
	require.NoError(t, db.Create(&user).Error)
	activity := model.LotteryActivity{Name: "audit-lottery"}
	require.NoError(t, db.Create(&activity).Error)
	version := model.LotteryVersion{ActivityId: activity.Id, Status: model.LotteryVersionArchived}
	require.NoError(t, db.Create(&version).Error)
	balance := model.LotteryPrize{ActivityId: activity.Id, Code: "balance", Type: model.LotteryPrizeBalance}
	thanks := model.LotteryPrize{ActivityId: activity.Id, Code: "thanks", Type: model.LotteryPrizeThanks}
	require.NoError(t, db.Create(&balance).Error)
	require.NoError(t, db.Create(&thanks).Error)
	require.NoError(t, db.Create(&model.LotteryVersionPrize{
		VersionId: version.Id, PrizeId: balance.Id,
		Title: model.LotteryLocalizedText{"en": "Original reward", "zh-CN": "原始余额奖励"},
	}).Error)
	require.NoError(t, db.Create(&model.LotteryVersionPrize{
		VersionId: version.Id, PrizeId: thanks.Id,
		Title: model.LotteryLocalizedText{"en": "Original thanks", "zh-CN": "原始参与奖"},
	}).Error)
	current := model.LotteryVersion{ActivityId: activity.Id, Revision: 2, Status: model.LotteryVersionPublished}
	require.NoError(t, db.Create(&current).Error)
	require.NoError(t, db.Create(&model.LotteryVersionPrize{
		VersionId: current.Id, PrizeId: balance.Id,
		Title: model.LotteryLocalizedText{"en": "Changed reward", "zh-CN": "新余额奖励"},
	}).Error)
	draw := model.LotteryDraw{
		ActivityId: activity.Id, UserId: user.Id, VersionId: version.Id,
		BusinessDate: "2026-10-24", AttemptNo: 1, IdempotencyKey: "audit-names",
		RawPrizeId: balance.Id, FinalPrizeId: thanks.Id, Status: model.LotteryDrawCompleted,
	}
	require.NoError(t, db.Create(&draw).Error)
	winner := draw
	winner.Id = 0
	winner.AttemptNo = 2
	winner.IdempotencyKey = "audit-winner"
	winner.FinalPrizeId = balance.Id
	require.NoError(t, db.Create(&winner).Error)
	award := model.LotteryAward{
		DrawId: winner.Id, ActivityId: activity.Id, UserId: user.Id,
		PrizeId: balance.Id, Status: model.LotteryAwardGranted,
	}
	require.NoError(t, db.Create(&award).Error)

	for _, tc := range []struct {
		lang, queryLang, rawTitle, finalTitle string
	}{
		{lang: "en", rawTitle: "Original reward", finalTitle: "Original thanks"},
		{lang: "zh-CN", rawTitle: "原始余额奖励", finalTitle: "原始参与奖"},
		{lang: "en", queryLang: "zh-CN", rawTitle: "原始余额奖励", finalTitle: "原始参与奖"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/lottery/admin/activities/%d/audit", activity.Id), nil)
			c.Request.Header.Set("Accept-Language", tc.lang)
			if tc.queryLang != "" {
				query := c.Request.URL.Query()
				query.Set("language", tc.queryLang)
				c.Request.URL.RawQuery = query.Encode()
			}
			c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(activity.Id)}}
			AdminLotteryAudit(c)
			require.Equal(t, http.StatusOK, recorder.Code)
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					Items []struct {
						DrawID          int    `json:"draw_id"`
						UserID          int    `json:"user_id"`
						Username        string `json:"username"`
						RawPrizeTitle   string `json:"raw_prize_title"`
						FinalPrizeTitle string `json:"final_prize_title"`
						AwardStatus     string `json:"award_status"`
					} `json:"items"`
					Total    int `json:"total"`
					Page     int `json:"page"`
					PageSize int `json:"page_size"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success)
			require.Len(t, response.Data.Items, 2)
			item := response.Data.Items[0]
			assert.Equal(t, winner.Id, item.DrawID)
			assert.Equal(t, user.Id, item.UserID)
			assert.Equal(t, user.Username, item.Username)
			assert.Equal(t, tc.rawTitle, item.RawPrizeTitle)
			assert.Equal(t, tc.rawTitle, item.FinalPrizeTitle)
			assert.Equal(t, model.LotteryAwardGranted, item.AwardStatus)
			converted := response.Data.Items[1]
			assert.Equal(t, draw.Id, converted.DrawID)
			assert.Equal(t, user.Username, converted.Username)
			assert.Equal(t, tc.rawTitle, converted.RawPrizeTitle)
			assert.Equal(t, tc.finalTitle, converted.FinalPrizeTitle)
			assert.Empty(t, converted.AwardStatus)
			assert.Equal(t, 2, response.Data.Total)
			assert.Equal(t, 1, response.Data.Page)
			assert.Equal(t, 20, response.Data.PageSize)
		})
	}
}
