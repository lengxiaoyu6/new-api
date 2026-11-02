package model

import (
	"context"
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func groupRenameDatabase(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(filepath.Join(t.TempDir(), "rename.db") + "?_pragma=busy_timeout(5000)")
	case "mysql":
		dsn := os.Getenv("TEST_MYSQL_DSN")
		if dsn == "" {
			t.Skip("TEST_MYSQL_DSN is not configured")
		}
		driver = mysql.Open(dsn)
	case "postgres":
		dsn := os.Getenv("TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("TEST_POSTGRES_DSN is not configured")
		}
		driver = postgres.Open(dsn)
	}
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(4)
	previousDB, previousType := DB, common.MainDatabaseType()
	previousCache := common.MemoryCacheEnabled
	previousState := common.GroupRenameSnapshot.Load()
	previousRevision := groupRenameAppliedRevision.Load()
	previousHomeCatalog := homeCatalogCache.Load()
	common.OptionMapRWMutex.RLock()
	previousOptionMap := maps.Clone(common.OptionMap)
	common.OptionMapRWMutex.RUnlock()
	previousOptions := map[string]string{
		"GroupRatio":                 ratio_setting.GroupRatio2JSONString(),
		"TopupGroupRatio":            common.TopupGroupRatio2JSONString(),
		"UserUsableGroups":           setting.UserUsableGroups2JSONString(),
		"GroupGroupRatio":            ratio_setting.GroupGroupRatio2JSONString(),
		"AutoGroups":                 setting.AutoGroups2JsonString(),
		"ModelRequestRateLimitGroup": setting.ModelRequestRateLimitGroup2JSONString(),
	}
	special, err := common.Marshal(ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.ReadAll())
	require.NoError(t, err)
	previousOptions["group_ratio_setting.group_special_usable_group"] = string(special)
	DB = db
	common.SetMainDatabaseType(common.DatabaseType(dialect))
	common.MemoryCacheEnabled = true
	common.GroupRenameSnapshot.Store(&common.GroupRenameState{})
	groupRenameAppliedRevision.Store(0)
	initCol()
	models := []any{&Option{}, &User{}, &Token{}, &Channel{}, &Ability{}, &SubscriptionPlan{}, &UserSubscription{}, &Task{}}
	require.NoError(t, db.AutoMigrate(models...))
	require.NoError(t, db.Use(groupNames{}))
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(models...))
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.MemoryCacheEnabled = previousCache
		common.GroupRenameSnapshot.Store(previousState)
		groupRenameAppliedRevision.Store(previousRevision)
		homeCatalogCache.Store(previousHomeCatalog)
		initCol()
		for key, value := range previousOptions {
			require.NoError(t, updateOptionMap(key, value))
		}
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptionMap
		common.OptionMapRWMutex.Unlock()
		InitChannelCache()
		require.NoError(t, sqlDB.Close())
	})
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("%s version: %s", dialect, version)
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Unlock()
	return db
}

func seedGroupRename(t *testing.T, db *gorm.DB) (User, Token, Channel) {
	t.Helper()
	options := map[string]string{
		"GroupRatio":                 `{"default":1,"claude-max":0.4,"claude-max-plus":1.2}`,
		"TopupGroupRatio":            `{"claude-max":0.9}`,
		"UserUsableGroups":           `{"default":"Default","claude-max":"claude-max"}`,
		"GroupGroupRatio":            `{"claude-max":{"claude-max":0.3},"default":{"claude-max":0.2}}`,
		"AutoGroups":                 `["default","claude-max","claude-max-plus"]`,
		"ModelRequestRateLimitGroup": `{"claude-max":[20,10]}`,
		"group_ratio_setting.group_special_usable_group": `{"claude-max":{"+:claude-max":"claude-max","-:default":"hide"},"default":{"-:claude-max":"hidden"}}`,
	}
	for key, value := range options {
		require.NoError(t, db.Create(&Option{Key: key, Value: value}).Error)
		require.NoError(t, updateOptionMap(key, value))
	}
	user := User{Username: "rename-user", Group: "claude-max", Quota: 1000, AuthVersion: 3, Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&user).Error)
	token := Token{UserId: user.Id, Key: "rename-test-key", Group: "claude-max",
		AutoGroups: `["default","claude-max"]`, RemainQuota: 500, Status: common.TokenStatusEnabled}
	require.NoError(t, db.Create(&token).Error)
	channel := Channel{Name: "rename-channel", Type: constant.ChannelTypeOpenAI, Key: "preserved-upstream-key",
		Group: "default,claude-max,claude-max-plus", Models: "claude-max,other-model", Status: common.ChannelStatusEnabled,
		OtherSettings: `{"group_models":{"claude-max":["claude-max"],"claude-max-plus":[]},"remark":"claude-max"}`}
	require.NoError(t, channel.Insert())
	require.NoError(t, db.Create(&SubscriptionPlan{Title: "Plan", UpgradeGroup: "claude-max",
		DowngradeGroup: "claude-max", AllowedGroups: "default,claude-max"}).Error)
	require.NoError(t, db.Create(&UserSubscription{UserId: user.Id, UpgradeGroup: "claude-max",
		DowngradeGroup: "claude-max", PrevUserGroup: "claude-max", AllowedGroups: "claude-max,default"}).Error)
	require.NoError(t, db.Create(&Task{TaskID: "rename-task", Group: "claude-max", Quota: 17,
		Data: json.RawMessage(`{"model":"claude-max","ratio":0.4}`)}).Error)
	InitChannelCache()
	return user, token, channel
}

func TestGroupRenameDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := groupRenameDatabase(t, dialect)
			user, token, channel := seedGroupRename(t, db)
			publishHomeCatalog([]Pricing{{
				ModelName: "claude-max", EnableGroup: []string{"claude-max"}, VendorID: 7,
			}}, []PricingVendor{{ID: 7, Name: "Claude"}})
			// Redis balances may be ahead of DB while requests are in flight.
			server := useUserCacheMiniRedis(t)
			require.NoError(t, populateUserCache(user))
			_, err := cacheInitToken(token)
			require.NoError(t, err)
			require.NoError(t, common.RDB.HSet(t.Context(), getUserCacheKey(user.Id), "Quota", 777).Err())
			require.NoError(t, common.RDB.HSet(t.Context(), getTokenCacheKey(token.Key), "RemainQuota", 333).Err())

			result, err := RenameGroup(t.Context(), "claude-max", "claude-特惠")
			require.NoError(t, err)
			assert.Equal(t, "claude-特惠", result.NewName)
			raw := db.Session(&gorm.Session{SkipHooks: true})
			var savedUser User
			require.NoError(t, raw.First(&savedUser, user.Id).Error)
			assert.Equal(t, "claude-特惠", savedUser.Group)
			assert.EqualValues(t, 1000, savedUser.Quota)
			assert.EqualValues(t, 3, savedUser.AuthVersion)
			var savedToken Token
			require.NoError(t, raw.First(&savedToken, token.Id).Error)
			assert.Equal(t, "claude-特惠", savedToken.Group)
			assert.JSONEq(t, `["default","claude-特惠"]`, savedToken.AutoGroups)
			assert.Equal(t, token.Key, savedToken.Key)
			assert.Equal(t, 500, savedToken.RemainQuota)
			var savedChannel Channel
			require.NoError(t, raw.First(&savedChannel, channel.Id).Error)
			assert.Equal(t, "default,claude-特惠,claude-max-plus", savedChannel.Group)
			assert.JSONEq(t, `{"group_models":{"claude-特惠":["claude-max"],"claude-max-plus":[]},"remark":"claude-max"}`, savedChannel.OtherSettings)
			assert.Equal(t, channel.Key, savedChannel.Key)
			var plan SubscriptionPlan
			require.NoError(t, raw.First(&plan).Error)
			assert.Equal(t, "claude-特惠", plan.UpgradeGroup)
			assert.Equal(t, "claude-特惠", plan.DowngradeGroup)
			assert.Equal(t, "default,claude-特惠", plan.AllowedGroups)
			var subscription UserSubscription
			require.NoError(t, raw.First(&subscription).Error)
			assert.Equal(t, "claude-特惠", subscription.UpgradeGroup)
			assert.Equal(t, "claude-特惠", subscription.DowngradeGroup)
			assert.Equal(t, "claude-特惠", subscription.PrevUserGroup)
			assert.Equal(t, "claude-特惠,default", subscription.AllowedGroups)
			var task Task
			require.NoError(t, raw.First(&task).Error)
			assert.Equal(t, "claude-特惠", task.Group)
			assert.Equal(t, 17, task.Quota)
			assert.JSONEq(t, `{"model":"claude-max","ratio":0.4}`, string(task.Data))
			assert.Equal(t, 0.4, ratio_setting.GetGroupRatio("claude-特惠"))
			assert.Equal(t, 0.4, ratio_setting.GetGroupRatio("claude-max"))
			assert.Equal(t, "claude-max", setting.GetUsableGroupDescription("claude-特惠"))
			ratio, ok := ratio_setting.GetGroupGroupRatio("claude-特惠", "claude-特惠")
			assert.True(t, ok)
			assert.Equal(t, 0.3, ratio)
			assert.Equal(t, []string{"default", "claude-特惠", "claude-max-plus"}, setting.GetAutoGroups())
			catalog := GetHomeCatalog(map[string]string{"claude-特惠": "Claude"})
			assert.Equal(t, []HomeCatalogModel{{ModelName: "claude-max"}}, catalog.Models)
			assert.Equal(t, []HomeCatalogVendor{{ID: 7, Name: "Claude"}}, catalog.Vendors)
			var special Option
			require.NoError(t, raw.Where(&Option{Key: "group_ratio_setting.group_special_usable_group"}).First(&special).Error)
			assert.JSONEq(t, `{"claude-特惠":{"+:claude-特惠":"claude-max","-:default":"hide"},"default":{"-:claude-特惠":"hidden"}}`, special.Value)

			// Simulate an instance which still holds the previous configuration.
			common.GroupRenameSnapshot.Store(&common.GroupRenameState{})
			groupRenameAppliedRevision.Store(0)
			cachedUser, err := GetUserCache(user.Id)
			require.NoError(t, err)
			assert.Equal(t, "claude-特惠", cachedUser.Group)
			assert.Equal(t, 777, cachedUser.Quota)
			cachedToken, err := GetTokenByKey(token.Key, false)
			require.NoError(t, err)
			assert.Equal(t, "claude-特惠", cachedToken.Group)
			assert.Equal(t, 333, cachedToken.RemainQuota)
			groups, err := cachedToken.GetAutoGroups()
			require.NoError(t, err)
			assert.Equal(t, []string{"default", "claude-特惠"}, groups)
			assert.False(t, server.Exists(getUserAuthFenceKey(user.Id)))
			assert.False(t, server.Exists(getTokenCacheFenceKey(token.Key)))
			common.RedisEnabled = false
			common.GroupRenameSnapshot.Store(&common.GroupRenameState{})
			groupRenameAppliedRevision.Store(0)
			uncachedUser, err := GetUserCache(user.Id)
			require.NoError(t, err)
			assert.Equal(t, "claude-特惠", uncachedUser.Group)
			assert.Equal(t, 1000, uncachedUser.Quota)
			common.RedisEnabled = true
			for _, memory := range []bool{false, true} {
				common.MemoryCacheEnabled = memory
				for _, name := range []string{"claude-max", "claude-特惠"} {
					selected, err := GetRandomSatisfiedChannel(name, "claude-max", 0, nil)
					require.NoError(t, err)
					require.NotNil(t, selected)
					assert.Equal(t, channel.Id, selected.Id)
					assert.True(t, IsChannelEnabledForGroupModel(name, "claude-max", channel.Id))
					assert.False(t, IsChannelEnabledForGroupModel(name, "other-model", channel.Id))
				}
			}
			// Stale admin pages and background snapshots cannot resurrect a name.
			require.NoError(t, db.Model(&User{}).Where("id = ?", user.Id).Updates(map[string]any{"group": "claude-max"}).Error)
			require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Updates(Token{Group: "claude-max"}).Error)
			stale := User{Username: "stale-create", AffCode: "rename-stale", Group: "claude-max"}
			require.NoError(t, db.Create(&stale).Error)
			require.NoError(t, UpdateOption("AutoGroups", `["claude-max","default"]`))
			assert.Equal(t, []string{"claude-特惠", "default"}, setting.GetAutoGroups())
			require.NoError(t, raw.First(&savedUser, user.Id).Error)
			assert.Equal(t, "claude-特惠", savedUser.Group)
			require.NoError(t, raw.First(&savedToken, token.Id).Error)
			assert.Equal(t, "claude-特惠", savedToken.Group)
			assert.Equal(t, "claude-特惠", stale.Group)
			snapshot := savedUser
			snapshot.Group = "claude-max"
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				return snapshot.EditWithTx(tx, false)
			}))
			assert.EqualValues(t, 3, snapshot.AuthVersion, "a previous name denotes the same authorization group")

			// A rename must wait for a group-bearing write already in progress.
			writer := db.Begin()
			require.NoError(t, writer.Error)
			t.Cleanup(func() { _ = writer.Rollback().Error })
			require.NoError(t, writer.Model(&User{}).Where("id = ?", user.Id).Update("group", "claude-max").Error)
			started := make(chan struct{}, 1)
			const callback = "test:group_rename_attempt"
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
				if option, ok := tx.Statement.Dest.(*Option); ok && option.Key == setting.GroupRenameStateOption {
					select {
					case started <- struct{}{}:
					default:
					}
				}
			}))
			t.Cleanup(func() { _ = db.Callback().Create().Remove(callback) })
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, err := RenameGroup(ctx, "claude-特惠", "claude-special")
				done <- err
			}()
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			require.NoError(t, writer.Commit().Error)
			select {
			case err := <-done:
				require.NoError(t, err)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			require.NoError(t, raw.First(&savedUser, user.Id).Error)
			assert.Equal(t, "claude-special", savedUser.Group)
			assert.Equal(t, "claude-special", common.ResolveGroupName("claude-max"))
			_, err = RenameGroup(t.Context(), "claude-special", "claude-max")
			assert.ErrorIs(t, err, ErrGroupNameReserved)
		})
	}
}

func TestGroupRenameRollbackAndValidation(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := groupRenameDatabase(t, dialect)
			user, token, channel := seedGroupRename(t, db)
			for _, pair := range [][2]string{
				{"default", "other"}, {"auto", "other"}, {"claude-max", "default"},
				{"claude-max", " claude-new"}, {"claude-max", "a,b"}, {"claude-max", "a\nb"},
				{"missing", "other"}, {"claude-max", "claude-max-plus"},
			} {
				_, err := RenameGroup(t.Context(), pair[0], pair[1])
				require.Error(t, err)
			}
			raw := db.Session(&gorm.Session{SkipHooks: true})
			for _, invalid := range []string{
				`{"group_models":{"claude-max":[],"claude-特惠":[]}}`,
				`{malformed`,
			} {
				require.NoError(t, raw.Model(&Channel{}).Where("id = ?", channel.Id).UpdateColumn("settings", invalid).Error)
				_, err := RenameGroup(t.Context(), "claude-max", "claude-特惠")
				require.Error(t, err)
				var after User
				require.NoError(t, raw.First(&after, user.Id).Error)
				assert.Equal(t, "claude-max", after.Group, "previous scalar writes must roll back")
				assert.Empty(t, common.GroupRenameSnapshot.Load().Aliases)
			}
			require.NoError(t, raw.Model(&Channel{}).Where("id = ?", channel.Id).UpdateColumn("settings", channel.OtherSettings).Error)
			require.NoError(t, raw.Model(&Token{}).Where("id = ?", token.Id).UpdateColumn("auto_groups", `["claude-特惠"]`).Error)
			_, err := RenameGroup(t.Context(), "claude-max", "claude-特惠")
			assert.ErrorIs(t, err, ErrGroupNameExists)
			require.NoError(t, raw.Model(&Token{}).Where("id = ?", token.Id).UpdateColumn("auto_groups", token.AutoGroups).Error)
			_, err = RenameGroup(context.Background(), "claude-max", "claude-特惠")
			require.NoError(t, err)
		})
	}
}
