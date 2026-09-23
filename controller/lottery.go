package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type lotteryActivityRequest struct {
	Name           string `json:"name"`
	StartAt        int64  `json:"start_at"`
	EndAt          int64  `json:"end_at"`
	ConsumeStartAt int64  `json:"consume_start_at"`
	ConsumeEndAt   int64  `json:"consume_end_at"`
	MaxAttempts    int    `json:"max_attempts"`
}

type lotteryVersionPrizeRequest struct {
	PrizeID       int                        `json:"prize_id"`
	Type          string                     `json:"type"`
	Code          string                     `json:"code"`
	BalanceAmount float64                    `json:"balance_amount"`
	BalanceQuota  int64                      `json:"balance_quota"`
	TotalStock    int64                      `json:"total_stock"`
	Title         model.LotteryLocalizedText `json:"title"`
	Description   model.LotteryLocalizedText `json:"description"`
	Weight        int64                      `json:"weight"`
	DailyLimit    int64                      `json:"daily_limit"`
	SortOrder     int                        `json:"sort_order"`
	Enabled       bool                       `json:"enabled"`
}

type lotteryVersionRequest struct {
	ThresholdQuota int64                        `json:"threshold_quota"`
	QuotaPerUnit   float64                      `json:"quota_per_unit"`
	Title          model.LotteryLocalizedText   `json:"title"`
	RuleText       model.LotteryLocalizedText   `json:"rule_text"`
	Prizes         []lotteryVersionPrizeRequest `json:"prizes"`
}

type lotteryStatusRequest struct {
	Status string `json:"status"`
}

type lotteryStockRequest struct {
	PrizeID   int    `json:"prize_id"`
	Delta     int64  `json:"delta"`
	RequestID string `json:"request_id"`
	Reason    string `json:"reason"`
}

func lotterySessionOnly(c *gin.Context) bool {
	if _, ok := middleware.GetSessionAuthIdentity(c); ok {
		return true
	}
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"success": false,
		"code":    "LOTTERY_SESSION_REQUIRED",
		"message": "a browser session is required",
	})
	return false
}

func lotteryError(c *gin.Context, err error) {
	status := http.StatusBadRequest
	code := "LOTTERY_REQUEST_INVALID"
	switch {
	case errors.Is(err, model.ErrLotteryNotFound):
		status, code = http.StatusNotFound, "LOTTERY_NOT_FOUND"
	case errors.Is(err, model.ErrLotteryUnavailable):
		status, code = http.StatusConflict, "LOTTERY_UNAVAILABLE"
	case errors.Is(err, model.ErrLotteryNotEligible):
		status, code = http.StatusForbidden, "LOTTERY_NOT_ELIGIBLE"
	case errors.Is(err, model.ErrLotteryAlreadyDrawn):
		status, code = http.StatusConflict, "LOTTERY_ALREADY_DRAWN"
	case errors.Is(err, model.ErrLotteryIdempotencyConflict):
		status, code = http.StatusConflict, "LOTTERY_IDEMPOTENCY_CONFLICT"
	case errors.Is(err, model.ErrLotteryWalletLimit):
		status, code = http.StatusConflict, "LOTTERY_WALLET_LIMIT"
	case errors.Is(err, model.ErrLotteryAccountUnavailable):
		status, code = http.StatusForbidden, "LOTTERY_ACCOUNT_UNAVAILABLE"
	case errors.Is(err, model.ErrLotteryQualification):
		status, code = http.StatusServiceUnavailable, "LOTTERY_QUALIFICATION_UNAVAILABLE"
	case errors.Is(err, gorm.ErrRecordNotFound):
		status, code = http.StatusNotFound, "LOTTERY_NOT_FOUND"
	}
	c.AbortWithStatusJSON(status, gin.H{"success": false, "code": code, "message": err.Error()})
}

func localizedLotteryText(values model.LotteryLocalizedText, lang string) string {
	if len(values) == 0 {
		return ""
	}
	keys := []string{lang, "zh-CN", "zh", "en"}
	for _, key := range keys {
		if value := strings.TrimSpace(values[key]); value != "" {
			return value
		}
	}
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func lotteryFallbackText(prizeType string, title bool, lang string) string {
	values := model.LotteryLocalizedText{}
	switch prizeType {
	case model.LotteryPrizeBalance:
		if title {
			values = model.LotteryLocalizedText{"en": "Balance reward", "zh": "余额奖励", "zh-CN": "余额奖励", "zh-TW": "餘額獎勵", "fr": "Récompense de solde", "ja": "残高報酬", "ru": "Награда на баланс", "vi": "Thưởng số dư"}
		} else {
			values = model.LotteryLocalizedText{"en": "Account balance credit", "zh": "账户余额到账", "zh-CN": "账户余额到账", "zh-TW": "帳戶餘額入帳", "fr": "Crédit sur le solde du compte", "ja": "アカウント残高に付与", "ru": "Зачисление на баланс аккаунта", "vi": "Cộng vào số dư tài khoản"}
		}
	case model.LotteryPrizeAgain:
		if title {
			values = model.LotteryLocalizedText{"en": "Draw again", "zh": "再来一次", "zh-CN": "再来一次", "zh-TW": "再抽一次", "fr": "Tirage supplémentaire", "ja": "もう一度抽選", "ru": "Дополнительная попытка", "vi": "Quay thưởng lại"}
		} else {
			values = model.LotteryLocalizedText{"en": "One additional draw today", "zh": "当天增加一次抽奖机会", "zh-CN": "当天增加一次抽奖机会", "zh-TW": "當天增加一次抽獎機會", "fr": "Un tirage supplémentaire aujourd'hui", "ja": "当日に追加の抽選を1回", "ru": "Одна дополнительная попытка сегодня", "vi": "Thêm một lượt quay trong ngày"}
		}
	default:
		if title {
			values = model.LotteryLocalizedText{"en": "Thank you for participating", "zh": "谢谢参与", "zh-CN": "谢谢参与", "zh-TW": "謝謝參與", "fr": "Merci pour votre participation", "ja": "ご参加ありがとうございます", "ru": "Спасибо за участие", "vi": "Cảm ơn đã tham gia"}
		} else {
			values = model.LotteryLocalizedText{"en": "Keep participating in the next draw", "zh": "欢迎下次继续参与", "zh-CN": "欢迎下次继续参与", "zh-TW": "歡迎下次繼續參與", "fr": "Participez au prochain tirage", "ja": "次回もご参加ください", "ru": "Попробуйте снова в следующем розыгрыше", "vi": "Hãy tham gia lần quay tiếp theo"}
		}
	}
	return localizedLotteryText(values, lang)
}

func lotteryPrizeTitle(item model.LotteryVersionPrizeView, lang string) string {
	if value := localizedLotteryText(item.Title, lang); value != "" {
		return value
	}
	return lotteryFallbackText(item.Prize.Type, true, lang)
}

func lotteryPrizeDescription(item model.LotteryVersionPrizeView, lang string) string {
	if value := localizedLotteryText(item.Description, lang); value != "" {
		return value
	}
	return lotteryFallbackText(item.Prize.Type, false, lang)
}

func lotteryPublicAward(award *model.LotteryAward) any {
	if award == nil {
		return nil
	}
	return gin.H{"quota": award.Quota, "status": award.Status}
}

func lotteryBalancePrizeAvailable(item model.LotteryVersionPrizeView) bool {
	return item.Prize.TotalStock > 0 &&
		item.Prize.IssuedStock < item.Prize.TotalStock &&
		(item.DailyLimit <= 0 || item.DailyIssued < item.DailyLimit)
}

func lotteryPublicView(c *gin.Context, view *model.LotteryActivityView) gin.H {
	lang := i18n.GetLangFromContext(c)
	title := localizedLotteryText(view.Version.Title, lang)
	if title == "" {
		title = view.Activity.Name
	}
	ruleText := localizedLotteryText(view.Version.RuleText, lang)
	if ruleText == "" {
		ruleText = localizedLotteryText(model.LotteryLocalizedText{
			"en":    "Lottery rules are provided by the server.",
			"zh":    "抽奖规则由服务端提供。",
			"zh-CN": "抽奖规则由服务端提供。",
			"zh-TW": "抽獎規則由服務端提供。",
			"fr":    "Les règles du tirage sont fournies par le serveur.",
			"ja":    "抽選ルールはサーバーから提供されます。",
			"ru":    "Правила розыгрыша предоставляются сервером.",
			"vi":    "Thể lệ quay thưởng do máy chủ cung cấp.",
		}, lang)
	}
	prizes := make([]gin.H, 0, len(view.Prizes))
	effectiveWeights := make([]int64, len(view.Prizes))
	thanksIndex := -1
	var convertedWeight int64
	for i, item := range view.Prizes {
		effectiveWeights[i] = item.Weight
		if item.Prize.Type == model.LotteryPrizeThanks {
			thanksIndex = i
		}
		available := true
		switch item.Prize.Type {
		case model.LotteryPrizeBalance:
			available = lotteryBalancePrizeAvailable(item)
		case model.LotteryPrizeAgain:
			available = !view.BaseUsed && view.Activity.MaxAttempts > 1
		}
		if !available && item.Prize.Type != model.LotteryPrizeThanks {
			effectiveWeights[i] = 0
			convertedWeight += item.Weight
		}
	}
	if thanksIndex >= 0 {
		effectiveWeights[thanksIndex] += convertedWeight
	}
	for i, item := range view.Prizes {
		available := item.Prize.Type != model.LotteryPrizeBalance || lotteryBalancePrizeAvailable(item)
		if item.Prize.Type == model.LotteryPrizeAgain {
			available = !view.BaseUsed && view.Activity.MaxAttempts > 1
		}
		prizes = append(prizes, gin.H{
			"id":                            item.Prize.Id,
			"code":                          item.Prize.Code,
			"type":                          item.Prize.Type,
			"balance_amount":                item.Prize.BalanceAmount,
			"balance_quota":                 item.Prize.BalanceQuota,
			"title":                         lotteryPrizeTitle(item, lang),
			"description":                   lotteryPrizeDescription(item, lang),
			"weight":                        item.Weight,
			"probability_percent":           float64(item.Weight) * 100 / float64(model.LotteryWeightTotal),
			"effective_weight":              effectiveWeights[i],
			"effective_probability_percent": float64(effectiveWeights[i]) * 100 / float64(model.LotteryWeightTotal),
			"available":                     available,
		})
	}
	return gin.H{
		"id":                 view.Activity.Id,
		"name":               view.Activity.Name,
		"start_at":           view.Activity.StartAt,
		"end_at":             view.Activity.EndAt,
		"consume_start_at":   view.Activity.ConsumeStartAt,
		"consume_end_at":     view.Activity.ConsumeEndAt,
		"business_date":      view.BusinessDate,
		"version_id":         view.Version.Id,
		"status":             view.Status,
		"qualification":      view.Qualification,
		"title":              title,
		"rule_text":          ruleText,
		"threshold_quota":    view.Version.ThresholdQuota,
		"base_used":          view.BaseUsed,
		"remaining_attempts": view.RemainingAttempts,
		"extra_granted":      view.ExtraGranted,
		"extra_available":    view.ExtraAvailable,
		"eligibility_reason": view.EligibilityReason,
		"prizes":             prizes,
	}
}

func GetLotteryActivities(c *gin.Context) {
	if !lotterySessionOnly(c) {
		return
	}
	activities, err := model.GetLotteryActivities(c.GetInt("id"), time.Now())
	if err != nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "LOTTERY_QUALIFICATION_UNAVAILABLE", "message": err.Error()})
		return
	}
	items := make([]gin.H, 0, len(activities))
	for i := range activities {
		items = append(items, lotteryPublicView(c, &activities[i]))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

func GetLotteryActivity(c *gin.Context) {
	if !lotterySessionOnly(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	view, err := model.GetLotteryActivityView(id, c.GetInt("id"), time.Now())
	if err != nil {
		if errors.Is(err, model.ErrLotteryNotFound) {
			lotteryError(c, err)
			return
		}
		if errors.Is(err, model.ErrLotteryUnavailable) {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "LOTTERY_UNAVAILABLE", "message": err.Error()})
			return
		}
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "LOTTERY_QUALIFICATION_UNAVAILABLE", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": lotteryPublicView(c, view)})
}

func DrawLottery(c *gin.Context) {
	if !lotterySessionOnly(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	idempotencyKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if idempotencyKey == "" || len(idempotencyKey) > 128 {
		lotteryError(c, errors.New("Idempotency-Key is required and must be at most 128 characters"))
		return
	}
	result, err := model.DrawLottery(id, c.GetInt("id"), idempotencyKey, time.Now())
	if err != nil {
		lotteryError(c, err)
		return
	}
	lang := i18n.GetLangFromContext(c)
	var versionPrize model.LotteryVersionPrize
	_ = model.DB.Where("version_id = ? AND prize_id = ?", result.Draw.VersionId, result.Draw.FinalPrizeId).First(&versionPrize).Error
	prizeView := model.LotteryVersionPrizeView{LotteryVersionPrize: versionPrize, Prize: result.Prize}
	awardID := 0
	awardStatus := ""
	if result.Award != nil {
		awardID, awardStatus = result.Award.Id, result.Award.Status
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"draw_id":           result.Draw.Id,
		"version_id":        result.Draw.VersionId,
		"attempt_no":        result.Draw.AttemptNo,
		"reused":            result.Reused,
		"prize_id":          result.Draw.FinalPrizeId,
		"prize_type":        result.Prize.Type,
		"prize_title":       lotteryPrizeTitle(prizeView, lang),
		"prize_description": lotteryPrizeDescription(prizeView, lang),
		"balance_amount":    result.Prize.BalanceAmount,
		"balance_quota":     result.Prize.BalanceQuota,
		"award_id":          awardID,
		"award_status":      awardStatus,
		"draw_status":       result.Draw.Status,
		"award":             lotteryPublicAward(result.Award),
	}})
}

func GetLotteryHistory(c *gin.Context) {
	if !lotterySessionOnly(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	pageValue := c.Query("page")
	if pageValue == "" {
		pageValue = c.Query("p")
	}
	page, _ := strconv.Atoi(pageValue)
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	historyPage, err := model.GetLotteryHistoryPage(id, c.GetInt("id"), c.Query("business_date"), page, pageSize)
	if err != nil {
		lotteryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": lotteryHistoryPublicView(c, historyPage)})
}

func GetLotteryUserHistory(c *gin.Context) {
	if !lotterySessionOnly(c) {
		return
	}
	pageValue := c.Query("page")
	if pageValue == "" {
		pageValue = c.Query("p")
	}
	page, _ := strconv.Atoi(pageValue)
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	historyPage, err := model.GetLotteryUserHistoryPage(c.GetInt("id"), c.Query("business_date"), page, pageSize)
	if err != nil {
		lotteryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": lotteryHistoryPublicView(c, historyPage)})
}

func lotteryHistoryPublicView(c *gin.Context, historyPage *model.LotteryHistoryPage) gin.H {
	lang := i18n.GetLangFromContext(c)
	history := make([]gin.H, 0, len(historyPage.Items))
	for _, item := range historyPage.Items {
		var versionPrize model.LotteryVersionPrize
		_ = model.DB.Where("version_id = ? AND prize_id = ?", item.Draw.VersionId, item.Draw.FinalPrizeId).First(&versionPrize).Error
		prizeView := model.LotteryVersionPrizeView{LotteryVersionPrize: versionPrize, Prize: item.Prize}
		awardID := 0
		awardStatus := ""
		if item.Award != nil {
			awardID, awardStatus = item.Award.Id, item.Award.Status
		}
		history = append(history, gin.H{
			"id":                item.Draw.Id,
			"activity_id":       item.Draw.ActivityId,
			"business_date":     item.Draw.BusinessDate,
			"version_id":        item.Draw.VersionId,
			"attempt_no":        item.Draw.AttemptNo,
			"prize_id":          item.Draw.FinalPrizeId,
			"prize_type":        item.Prize.Type,
			"prize_title":       lotteryPrizeTitle(prizeView, lang),
			"prize_description": lotteryPrizeDescription(prizeView, lang),
			"balance_amount":    item.Prize.BalanceAmount,
			"balance_quota":     item.Prize.BalanceQuota,
			"created_at":        item.Draw.CreatedAt,
			"award_id":          awardID,
			"award_status":      awardStatus,
			"draw_status":       item.Draw.Status,
			"award":             lotteryPublicAward(item.Award),
		})
	}
	return gin.H{
		"items": history, "total": historyPage.Total, "page": historyPage.Page, "page_size": historyPage.PageSize,
	}
}

func RequireLotteryPermission(permission authz.Permission) gin.HandlerFunc {
	return middleware.RequirePermission(permission)
}

func AdminListLotteryActivities(c *gin.Context) {
	var activities []model.LotteryActivity
	if err := model.DB.Order("id desc").Find(&activities).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": activities})
}

func AdminCreateLotteryActivity(c *gin.Context) {
	var request lotteryActivityRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	activity := &model.LotteryActivity{Name: request.Name, StartAt: request.StartAt, EndAt: request.EndAt, ConsumeStartAt: request.ConsumeStartAt, ConsumeEndAt: request.ConsumeEndAt, MaxAttempts: request.MaxAttempts, CreatedBy: c.GetInt("id"), UpdatedBy: c.GetInt("id")}
	if err := model.CreateLotteryActivity(activity); err != nil {
		lotteryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": activity})
}

func AdminCreateLotteryVersion(c *gin.Context) {
	activityID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	var request lotteryVersionRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	version := &model.LotteryVersion{ActivityId: activityID, ThresholdQuota: request.ThresholdQuota, QuotaPerUnit: request.QuotaPerUnit, Title: request.Title, RuleText: request.RuleText, CreatedBy: c.GetInt("id")}
	quotaPerUnit := request.QuotaPerUnit
	if quotaPerUnit <= 0 {
		quotaPerUnit = common.QuotaPerUnit
	}
	version.QuotaPerUnit = quotaPerUnit
	items := make([]model.LotteryVersionPrizeView, 0, len(request.Prizes))
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		var activity model.LotteryActivity
		if err := tx.Select("id").First(&activity, activityID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return model.ErrLotteryNotFound
			}
			return err
		}
		for _, item := range request.Prizes {
			code := strings.TrimSpace(item.Code)
			requestedPrize := model.LotteryPrize{
				ActivityId:    activityID,
				Code:          code,
				Type:          strings.TrimSpace(item.Type),
				BalanceAmount: item.BalanceAmount,
				BalanceQuota:  item.BalanceQuota,
				TotalStock:    item.TotalStock,
			}
			if err := model.NormalizeLotteryPrizeDefinition(&requestedPrize, quotaPerUnit); err != nil {
				return err
			}
			var prize model.LotteryPrize
			if item.PrizeID > 0 {
				if err := tx.First(&prize, item.PrizeID).Error; err != nil {
					return err
				}
				if prize.ActivityId != activityID {
					return model.ErrLotteryInvalidConfig
				}
			} else {
				err := tx.Where("activity_id = ? AND code = ?", activityID, code).First(&prize).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					prize = requestedPrize
					if err := tx.Create(&prize).Error; err != nil {
						return err
					}
				} else if err != nil {
					return err
				}
			}
			if prize.Code != requestedPrize.Code || prize.Type != requestedPrize.Type || prize.BalanceAmount != requestedPrize.BalanceAmount || prize.BalanceQuota != requestedPrize.BalanceQuota || prize.TotalStock != requestedPrize.TotalStock {
				return model.ErrLotteryInvalidConfig
			}
			items = append(items, model.LotteryVersionPrizeView{LotteryVersionPrize: model.LotteryVersionPrize{PrizeId: prize.Id, Title: item.Title, Description: item.Description, Weight: item.Weight, DailyLimit: item.DailyLimit, SortOrder: item.SortOrder, Enabled: item.Enabled}, Prize: prize})
		}
		return model.CreateLotteryVersionTx(tx, version, items)
	})
	if err != nil {
		lotteryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": version})
}

func AdminListLotteryVersions(c *gin.Context) {
	activityID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	versions, err := model.ListLotteryVersions(activityID)
	if err != nil {
		lotteryError(c, err)
		return
	}
	type adminPrize struct {
		ID            int                        `json:"id"`
		Code          string                     `json:"code"`
		Type          string                     `json:"type"`
		BalanceAmount float64                    `json:"balance_amount"`
		BalanceQuota  int64                      `json:"balance_quota"`
		TotalStock    int64                      `json:"total_stock"`
		IssuedStock   int64                      `json:"issued_stock"`
		Title         model.LotteryLocalizedText `json:"title"`
		Description   model.LotteryLocalizedText `json:"description"`
		Weight        int64                      `json:"weight"`
		DailyLimit    int64                      `json:"daily_limit"`
		SortOrder     int                        `json:"sort_order"`
		Enabled       bool                       `json:"enabled"`
	}
	type adminVersion struct {
		model.LotteryVersion
		Prizes []adminPrize `json:"prizes"`
	}
	result := make([]adminVersion, 0, len(versions))
	for _, version := range versions {
		var links []model.LotteryVersionPrize
		if err := model.DB.Where("version_id = ?", version.Id).Order("sort_order asc, id asc").Find(&links).Error; err != nil {
			lotteryError(c, err)
			return
		}
		prizes := make([]adminPrize, 0, len(links))
		for _, link := range links {
			var prize model.LotteryPrize
			if err := model.DB.First(&prize, link.PrizeId).Error; err != nil {
				lotteryError(c, err)
				return
			}
			prizes = append(prizes, adminPrize{
				ID: prize.Id, Code: prize.Code, Type: prize.Type,
				BalanceAmount: prize.BalanceAmount, BalanceQuota: prize.BalanceQuota,
				TotalStock: prize.TotalStock, IssuedStock: prize.IssuedStock,
				Title: link.Title, Description: link.Description, Weight: link.Weight,
				DailyLimit: link.DailyLimit, SortOrder: link.SortOrder, Enabled: link.Enabled,
			})
		}
		result = append(result, adminVersion{LotteryVersion: version, Prizes: prizes})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

func AdminLotteryAudit(c *gin.Context) {
	activityID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	audit, err := model.GetLotteryAuditPage(activityID, c.Query("business_date"), page, pageSize)
	if err != nil {
		lotteryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": audit})
}

func AdminPublishLotteryVersion(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	if err := model.PublishLotteryVersion(id, c.GetInt("id")); err != nil {
		lotteryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func AdminSetLotteryActivityStatus(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	var request lotteryStatusRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.SetLotteryActivityStatus(id, request.Status, c.GetInt("id")); err != nil {
		lotteryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func AdminAdjustLotteryStock(c *gin.Context) {
	activityID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		lotteryError(c, model.ErrLotteryNotFound)
		return
	}
	var request lotteryStockRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	adjustment, err := model.AdjustLotteryStock(activityID, request.PrizeID, c.GetInt("id"), request.RequestID, request.Delta, request.Reason)
	if err != nil {
		lotteryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": adjustment})
}
