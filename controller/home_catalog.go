package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetHomeCatalog(c *gin.Context) {
	var group string
	if userID, ok := c.Get("id"); ok {
		user, err := model.GetUserCache(userID.(int))
		if err != nil {
			common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Failed to get user information"))
			return
		}
		group = user.Group
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    model.GetHomeCatalog(service.GetUserUsableGroups(group)),
	})
}
