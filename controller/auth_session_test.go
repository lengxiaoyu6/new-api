package controller

import (
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGroupRenamePreservesBrowserSessionAndPasswordLogin(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	db := model.DB
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.Channel{}, &model.Ability{},
		&model.SubscriptionPlan{}, &model.UserSubscription{}, &model.Task{}))
	previousNames := common.GroupRenameSnapshot.Load()
	previousRatios := ratio_setting.GroupRatio2JSONString()
	common.OptionMapRWMutex.RLock()
	previousOptions := maps.Clone(common.OptionMap)
	common.OptionMapRWMutex.RUnlock()
	previousLoginEnabled := common.PasswordLoginEnabled
	t.Cleanup(func() {
		common.GroupRenameSnapshot.Store(previousNames)
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
		common.PasswordLoginEnabled = previousLoginEnabled
	})
	model.InitOptionMap()
	common.PasswordLoginEnabled = true
	require.NoError(t, model.UpdateOption("GroupRatio", `{"default":1,"claude-max":0.4}`))
	require.NoError(t, db.Model(user).Update("group", "claude-max").Error)
	unaffected := &model.User{Username: "rename-unaffected", Password: user.Password,
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
		AffCode: "rename-unaffected"}
	require.NoError(t, db.Create(unaffected).Error)
	router := gin.New()
	router.Use(gin.RecoveryWithWriter(io.Discard))
	router.POST("/api/user/login", Login)
	router.POST("/api/user/auth/refresh", RefreshAuth)
	router.POST("/api/user/login/verify", VerifyLogin)
	router.GET("/api/user/self", middleware.UserAuth(), GetSelf)

	login := func(t *testing.T, username string) service.AuthBundle {
		t.Helper()
		response := httptest.NewRecorder()
		body, err := common.Marshal(map[string]string{"username": username, "password": "enrollment-password"})
		require.NoError(t, err)
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/user/login",
			strings.NewReader(string(body))))
		require.Equal(t, http.StatusOK, response.Code, "password login must not panic")
		var result struct {
			Success bool               `json:"success"`
			Message string             `json:"message"`
			Data    service.AuthBundle `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, result.Message)
		require.NotEmpty(t, result.Data.AccessToken)
		for _, cookie := range response.Result().Cookies() {
			if cookie.Name == service.RefreshCookieName {
				result.Data.RefreshToken = cookie.Value
			}
		}
		require.NotEmpty(t, result.Data.RefreshToken)
		return result.Data
	}
	access := login(t, user.Username)
	otherAccess := login(t, unaffected.Username)
	_, err := model.RenameGroup(t.Context(), "claude-max", "claude-特惠")
	require.NoError(t, err)
	for _, account := range []struct {
		name, group string
		access      service.AuthBundle
	}{
		{"renamed group", "claude-特惠", access},
		{"unaffected group", "default", otherAccess},
	} {
		t.Run("existing browser session/"+account.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/user/self", nil)
			request.Header.Set("Authorization", "Bearer "+account.access.AccessToken)
			router.ServeHTTP(response, request)
			require.Equal(t, http.StatusOK, response.Code, "the current session must remain usable")
			var result struct {
				Success bool `json:"success"`
				Data    struct {
					Group string `json:"group"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Success)
			assert.Equal(t, account.group, result.Data.Group)
		})
	}
	t.Run("refresh browser session", func(t *testing.T) {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/user/auth/refresh", nil)
		request.Header.Set("X-Auth-Session", access.Session.SID)
		request.AddCookie(&http.Cookie{Name: service.RefreshCookieName, Value: access.RefreshToken})
		router.ServeHTTP(response, request)
		require.Equal(t, http.StatusOK, response.Code, "session refresh must remain usable")
		var result struct {
			Success bool               `json:"success"`
			Data    service.AuthBundle `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success)
		assert.NotEmpty(t, result.Data.AccessToken)
		assert.Equal(t, access.Session.SID, result.Data.Session.SID)
	})
	t.Run("new password login", func(t *testing.T) {
		login(t, user.Username)
		login(t, unaffected.Username)
	})
	t.Run("incorrect password remains rejected", func(t *testing.T) {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/user/login",
			strings.NewReader(`{"username":"enrollment-user","password":"incorrect-password"}`)))
		require.Equal(t, http.StatusOK, response.Code)
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.False(t, result.Success)
		assert.Empty(t, response.Result().Cookies())
	})
	t.Run("expired session remains rejected", func(t *testing.T) {
		require.NoError(t, db.Model(&model.UserSession{}).Where("sid = ?", otherAccess.Session.SID).
			Update("expires_at", time.Now().Add(-time.Minute).Unix()).Error)
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/user/self", nil)
		request.Header.Set("Authorization", "Bearer "+otherAccess.AccessToken)
		router.ServeHTTP(response, request)
		assert.Equal(t, http.StatusUnauthorized, response.Code)
	})
	t.Run("second factor remains required and completes once", func(t *testing.T) {
		factor := &model.TwoFA{UserId: user.Id, Secret: "JBSWY3DPEHPK3PXP", IsEnabled: true}
		require.NoError(t, db.Create(factor).Error)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/user/login",
			strings.NewReader(`{"username":"enrollment-user","password":"enrollment-password"}`)))
		require.Equal(t, http.StatusOK, response.Code)
		type loginResponse struct {
			Success bool `json:"success"`
			Data    struct {
				service.AuthBundle
				service.LoginChallenge
			} `json:"data"`
		}
		var result loginResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success)
		require.True(t, result.Data.RequireVerification)
		assert.Empty(t, result.Data.AccessToken, "password authentication must not bypass the second factor")
		assert.Empty(t, response.Result().Cookies())
		code, err := totp.GenerateCode(factor.Secret, time.Now())
		require.NoError(t, err)
		body, err := common.Marshal(map[string]string{"flow_token": result.Data.FlowToken, "code": code})
		require.NoError(t, err)
		for attempt := range 2 {
			response = httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/user/login/verify", strings.NewReader(string(body))))
			result = loginResponse{}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, attempt == 0, result.Success)
			if attempt == 0 {
				assert.NotEmpty(t, result.Data.AccessToken)
				assert.NotEmpty(t, response.Result().Cookies())
			} else {
				assert.Empty(t, result.Data.AccessToken)
				assert.Empty(t, response.Result().Cookies())
			}
		}
	})
}

func TestAuthLogoutRejectsRefreshCookieSessionMismatch(t *testing.T) {
	previousDB := model.DB
	previousRedis := common.RedisEnabled
	previousSecret := common.SessionSecret
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}))
	model.DB = db
	common.RedisEnabled = false
	common.SessionSecret = "auth-logout-mismatch-test-secret"
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedis
		common.SessionSecret = previousSecret
	})

	user := &model.User{
		Username: "logout-mismatch-user", Password: "unused", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1,
	}
	require.NoError(t, db.Create(user).Error)
	sessionA, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "agent-a")
	require.NoError(t, err)
	sessionB, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "agent-b")
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/auth/logout", nil)
	c.Request.Header.Set("Authorization", "Bearer "+sessionA.AccessToken)
	c.Request.Header.Set("X-Auth-Session", sessionA.Session.SID)
	c.Request.AddCookie(&http.Cookie{Name: service.RefreshCookieName, Value: sessionB.RefreshToken})

	AuthLogout(c)

	assert.Equal(t, http.StatusConflict, recorder.Code)
	var response struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, "AUTH_SESSION_MISMATCH", response.Code)
	for _, sid := range []string{sessionA.Session.SID, sessionB.Session.SID} {
		stored, err := model.GetUserSessionBySID(sid)
		require.NoError(t, err)
		assert.Equal(t, model.UserSessionStatusActive, stored.Status)
	}
}

func TestWriteAuthSessionErrorMapsSessionGrowthLimits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name           string
		err            error
		expectedStatus int
		expectedCode   string
	}{
		{
			name:           "active session limit",
			err:            model.ErrUserSessionLimit,
			expectedStatus: http.StatusConflict,
			expectedCode:   "AUTH_SESSION_LIMIT",
		},
		{
			name:           "issuance limit",
			err:            model.ErrUserSessionIssuanceLimit,
			expectedStatus: http.StatusTooManyRequests,
			expectedCode:   "AUTH_SESSION_ISSUANCE_LIMIT",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			writeAuthSessionError(c, test.err)

			assert.Equal(t, test.expectedStatus, recorder.Code)
			var response struct {
				Success bool   `json:"success"`
				Code    string `json:"code"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.False(t, response.Success)
			assert.Equal(t, test.expectedCode, response.Code)
		})
	}
}

func TestSessionLimitDoesNotRecordRejectedLoginAsSuccessful(t *testing.T) {
	previousDB := model.DB
	previousRedis := common.RedisEnabled
	previousActiveLimit := common.UserSessionActiveLimit
	previousIssuanceLimit := common.UserSessionIssuanceLimit
	previousIssuanceWindow := common.UserSessionIssuanceWindowSeconds
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.TwoFA{}, &model.PasskeyCredential{}))
	model.DB = db
	common.RedisEnabled = false
	common.UserSessionActiveLimit = 1
	common.UserSessionIssuanceLimit = 100
	common.UserSessionIssuanceWindowSeconds = int64(common.DefaultUserSessionIssuanceWindowSeconds)
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedis
		common.UserSessionActiveLimit = previousActiveLimit
		common.UserSessionIssuanceLimit = previousIssuanceLimit
		common.UserSessionIssuanceWindowSeconds = previousIssuanceWindow
	})

	const previousLastLoginAt = int64(123)
	user := &model.User{
		Username: "rejected-login-audit-user", Password: "unused", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, LastLoginAt: previousLastLoginAt,
	}
	require.NoError(t, db.Create(user).Error)
	now := time.Now().Unix()
	require.NoError(t, db.Create(&model.UserSession{
		SID: "existing-active-session", UserID: user.Id, Version: 1, UserAuthVersion: user.AuthVersion,
		Status: model.UserSessionStatusActive, RefreshHash: "hash", LoginMethod: "password",
		CreatedAt: now, LastActiveAt: now, ExpiresAt: now + 3600,
	}).Error)

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/login", nil)
	setupLogin(user, nil, c)

	assert.Equal(t, http.StatusConflict, recorder.Code)
	var stored model.User
	require.NoError(t, db.First(&stored, user.Id).Error)
	assert.Equal(t, previousLastLoginAt, stored.LastLoginAt)
}
