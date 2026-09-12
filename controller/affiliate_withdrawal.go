package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func CreateAffiliateWithdrawal(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var request model.AffiliateWithdrawalRequest
	if c.ShouldBindJSON(&request) != nil || request.Normalize() != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": model.ErrAffiliateWithdrawalInvalid.Error()})
		return
	}
	context, err := common.Marshal(request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeAffiliateWithdraw, Context: context}) == nil {
		return
	}
	withdrawal, err := model.CreateAffiliateWithdrawal(c.GetInt("id"), request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, withdrawal)
}

func GetSelfAffiliateWithdrawals(c *gin.Context) {
	page := common.GetPageQuery(c)
	items, err := model.ListAffiliateWithdrawals(c.GetInt("id"), page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(items)
	common.ApiSuccess(c, page)
}

func GetAffiliateWithdrawals(c *gin.Context) {
	page := common.GetPageQuery(c)
	items, err := model.ListAffiliateWithdrawals(0, page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(items)
	common.ApiSuccess(c, page)
}

func ReviewAffiliateWithdrawal(c *gin.Context) {
	var request service.AffiliateWithdrawalReviewContext
	if c.ShouldBindJSON(&request) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": model.ErrAffiliateWithdrawalInvalid.Error()})
		return
	}
	context, err := common.Marshal(request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	operation := service.VerificationOperation{Scope: service.VerificationScopeAffiliateReview, Context: context}
	if _, err := service.BindVerificationOperation(operation); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": model.ErrAffiliateWithdrawalInvalid.Error()})
		return
	}
	if middleware.RequireSecurityProof(c, operation) == nil {
		return
	}
	withdrawal, err := model.ReviewAffiliateWithdrawal(request.WithdrawalID, c.GetInt("id"), request.Status, request.Note)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, withdrawal)
}
