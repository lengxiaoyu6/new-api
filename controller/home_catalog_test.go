package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func seedHomeCatalog(t *testing.T, db *gorm.DB, pricing []model.Pricing, vendors []model.PricingVendor) {
	t.Helper()
	for _, vendor := range vendors {
		require.NoError(t, db.Create(&model.Vendor{
			Id: vendor.ID, Name: vendor.Name, Icon: vendor.Icon, Description: vendor.Description, Status: 1,
		}).Error)
	}
	channel := model.Channel{Type: constant.ChannelTypeOpenAI, Key: "fixture-key", Status: 1, Name: "home-catalog"}
	require.NoError(t, db.Create(&channel).Error)
	for _, item := range pricing {
		require.NoError(t, db.Create(&model.Model{
			ModelName: item.ModelName, Icon: item.Icon, VendorID: item.VendorID, Status: 1, NameRule: model.NameRuleExact,
		}).Error)
		for _, group := range item.EnableGroup {
			require.NoError(t, db.Create(&model.Ability{
				Model: item.ModelName, Group: group, ChannelId: channel.Id, Enabled: true,
			}).Error)
		}
	}
	model.RefreshPricing()
}

func TestHomeCatalogFiltersModelsAndReturnsOnlyDisplayFields(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	pricing := []model.Pricing{
		{ModelName: "public-model", VendorID: 1, EnableGroup: []string{"default"}},
		{ModelName: "private-model", VendorID: 2, EnableGroup: []string{"vip"}},
		{ModelName: "shared-model", VendorID: 1, Icon: "CustomIcon", EnableGroup: []string{"all", "default", "vip"}},
	}
	vendors := []model.PricingVendor{
		{ID: 1, Name: "Public", Icon: "OpenAI", Description: "Not needed on the homepage"},
		{ID: 2, Name: "Private", Icon: "Anthropic"},
		{ID: 3, Name: "Unused"},
	}
	seedHomeCatalog(t, db, pricing, vendors)
	catalog := model.GetHomeCatalog(map[string]string{"default": "Default"})
	assert.Equal(t, []model.HomeCatalogModel{
		{ModelName: "public-model", Icon: "OpenAI"},
		{ModelName: "shared-model", Icon: "CustomIcon"},
	}, catalog.Models)
	assert.Equal(t, []model.HomeCatalogVendor{{ID: 1, Name: "Public", Icon: "OpenAI"}}, catalog.Vendors)
	body, err := common.Marshal(catalog)
	require.NoError(t, err)
	assert.JSONEq(t, `{"models":[{"model_name":"public-model","icon":"OpenAI"},{"model_name":"shared-model","icon":"CustomIcon"}],"vendors":[{"id":1,"name":"Public","icon":"OpenAI"}]}`, string(body))
	assert.Equal(t, model.HomeCatalog{Models: []model.HomeCatalogModel{}, Vendors: []model.HomeCatalogVendor{}}, model.GetHomeCatalog(nil))

	combined := model.GetHomeCatalog(map[string]string{"default": "Default", "vip": "VIP"})
	assert.Equal(t, []model.HomeCatalogModel{
		{ModelName: "private-model", Icon: "Anthropic"},
		{ModelName: "public-model", Icon: "OpenAI"},
		{ModelName: "shared-model", Icon: "CustomIcon"},
	}, combined.Models)
	combined.Models[0].ModelName = "mutated-response"
	assert.Equal(t, "private-model", model.GetHomeCatalog(map[string]string{"vip": "VIP"}).Models[0].ModelName)
}

func TestHomeCatalogReturnsAllModelsAndLimitsOnlyDiagramVendors(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	pricing := make([]model.Pricing, 0, 20)
	for i := range 20 {
		vendorID := 10 - i%3
		if i >= 12 {
			vendorID = i - 11
		}
		groups := []string{"default"}
		if i%2 == 1 {
			groups = []string{"vip"}
		}
		if i%5 == 0 {
			groups = []string{"default", "vip"}
		}
		pricing = append(pricing, model.Pricing{
			ModelName: fmt.Sprintf("model-%02d", i), VendorID: vendorID, EnableGroup: groups,
		})
	}
	vendors := make([]model.PricingVendor, 0, 10)
	for i := range 10 {
		vendors = append(vendors, model.PricingVendor{ID: 10 - i, Name: fmt.Sprintf("Vendor %02d", 10-i)})
	}
	slices.Reverse(pricing)
	seedHomeCatalog(t, db, pricing, vendors)
	catalog := model.GetHomeCatalog(map[string]string{"default": "Default", "vip": "VIP"})
	require.Len(t, catalog.Models, 20)
	for i := range 20 {
		assert.Contains(t, catalog.Models, model.HomeCatalogModel{ModelName: fmt.Sprintf("model-%02d", i)})
	}
	require.Len(t, catalog.Vendors, 8)
	assert.Equal(t, "model-00", catalog.Models[0].ModelName)
	assert.Equal(t, "Vendor 01", catalog.Vendors[0].Name)
	assert.Equal(t, "Vendor 08", catalog.Vendors[7].Name)
}

func TestHomeCatalogReturnsAllVersionsAndDeduplicatesSharedModels(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	pricing := []model.Pricing{
		{ModelName: "gpt-4o", VendorID: 2, EnableGroup: []string{"default"}},
		{ModelName: "gemini-flash", VendorID: 3, EnableGroup: []string{"default"}},
		{ModelName: "qwen-plus", VendorID: 4, EnableGroup: []string{"vip"}},
		{ModelName: "deepseek-v4-flash", VendorID: 5, EnableGroup: []string{"default", "vip"}},
		{ModelName: "deepseek-v4.1-flash", VendorID: 5, EnableGroup: []string{"default", "vip"}},
	}
	for i := range 14 {
		pricing = append(pricing, model.Pricing{
			ModelName: fmt.Sprintf("claude-%02d", i), VendorID: 1, EnableGroup: []string{"default", "vip"},
		})
	}
	seedHomeCatalog(t, db, pricing, []model.PricingVendor{
		{ID: 1, Name: "Anthropic"}, {ID: 2, Name: "OpenAI"},
		{ID: 3, Name: "Google"}, {ID: 4, Name: "Alibaba"},
		{ID: 5, Name: "DeepSeek"},
	})

	for _, test := range []struct {
		name   string
		groups map[string]string
		first  []string
		count  int
	}{
		{"single group", map[string]string{"default": "Default"}, []string{"claude-00", "deepseek-v4-flash", "gemini-flash", "gpt-4o"}, 18},
		{"merged groups", map[string]string{"default": "Default", "vip": "VIP"}, []string{"claude-00", "deepseek-v4-flash", "gemini-flash", "gpt-4o", "qwen-plus"}, 19},
	} {
		t.Run(test.name, func(t *testing.T) {
			catalog := model.GetHomeCatalog(test.groups)
			require.Len(t, catalog.Models, test.count)
			names := make([]string, 0, len(catalog.Models))
			for _, item := range catalog.Models {
				names = append(names, item.ModelName)
			}
			assert.Equal(t, test.first, names[:len(test.first)])
			assert.Contains(t, names, "deepseek-v4-flash")
			assert.Contains(t, names, "deepseek-v4.1-flash")
			assert.Equal(t, len(names), len(slices.Compact(slices.Sorted(slices.Values(names)))))
			assert.Equal(t, catalog, model.GetHomeCatalog(test.groups))
			if test.name == "single group" {
				assert.NotContains(t, names, "qwen-plus")
			}
		})
	}
}

func TestGetStatusIncludesOnlyPublicHomeCatalog(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	previousGroups := setting.UserUsableGroups2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups)) })
	vendor := model.Vendor{Name: "HomeVendor", Icon: "OpenAI", Status: 1}
	require.NoError(t, db.Create(&vendor).Error)
	channel := model.Channel{Type: constant.ChannelTypeOpenAI, Key: "fixture-key", Status: 1, Name: "home-catalog"}
	require.NoError(t, db.Create(&channel).Error)
	for _, item := range []struct{ name, group string }{{"gpt-4o", "default"}, {"private-model", "vip"}} {
		require.NoError(t, db.Create(&model.Model{ModelName: item.name, VendorID: vendor.Id, Status: 1}).Error)
		require.NoError(t, db.Create(&model.Ability{Model: item.name, Group: item.group, ChannelId: channel.Id, Enabled: true}).Error)
	}
	model.RefreshPricing()
	for _, test := range []struct {
		name, config string
		public       bool
	}{
		{"default", "", true},
		{"public", `{"pricing":{"enabled":true,"requireAuth":false}}`, true},
		{"disabled", `{"pricing":{"enabled":false}}`, false},
		{"login required", `{"pricing":{"enabled":true,"requireAuth":true}}`, false},
		{"legacy disabled", `{"pricing":false}`, false},
		{"string login required", `{"pricing":{"enabled":"1","requireAuth":"true"}}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			setModelStatusHeaderNavModules(t, test.config)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
			// Even an authenticated caller must receive the same public status.
			context.Set("id", 123)
			GetStatus(context)
			require.Equal(t, http.StatusOK, response.Code)
			var payload struct {
				Data map[string]any `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			if test.public {
				body, err := common.Marshal(payload.Data["home_catalog"])
				require.NoError(t, err)
				assert.JSONEq(t, fmt.Sprintf(`{"models":[{"model_name":"gpt-4o","icon":"OpenAI"}],"vendors":[{"id":%d,"name":"HomeVendor","icon":"OpenAI"}]}`, vendor.Id), string(body))
			} else {
				assert.NotContains(t, payload.Data, "home_catalog")
			}
			assert.NotContains(t, response.Body.String(), "private-model")
		})
	}
}

func TestGetStatusDoesNotQueryDatabaseForHomeCatalog(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	setModelStatusHeaderNavModules(t, "")
	// Startup prewarms the showcase. Pricing invalidation must not move that
	// database work back onto the next status request, including empty catalogs.
	model.RefreshPricing()
	model.InvalidatePricingCache()
	queries := 0
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("home_catalog_status_query", func(tx *gorm.DB) {
		queries++
		_ = tx.AddError(fmt.Errorf("status must not query the catalog database"))
	}))
	require.NoError(t, db.Callback().Row().Before("gorm:row").Register("home_catalog_status_row", func(tx *gorm.DB) {
		queries++
		_ = tx.AddError(fmt.Errorf("status must not query the catalog database"))
	}))
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

	GetStatus(context)

	require.Equal(t, http.StatusOK, response.Code)
	assert.Zero(t, queries, "a status response must not wait for catalog database work")
}

func TestGetStatusServesHomeCatalogWhilePricingRefreshIsBlocked(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	setModelStatusHeaderNavModules(t, "")
	previousGroups := setting.UserUsableGroups2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups)) })
	seedHomeCatalog(t, db, []model.Pricing{
		{ModelName: "original-model", VendorID: 1, EnableGroup: []string{"default"}},
		{ModelName: "private-model", VendorID: 2, EnableGroup: []string{"vip"}},
	}, []model.PricingVendor{{ID: 1, Name: "Public", Icon: "OpenAI"}, {ID: 2, Name: "Private"}})
	require.NoError(t, db.Model(&model.Ability{}).Where("model = ?", "original-model").Update("model", "updated-model").Error)
	require.NoError(t, db.Model(&model.Model{}).Where("model_name = ?", "original-model").Update("model_name", "updated-model").Error)
	model.InvalidatePricingCache()

	refreshStarted := make(chan struct{}, 1)
	releaseRefresh := make(chan struct{})
	refreshDone := make(chan struct{})
	var statusDone chan struct{}
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("home_catalog_block_refresh", func(tx *gorm.DB) {
		select {
		case refreshStarted <- struct{}{}:
		default:
		}
		<-releaseRefresh
	}))
	go func() {
		model.RefreshPricing()
		close(refreshDone)
	}()
	t.Cleanup(func() {
		close(releaseRefresh)
		<-refreshDone
		if statusDone != nil {
			<-statusDone
		}
		require.NoError(t, db.Callback().Query().Remove("home_catalog_block_refresh"))
	})
	select {
	case <-refreshStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("pricing refresh did not reach the blocked database query")
	}

	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	statusDone = make(chan struct{})
	go func() {
		GetStatus(context)
		close(statusDone)
	}()
	select {
	case <-statusDone:
	case <-time.After(5 * time.Second):
		t.Fatal("status waited for the pricing refresh")
	}
	require.Equal(t, http.StatusOK, response.Code)
	assert.Contains(t, response.Body.String(), "original-model")
	assert.NotContains(t, response.Body.String(), "updated-model")
	assert.NotContains(t, response.Body.String(), "private-model")

	// Visibility changes apply to the cached summary before the refresh ends.
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{}`))
	response = httptest.NewRecorder()
	context, _ = gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	GetStatus(context)
	assert.Contains(t, response.Body.String(), `"home_catalog":{"models":[],"vendors":[]}`)
}

func TestHomeCatalogPublishesUpdatedAndEmptyCatalogs(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	seedHomeCatalog(t, db, []model.Pricing{
		{ModelName: "original-model", VendorID: 1, EnableGroup: []string{"default"}},
	}, []model.PricingVendor{{ID: 1, Name: "Public", Icon: "OpenAI"}})
	groups := map[string]string{"default": "Default"}
	before := model.GetHomeCatalog(groups)
	require.Len(t, before.Models, 1)

	require.NoError(t, db.Callback().Row().Before("gorm:row").Register("home_catalog_failed_refresh", func(tx *gorm.DB) {
		_ = tx.AddError(fmt.Errorf("catalog database unavailable"))
	}))
	model.InvalidatePricingCache()
	model.RefreshPricing()
	assert.Equal(t, before, model.GetHomeCatalog(groups))
	require.NoError(t, db.Callback().Row().Remove("home_catalog_failed_refresh"))

	require.NoError(t, db.Model(&model.Vendor{}).Where("id = ?", 1).Update("icon", "Anthropic").Error)
	model.RefreshPricing()
	assert.Equal(t, "OpenAI", before.Models[0].Icon)
	assert.Equal(t, "Anthropic", model.GetHomeCatalog(groups).Models[0].Icon)

	require.NoError(t, db.Model(&model.Ability{}).Where("model = ?", "original-model").Update("enabled", false).Error)
	model.RefreshPricing()
	assert.Equal(t, model.HomeCatalog{Models: []model.HomeCatalogModel{}, Vendors: []model.HomeCatalogVendor{}}, model.GetHomeCatalog(groups))
}

func TestHomeCatalogEndpointUsesCatalogAccessAndAccountGroups(t *testing.T) {
	db := setupModelStatusControllerTest(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.AuditLog{}))
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	previousGroups := setting.UserUsableGroups2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups)) })
	channel := model.Channel{Type: constant.ChannelTypeOpenAI, Key: "fixture-key", Status: 1, Name: "home-catalog"}
	require.NoError(t, db.Create(&channel).Error)
	for _, item := range []struct{ name, group string }{{"gpt-4o", "default"}, {"private-model", "vip"}} {
		require.NoError(t, db.Create(&model.Ability{Model: item.name, Group: item.group, ChannelId: channel.Id, Enabled: true}).Error)
	}
	model.RefreshPricing()
	user := model.User{Username: "home-member", Password: "unused-hash", Group: "vip", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
	user.SetAccessToken("home-member-token")
	require.NoError(t, db.Create(&user).Error)
	for _, test := range []struct {
		name, config, token string
		status              int
		private             bool
	}{
		{"anonymous public", "", "", http.StatusOK, false},
		{"anonymous restricted", `{"pricing":{"requireAuth":true}}`, "", http.StatusUnauthorized, false},
		{"authenticated restricted", `{"pricing":{"requireAuth":true}}`, "home-member-token", http.StatusOK, true},
		{"invalid credential", `{"pricing":{"requireAuth":true}}`, "invalid-token", http.StatusUnauthorized, false},
		{"disabled", `{"pricing":false}`, "", http.StatusForbidden, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			setModelStatusHeaderNavModules(t, test.config)
			router := gin.New()
			router.GET("/api/home/catalog", middleware.HeaderNavModuleAuth("pricing"), middleware.DisableCache(), GetHomeCatalog)
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/home/catalog", nil)
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			router.ServeHTTP(response, request)
			require.Equal(t, test.status, response.Code, response.Body.String())
			if test.status != http.StatusOK {
				assert.NotContains(t, response.Body.String(), "private-model")
				return
			}
			assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
			var payload struct {
				Success bool              `json:"success"`
				Data    model.HomeCatalog `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			require.True(t, payload.Success)
			assert.True(t, slices.ContainsFunc(payload.Data.Models, func(item model.HomeCatalogModel) bool {
				return item.ModelName == "gpt-4o"
			}))
			assert.Equal(t, test.private, slices.ContainsFunc(payload.Data.Models, func(item model.HomeCatalogModel) bool {
				return item.ModelName == "private-model"
			}))
		})
	}
}
