package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func RenameGroup(c *gin.Context) {
	var request struct {
		OldName string `json:"old_name" binding:"required"`
		NewName string `json:"new_name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := model.RenameGroup(c.Request.Context(), request.OldName, request.NewName)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrGroupNameInvalid), errors.Is(err, model.ErrGroupNameReserved),
			errors.Is(err, model.ErrGroupNameMissing), errors.Is(err, model.ErrGroupNameExists):
			common.ApiErrorT(c, err.Error())
		default:
			common.SysError("rename group: " + err.Error())
			common.ApiErrorT(c, "Failed to rename group")
		}
		return
	}
	common.ApiSuccessT(c, "Group renamed successfully", result)
	model.RecordAuditLog(c, model.AuditLog{
		UserId: c.GetInt("id"), Username: c.GetString("username"), ActorRole: c.GetInt("role"),
		Category: model.AuditCategoryOperation, Action: "generic", Success: true,
		Content: "Rename group " + request.OldName + " to " + request.NewName,
		Other: model.AuditOther{Op: &model.AuditOperation{
			Action: "generic",
			Params: model.AuditFields{
				"method": c.Request.Method, "route": c.FullPath(),
				"old_name": request.OldName, "new_name": request.NewName,
			},
		}},
	})
	common.SetContextKey(c, constant.ContextKeyAuditLogged, true)
}

func GetGroups(c *gin.Context) {
	groupNames := make([]string, 0)
	for groupName := range ratio_setting.GetGroupRatioCopy() {
		groupNames = append(groupNames, groupName)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]any)
	userGroup := ""
	userId := c.GetInt("id")
	userGroup, _ = model.GetUserGroup(userId, false)
	userUsableGroups := service.GetUserUsableGroups(userGroup)
	for groupName, _ := range ratio_setting.GetGroupRatioCopy() {
		// UserUsableGroups contains the groups that the user can use
		if desc, ok := userUsableGroups[groupName]; ok {
			usableGroups[groupName] = map[string]any{
				"ratio": service.GetUserGroupRatio(userGroup, groupName),
				"desc":  desc,
			}
		}
	}
	if _, ok := userUsableGroups["auto"]; ok {
		usableGroups["auto"] = map[string]any{
			"ratio": "auto",
			"desc":  setting.GetUsableGroupDescription("auto"),
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}
