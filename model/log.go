package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"

	"gorm.io/gorm"
)

func applyExplicitLogTextFilter(tx *gorm.DB, column string, value string) (*gorm.DB, error) {
	if value == "" {
		return tx, nil
	}
	if strings.Contains(value, "%") {
		condition, pattern, err := buildLogLikeCondition(column, value)
		if err != nil {
			return nil, err
		}
		return tx.Where(condition, pattern), nil
	}
	return tx.Where(column+" = ?", value), nil
}

func buildLogLikeCondition(column string, value string) (string, string, error) {
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		pattern, err := sanitizeClickHouseLikePattern(value)
		if err != nil {
			return "", "", err
		}
		return column + " LIKE ?", pattern, nil
	}

	pattern, err := sanitizeLikePattern(value)
	if err != nil {
		return "", "", err
	}
	return column + " LIKE ? ESCAPE '!'", pattern, nil
}

func sanitizeClickHouseLikePattern(input string) (string, error) {
	input = strings.ReplaceAll(input, `\`, `\\`)
	input = strings.ReplaceAll(input, `_`, `\_`)

	if err := validateLikePattern(input); err != nil {
		return "", err
	}
	return input, nil
}

type Log struct {
	Id                int    `json:"id" gorm:"index:idx_created_at_id,priority:2;index:idx_user_id_id,priority:2"`
	UserId            int    `json:"user_id" gorm:"index;index:idx_user_id_id,priority:1"`
	CreatedAt         int64  `json:"created_at" gorm:"bigint;index:idx_created_at_id,priority:1;index:idx_created_at_type"`
	Type              int    `json:"type" gorm:"index:idx_created_at_type"`
	Content           string `json:"content"`
	Username          string `json:"username" gorm:"index;index:index_username_model_name,priority:2;default:''"`
	TokenName         string `json:"token_name" gorm:"index;default:''"`
	ModelName         string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota             int    `json:"quota" gorm:"default:0"`
	PromptTokens      int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens  int    `json:"completion_tokens" gorm:"default:0"`
	UseTime           int    `json:"use_time" gorm:"default:0"`
	IsStream          bool   `json:"is_stream"`
	ChannelId         int    `json:"channel" gorm:"index"`
	ChannelName       string `json:"channel_name" gorm:"->"`
	TokenId           int    `json:"token_id" gorm:"default:0;index"`
	Group             string `json:"group" gorm:"index"`
	Ip                string `json:"ip" gorm:"index;default:''"`
	RequestId         string `json:"request_id,omitempty" gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	UpstreamRequestId string `json:"upstream_request_id,omitempty" gorm:"type:varchar(128);index:idx_logs_upstream_request_id;default:''"`
	Other             string `json:"other"`
}

// don't use iota, avoid change log type value
const (
	LogTypeUnknown = 0
	LogTypeTopup   = 1
	LogTypeConsume = 2
	LogTypeManage  = 3
	LogTypeSystem  = 4
	LogTypeError   = 5
	LogTypeRefund  = 6
	LogTypeLogin   = 7
	LogTypeAff     = 8
)

func ensureLogRequestId(log *Log) {
	if log != nil && log.RequestId == "" {
		log.RequestId = common.NewRequestId()
	}
}

func createLog(log *Log) error {
	ensureLogRequestId(log)
	return LOG_DB.Create(log).Error
}

func clickHouseLogOrder(prefix string) string {
	return prefix + "created_at desc, " + prefix + "request_id desc"
}

func assignDisplayLogIds(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].Id = startIdx + i + 1
	}
}

func formatUserLogs(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].ChannelName = ""
		logs[i].Other = formatLogOtherJSON(logs[i].Other, logOtherVisibilityUser)
	}
	assignDisplayLogIds(logs, startIdx)
}

// FormatAdminLogs removes root-only diagnostics while retaining operational
// admin_info. Root callers must not pass their results through this formatter.
func FormatAdminLogs(logs []*Log) {
	for i := range logs {
		logs[i].Other = formatLogOtherJSON(logs[i].Other, logOtherVisibilityAdmin)
	}
}

// FormatRootLogs normalizes legacy metadata into the current scoped shape
// without removing root-only diagnostics.
func FormatRootLogs(logs []*Log) {
	for i := range logs {
		logs[i].Other = formatLogOtherJSON(logs[i].Other, logOtherVisibilityRoot)
	}
}

func GetLogByTokenId(tokenId int) (logs []*Log, err error) {
	order := "id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	err = LOG_DB.Model(&Log{}).Where("token_id = ?", tokenId).Order(order).Limit(common.MaxRecentItems).Find(&logs).Error
	formatUserLogs(logs, 0)
	return logs, err
}

func RecordLog(userId int, logType int, content string) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// RecordLogWithAdminInfo stores operator metadata under other.admin_info and
// an optional, user-visible operation descriptor under other.op for localization.
func RecordLogWithAdminInfo(userId int, logType int, content string, adminInfo *AuditAdminInfo, operation *AuditOperation, request ...*gin.Context) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	if logType == LogTypeManage {
		var c *gin.Context
		if len(request) > 0 {
			c = request[0]
		}
		actorRole := 0
		if c != nil {
			actorRole = c.GetInt("role")
		}
		RecordAuditLog(c, AuditLog{UserId: userId, Username: username, ActorRole: actorRole, Category: AuditCategoryOperation, Content: content, Other: AuditOther{AdminInfo: adminInfo, Op: operation}, Success: true})
		return
	}
	if len(request) > 0 && request[0] != nil {
		log.RequestId = request[0].GetString(common.RequestIdKey)
	}
	if adminInfo != nil || operation != nil {
		data, err := common.Marshal(AuditOther{AdminInfo: adminInfo, Op: operation})
		if err != nil {
			common.SysError("failed to encode log admin info: " + err.Error())
			return
		}
		log.Other = string(data)
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// RecordLoginLog writes new login events to the independent audit table.
// username 由调用方传入（登录流程已持有用户对象），避免额外的数据库查询。
// content 为英文兜底文本（用于导出）；action+params 供前端本地化渲染。
// other 包含 login_method、user_agent 等结构化信息。
func RecordLoginLog(userId, actorRole int, username string, content string, ip string, action string, params map[string]any, other AuditOther, request ...*gin.Context) {
	other.Op = &AuditOperation{Action: action, Params: params}
	var c *gin.Context
	if len(request) > 0 {
		c = request[0]
	}
	RecordAuditLog(c, AuditLog{UserId: userId, Username: username, ActorRole: actorRole, Category: AuditCategoryLogin, Action: action, Content: content, Ip: ip, Other: other, Success: true})
}

// RecordOperationAuditLog writes new operation/security events to the audit table.
// logUserId 为日志归属者，管理审计日志应归属实际操作者；目标资源/用户放入
// action params。username 内部按 logUserId 查询。content 为英文兜底文本（供导出使用）。
// action+params 写入 Other.op，供前端本地化渲染（普通用户可见，不含敏感信息）。
// adminInfo 存放操作者身份（写入 Other.admin_info，普通用户查询时剥离）；
// auditInfo 存放路由/方法/结果等中间件兜底信息（写入 Other.audit_info，普通用户查询时剥离）。
func RecordOperationAuditLog(logUserId, actorRole int, content string, ip string, action string, params map[string]any, adminInfo *AuditAdminInfo, auditInfo *AuditRequestInfo, request ...*gin.Context) {
	username, _ := GetUsernameById(logUserId, false)
	other := AuditOther{
		Op:        &AuditOperation{Action: action, Params: params},
		AdminInfo: adminInfo,
		AuditInfo: auditInfo,
	}
	var c *gin.Context
	if len(request) > 0 {
		c = request[0]
	}
	category := AuditCategoryOperation
	if adminInfo == nil {
		category = AuditCategorySecurity
	}
	status, success := 200, true
	if auditInfo != nil {
		status = auditInfo.Status
		success = auditInfo.Success
	}
	RecordAuditLog(c, AuditLog{UserId: logUserId, Username: username, ActorRole: actorRole, Category: category, Action: action, Content: content, Ip: ip, Status: status, Success: success, Other: other})
}

// RecordAffiliateLog 记录邀请收益变动明细（type=LogTypeAff），供推介计划页展示。
// kind 标识变动类型（register/topup/transfer），quota 为变动额度（划转为负数），
// detail 存入 Other.aff 供前端本地化渲染。
func RecordAffiliateLog(userId int, kind string, quota int, detail map[string]interface{}) {
	username, _ := GetUsernameById(userId, false)
	other := map[string]interface{}{
		"kind": kind,
	}
	for k, v := range detail {
		other[k] = v
	}
	content := "邀请收益变动"
	switch kind {
	case "register":
		content = "邀请收益：注册奖励"
	case "topup":
		content = "邀请收益：充值返利"
	case "transfer":
		content = "邀请收益：划转到余额"
	}
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeAff,
		Quota:     quota,
		Content:   fmt.Sprintf("%s %s", content, logger.LogQuota(quota)),
		Other:     common.MapToJsonStr(other),
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record affiliate log: " + err.Error())
	}
}

// GetAffiliateLogsByUserId 分页返回用户的邀请收益明细，按时间倒序。
func GetAffiliateLogsByUserId(userId int, pageInfo *common.PageInfo) (logs []*Log, total int64, err error) {
	if err = LOG_DB.Model(&Log{}).Where("user_id = ? AND type = ?", userId, LogTypeAff).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = LOG_DB.Select("id", "user_id", "created_at", "type", "quota", "other").
		Where("user_id = ? AND type = ?", userId, LogTypeAff).
		Order("id desc").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	pageInfo.SetTotal(int(total))
	return logs, total, nil
}

func RecordTopupLog(userId int, content string, callerIp string, paymentMethod string, callbackPaymentMethod string) {
	username, _ := GetUsernameById(userId, false)
	other := NewLogOther()
	other.MergeAdmin(map[string]any{
		"server_ip":               common.GetIp(),
		"node_name":               common.NodeName,
		"caller_ip":               callerIp,
		"payment_method":          paymentMethod,
		"callback_payment_method": callbackPaymentMethod,
		"version":                 common.Version,
	})
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeTopup,
		Content:   content,
		Ip:        callerIp,
		Other:     other.JSONString(),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record topup log: " + err.Error())
	}
}

func recordLotteryAwardLog(award *LotteryAward) {
	if award == nil || award.Id <= 0 || award.Quota <= 0 {
		return
	}
	username, _ := GetUsernameById(award.UserId, false)
	other := NewLogOther()
	other.MergePublic(map[string]any{
		"lottery_activity_id": award.ActivityId,
		"lottery_draw_id":     award.DrawId,
		"lottery_award_id":    award.Id,
		"lottery_prize_id":    award.PrizeId,
	})
	log := &Log{
		UserId:    award.UserId,
		Username:  username,
		CreatedAt: award.CreatedAt,
		Type:      LogTypeTopup,
		Content:   fmt.Sprintf("抽奖余额奖励到账，增加 %s", logger.LogQuota(int(award.Quota))),
		Quota:     int(award.Quota),
		RequestId: fmt.Sprintf("lottery-award-%d", award.Id),
		Other:     other.JSONString(),
	}
	if err := createLog(log); err != nil {
		common.SysLog(fmt.Sprintf("failed to record lottery award log award_id=%d: %s", award.Id, err.Error()))
	}
}

// getRequestDomain 返回请求进入网关时使用的域名。
// 反代场景下优先读取 X-Forwarded-Host（透传的原始域名），否则回退到 Host。
func getRequestDomain(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	if forwarded := c.Request.Header.Get("X-Forwarded-Host"); forwarded != "" {
		if idx := strings.IndexByte(forwarded, ','); idx >= 0 {
			forwarded = forwarded[:idx]
		}
		return strings.TrimSpace(forwarded)
	}
	return c.Request.Host
}

func RecordErrorLog(c *gin.Context, userId int, channelId int, modelName string, tokenName string, content string, tokenId int, useTimeSeconds int,
	isStream bool, group string, other *LogOther) {
	logger.LogInfo(c, fmt.Sprintf("record error log: userId=%d, channelId=%d, modelName=%s, tokenName=%s, content=%s", userId, channelId, modelName, tokenName, common.LocalLogPreview(content)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	if domain := getRequestDomain(c); domain != "" {
		if other == nil {
			other = NewLogOther()
		}
		other.SetPublic("request_domain", domain)
	}
	otherStr := other.JSONString()
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        common.GetTimestamp(),
		Type:             LogTypeError,
		Content:          content,
		PromptTokens:     0,
		CompletionTokens: 0,
		TokenName:        tokenName,
		ModelName:        modelName,
		Quota:            0,
		ChannelId:        channelId,
		TokenId:          tokenId,
		UseTime:          useTimeSeconds,
		IsStream:         isStream,
		Group:            group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := createLog(log)
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
}

type RecordConsumeLogParams struct {
	ChannelId        int       `json:"channel_id"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	ModelName        string    `json:"model_name"`
	TokenName        string    `json:"token_name"`
	Quota            int       `json:"quota"`
	Content          string    `json:"content"`
	TokenId          int       `json:"token_id"`
	UseTimeSeconds   int       `json:"use_time_seconds"`
	IsStream         bool      `json:"is_stream"`
	Group            string    `json:"group"`
	Other            *LogOther `json:"other"`
}

func RecordConsumeLog(c *gin.Context, userId int, params RecordConsumeLogParams) {
	if !common.LogConsumeEnabled {
		return
	}
	logger.LogInfo(c, fmt.Sprintf("record consume log: userId=%d, params=%s", userId, common.GetJsonString(params)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	createdAt := common.GetTimestamp()
	if domain := getRequestDomain(c); domain != "" {
		if params.Other == nil {
			params.Other = NewLogOther()
		}
		params.Other.SetPublic("request_domain", domain)
	}
	otherStr := params.Other.JSONString()
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        createdAt,
		Type:             LogTypeConsume,
		Content:          params.Content,
		PromptTokens:     params.PromptTokens,
		CompletionTokens: params.CompletionTokens,
		TokenName:        params.TokenName,
		ModelName:        params.ModelName,
		Quota:            params.Quota,
		ChannelId:        params.ChannelId,
		TokenId:          params.TokenId,
		UseTime:          params.UseTimeSeconds,
		IsStream:         params.IsStream,
		Group:            params.Group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := createLog(log)
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
	if common.DataExportEnabled {
		LogQuotaData(QuotaDataLogParams{
			UserID:    userId,
			Username:  username,
			ModelName: params.ModelName,
			Quota:     params.Quota,
			CreatedAt: createdAt,
			TokenUsed: params.PromptTokens + params.CompletionTokens,
			UseGroup:  params.Group,
			TokenID:   params.TokenId,
			ChannelID: params.ChannelId,
			NodeName:  common.NodeName,
		})
	}
}

type RecordTaskBillingLogParams struct {
	UserId    int
	LogType   int
	Content   string
	ChannelId int
	ModelName string
	Quota     int
	TokenId   int
	Group     string
	Other     *LogOther
	NodeName  string // 任务发起节点；为空时回退当前节点
}

func RecordTaskBillingLog(params RecordTaskBillingLogParams) {
	if params.LogType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(params.UserId, false)
	tokenName := ""
	if params.TokenId > 0 {
		if token, err := GetTokenById(params.TokenId); err == nil {
			tokenName = token.Name
		}
	}
	createdAt := common.GetTimestamp()
	log := &Log{
		UserId:    params.UserId,
		Username:  username,
		CreatedAt: createdAt,
		Type:      params.LogType,
		Content:   params.Content,
		TokenName: tokenName,
		ModelName: params.ModelName,
		Quota:     params.Quota,
		ChannelId: params.ChannelId,
		TokenId:   params.TokenId,
		Group:     params.Group,
		Other:     params.Other.JSONString(),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record task billing log: " + err.Error())
	}
	if params.LogType == LogTypeConsume && common.DataExportEnabled {
		nodeName := params.NodeName
		if nodeName == "" {
			nodeName = common.NodeName
		}
		LogQuotaData(QuotaDataLogParams{
			UserID:    params.UserId,
			Username:  username,
			ModelName: params.ModelName,
			Quota:     params.Quota,
			CreatedAt: createdAt,
			UseGroup:  params.Group,
			TokenID:   params.TokenId,
			ChannelID: params.ChannelId,
			NodeName:  nodeName,
		})
	}
}

func GetAllLogs(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, startIdx int, num int, channel int, group string, requestId string, upstreamRequestId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB
	} else {
		tx = LOG_DB.Where("logs.type = ?", logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "logs.username", username); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if upstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", upstreamRequestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if channel != 0 {
		tx = tx.Where("logs.channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	order := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		assignDisplayLogIds(logs, startIdx)
	}

	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}

	if channelIds.Len() > 0 {
		var channels []struct {
			Id   int    `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		if common.MemoryCacheEnabled {
			// Cache get channel
			for _, channelId := range channelIds.Items() {
				if cacheChannel, err := CacheGetChannel(channelId); err == nil {
					channels = append(channels, struct {
						Id   int    `gorm:"column:id"`
						Name string `gorm:"column:name"`
					}{
						Id:   channelId,
						Name: cacheChannel.Name,
					})
				}
			}
		} else {
			// Bulk query channels from DB
			if err = DB.Table("channels").Select("id, name").Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
				return logs, total, err
			}
		}
		channelMap := make(map[int]string, len(channels))
		for _, channel := range channels {
			channelMap[channel.Id] = channel.Name
		}
		for i := range logs {
			logs[i].ChannelName = channelMap[logs[i].ChannelId]
		}
	}

	return logs, total, err
}

const logSearchCountLimit = 10000

func GetUserLogs(userId int, logType int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, startIdx int, num int, group string, requestId string, upstreamRequestId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB.Where("logs.user_id = ?", userId)
	} else {
		tx = LOG_DB.Where("logs.user_id = ? and logs.type = ?", userId, logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if upstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", upstreamRequestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error
	if err != nil {
		common.SysError("failed to count user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}
	order := "logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		common.SysError("failed to search user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}

	formatUserLogs(logs, startIdx)
	return logs, total, err
}

type Stat struct {
	Quota        int     `json:"quota"`
	Rpm          int     `json:"rpm"`
	Tpm          int     `json:"tpm"`
	CacheTokens  int     `json:"cache_tokens"`
	CacheHitRate float64 `json:"cache_hit_rate"`
}

type logCacheUsage struct {
	CacheTokens           int    `json:"cache_tokens"`
	CacheCreationTokens   int    `json:"cache_creation_tokens"`
	CacheCreationTokens5m int    `json:"cache_creation_tokens_5m"`
	CacheCreationTokens1h int    `json:"cache_creation_tokens_1h"`
	CacheWriteTokens      int    `json:"cache_write_tokens"`
	InputTokensTotal      int    `json:"input_tokens_total"`
	UsageSemantic         string `json:"usage_semantic"`
	Claude                bool   `json:"claude"`
}

func readLogCacheUsage(other string) (logCacheUsage, bool) {
	if other == "" {
		return logCacheUsage{}, false
	}
	usage := logCacheUsage{}
	if err := common.UnmarshalJsonStr(other, &usage); err != nil {
		return logCacheUsage{}, false
	}
	return usage, true
}

func cacheHitRatePromptTotal(promptTokens int, usage logCacheUsage) int {
	totalPrompt := promptTokens
	if usage.InputTokensTotal > 0 {
		totalPrompt = usage.InputTokensTotal
	}
	if usage.Claude || usage.UsageSemantic == "anthropic" {
		cacheCreationTokens := usage.CacheWriteTokens
		if cacheCreationTokens == 0 {
			cacheCreationTokens = usage.CacheCreationTokens
		}
		if cacheCreationTokens == 0 {
			cacheCreationTokens = usage.CacheCreationTokens5m + usage.CacheCreationTokens1h
		}
		totalPrompt = promptTokens + usage.CacheTokens + cacheCreationTokens
	}
	return totalPrompt
}

func SumUsedQuota(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int, group string) (stat Stat, err error) {
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(quota), 0) quota")

	// 为rpm和tpm创建单独的查询
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) rpm, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) tpm")

	if tx, err = applyExplicitLogTextFilter(tx, "username", username); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "username", username); err != nil {
		return stat, err
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
		rpmTpmQuery = rpmTpmQuery.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if tx, err = applyExplicitLogTextFilter(tx, "model_name", modelName); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "model_name", modelName); err != nil {
		return stat, err
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
		rpmTpmQuery = rpmTpmQuery.Where("channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where(logGroupCol+" = ?", group)
		rpmTpmQuery = rpmTpmQuery.Where(logGroupCol+" = ?", group)
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// 执行查询
	if err := tx.Scan(&stat).Error; err != nil {
		common.SysError("failed to query log stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}
	var rateStat struct {
		Rpm int
		Tpm int
	}
	if err := rpmTpmQuery.Scan(&rateStat).Error; err != nil {
		common.SysError("failed to query rpm/tpm stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}
	stat.Rpm = rateStat.Rpm
	stat.Tpm = rateStat.Tpm

	// 计算缓存命中率（使用请求的时间范围）
	cacheTokens, totalPrompt, err := sumCacheTokens(modelName, username, tokenName, channel, group, startTimestamp, endTimestamp)
	if err != nil {
		common.SysError("failed to query cache stat: " + err.Error())
		// 缓存统计数据失败不影响主流程
	} else {
		stat.CacheTokens = cacheTokens
		if totalPrompt > 0 {
			stat.CacheHitRate = float64(cacheTokens) / float64(totalPrompt) * 100
		}
	}

	return stat, nil
}

// GetChannelQuotaBetween returns each channel's consumed quota within the
// given timestamp range, aggregated from consume logs. Zero bounds are
// treated as unbounded.
func GetChannelQuotaBetween(startTimestamp int64, endTimestamp int64) (map[int]int64, error) {
	rows := make([]struct {
		ChannelId int   `gorm:"column:channel_id"`
		Quota     int64 `gorm:"column:quota"`
	}, 0)
	query := LOG_DB.Table("logs").
		Select("channel_id, COALESCE(sum(quota), 0) as quota").
		Where("type = ? and channel_id > 0", LogTypeConsume)
	if startTimestamp > 0 {
		query = query.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		query = query.Where("created_at <= ?", endTimestamp)
	}
	err := query.Group("channel_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int]int64, len(rows))
	for _, row := range rows {
		result[row.ChannelId] = row.Quota
	}
	return result, nil
}

func sumCacheTokens(modelName string, username string, tokenName string, channel int, group string, startTimestamp int64, endTimestamp int64) (cacheTokens int, totalPrompt int, err error) {
	var rows []struct {
		PromptTokens int
		Other        string
	}

	query := LOG_DB.Table("logs").
		Select("prompt_tokens, other").
		Where("type = ?", LogTypeConsume)

	if startTimestamp != 0 {
		query = query.Where("created_at >= ?", startTimestamp)
	} else {
		query = query.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())
	}
	if endTimestamp != 0 {
		query = query.Where("created_at <= ?", endTimestamp)
	}

	if username != "" {
		if query, err = applyExplicitLogTextFilter(query, "username", username); err != nil {
			return 0, 0, err
		}
	}
	if tokenName != "" {
		query = query.Where("token_name = ?", tokenName)
	}
	if modelName != "" {
		if query, err = applyExplicitLogTextFilter(query, "model_name", modelName); err != nil {
			return 0, 0, err
		}
	}
	if channel != 0 {
		query = query.Where("channel_id = ?", channel)
	}
	if group != "" {
		query = query.Where(logGroupCol+" = ?", group)
	}

	if err := query.Find(&rows).Error; err != nil {
		return 0, 0, err
	}

	for _, row := range rows {
		usage, ok := readLogCacheUsage(row.Other)
		if !ok {
			totalPrompt += row.PromptTokens
			continue
		}
		cacheTokens += usage.CacheTokens
		totalPrompt += cacheHitRatePromptTotal(row.PromptTokens, usage)
	}

	return cacheTokens, totalPrompt, nil
}

type ModelCacheStat struct {
	ModelName    string  `json:"model_name"`
	CacheTokens  int     `json:"cache_tokens"`
	TotalPrompt  int     `json:"total_prompt"`
	CacheHitRate float64 `json:"cache_hit_rate"`
}

func SumCacheTokensByModel(startTimestamp int64, endTimestamp int64, username string) ([]ModelCacheStat, error) {
	var rows []struct {
		ModelName    string
		PromptTokens int
		Other        string
	}

	query := LOG_DB.Table("logs").
		Select("model_name, prompt_tokens, other").
		Where("type = ?", LogTypeConsume).
		Where("model_name != ''")

	if username != "" {
		var err error
		if query, err = applyExplicitLogTextFilter(query, "username", username); err != nil {
			return nil, err
		}
	}
	if startTimestamp != 0 {
		query = query.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		query = query.Where("created_at <= ?", endTimestamp)
	}

	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}

	modelData := make(map[string]*ModelCacheStat)
	for _, row := range rows {
		if row.ModelName == "" {
			continue
		}
		if _, exists := modelData[row.ModelName]; !exists {
			modelData[row.ModelName] = &ModelCacheStat{ModelName: row.ModelName}
		}
		stat := modelData[row.ModelName]
		usage, ok := readLogCacheUsage(row.Other)
		if !ok {
			stat.TotalPrompt += row.PromptTokens
			continue
		}
		stat.CacheTokens += usage.CacheTokens
		stat.TotalPrompt += cacheHitRatePromptTotal(row.PromptTokens, usage)
	}

	result := make([]ModelCacheStat, 0, len(modelData))
	for _, stat := range modelData {
		if stat.TotalPrompt > 0 {
			stat.CacheHitRate = float64(stat.CacheTokens) / float64(stat.TotalPrompt) * 100
		}
		result = append(result, *stat)
	}

	return result, nil
}

func SumUsedToken(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string) (token int) {
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0)")
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&token)
	return token
}

func CountOldLog(ctx context.Context, targetTimestamp int64) (int64, error) {
	var total int64
	if err := LOG_DB.WithContext(ctx).Model(&Log{}).Where("created_at < ?", targetTimestamp).Count(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func DeleteOldLogBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if nil != ctx.Err() {
		return 0, ctx.Err()
	}

	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		// ClickHouse DELETE is a heavy mutation that rewrites data parts, so
		// per-batch mutations would be pathologically slow. Remove all matching
		// rows in a single synchronous mutation regardless of limit; the reported
		// count lets the caller's progress loop complete in one pass.
		total, err := CountOldLog(ctx, targetTimestamp)
		if err != nil {
			return 0, err
		}
		if total == 0 {
			return 0, nil
		}
		if err := LOG_DB.WithContext(ctx).Exec(
			"ALTER TABLE logs DELETE WHERE created_at < ? SETTINGS mutations_sync = 1",
			targetTimestamp,
		).Error; err != nil {
			return 0, err
		}
		return total, nil
	}

	result := LOG_DB.WithContext(ctx).Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&Log{})
	if nil != result.Error {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
