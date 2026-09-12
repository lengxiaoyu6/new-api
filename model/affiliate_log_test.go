package model

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAffiliateEarningsLogRecordsAllKinds(t *testing.T) {
	// 10% 返利 + 合规确认
	setupTopupRebateTestState(t, 10, true)
	originQuotaForInviter := common.QuotaForInviter
	common.QuotaForInviter = 1000
	t.Cleanup(func() { common.QuotaForInviter = originQuotaForInviter })

	inviter := newTopupRebateTestUser(t, "afflog_inviter", 0)
	invitee := newTopupRebateTestUser(t, "afflog_invitee", inviter.Id)

	// 注册奖励
	require.NoError(t, inviteUser(inviter.Id))
	// 充值返利：10% of 10,000,000 = 1,000,000
	var rebateInviterId, rebate int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var grantErr error
		rebateInviterId, rebate, grantErr = grantTopupInviterRebate(tx, invitee.Id, 10000000)
		return grantErr
	})
	require.NoError(t, err)
	recordTopupInviterRebateLog(rebateInviterId, invitee.Id, rebate, 10000000, "afflog_trade_no")
	// 划转到余额（注册 1000 + 返利 1000000）
	require.NoError(t, inviter.TransferAffQuotaToQuota(1001000))

	logs, total, err := GetAffiliateLogsByUserId(inviter.Id, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, logs, 3)
	// 倒序：transfer(-1001000), topup(1000000), register(1000)
	assert.Equal(t, -1001000, logs[0].Quota)
	assert.Contains(t, logs[0].Other, "\"kind\":\"transfer\"")
	assert.Equal(t, 1000000, logs[1].Quota)
	assert.Contains(t, logs[1].Other, "\"kind\":\"topup\"")
	assert.Equal(t, 1000, logs[2].Quota)
	assert.Contains(t, logs[2].Other, "\"kind\":\"register\"")
}

func TestTransferAffQuotaHasNoMinimum(t *testing.T) {
	user := newTopupRebateTestUser(t, "aff_transfer_min", 0)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("aff_quota", 100).Error)

	require.NoError(t, user.TransferAffQuotaToQuota(1), "any positive quota must be transferable")

	var reloaded User
	require.NoError(t, DB.First(&reloaded, "id = ?", user.Id).Error)
	assert.Equal(t, 99, reloaded.AffQuota)
	assert.Equal(t, 1, reloaded.Quota)

	err := user.TransferAffQuotaToQuota(0)
	require.Error(t, err, "zero transfer must be rejected")
}

// Schema snapshot from v1.0.0-rc.37, before withdrawal accounting.
type affiliateLegacyUser struct {
	Id                   int                        `json:"id"`
	Username             string                     `json:"username" gorm:"unique;index" validate:"max=20"`
	Password             string                     `json:"password" gorm:"not null;" validate:"min=8,max=128"`
	HasPassword          bool                       `json:"-" gorm:"-:all"`
	OriginalPassword     string                     `json:"original_password" gorm:"-:all"` // this field is only for Password change verification, don't save it to database!
	DisplayName          string                     `json:"display_name" gorm:"index" validate:"max=20"`
	Role                 int                        `json:"role" gorm:"type:int;default:1"`   // admin, common
	Status               int                        `json:"status" gorm:"type:int;default:1"` // enabled, disabled
	Email                string                     `json:"email" gorm:"index" validate:"max=50"`
	GitHubId             string                     `json:"github_id" gorm:"column:github_id;index"`
	DiscordId            string                     `json:"discord_id" gorm:"column:discord_id;index"`
	OidcId               string                     `json:"oidc_id" gorm:"column:oidc_id;index"`
	WeChatId             string                     `json:"wechat_id" gorm:"column:wechat_id;index"`
	TelegramId           string                     `json:"telegram_id" gorm:"column:telegram_id;index"`
	VerificationCode     string                     `json:"verification_code" gorm:"-:all"`                         // this field is only for Email verification, don't save it to database!
	AccessToken          *string                    `json:"-" gorm:"type:char(32);column:access_token;uniqueIndex"` // this token is for system management
	AccessTokenCreatedAt *int64                     `json:"-" gorm:"type:bigint;column:access_token_created_at"`
	Quota                int                        `json:"quota" gorm:"type:int;default:0"`
	UsedQuota            int                        `json:"used_quota" gorm:"type:int;default:0;column:used_quota"` // used quota
	RequestCount         int                        `json:"request_count" gorm:"type:int;default:0;"`               // request number
	Group                string                     `json:"group" gorm:"type:varchar(64);default:'default'"`
	AffCode              string                     `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	AffCount             int                        `json:"aff_count" gorm:"type:int;default:0;column:aff_count"`
	AffQuota             int                        `json:"aff_quota" gorm:"type:int;default:0;column:aff_quota"`           // 邀请剩余额度
	AffHistoryQuota      int                        `json:"aff_history_quota" gorm:"type:int;default:0;column:aff_history"` // 邀请历史额度
	InviterId            int                        `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	DeletedAt            gorm.DeletedAt             `gorm:"index"`
	LinuxDOId            string                     `json:"linux_do_id" gorm:"column:linux_do_id;index"`
	Setting              string                     `json:"setting" gorm:"type:text;column:setting"`
	Remark               string                     `json:"remark,omitempty" gorm:"type:varchar(255)" validate:"max=255"`
	StripeCustomer       string                     `json:"stripe_customer" gorm:"type:varchar(64);column:stripe_customer;index"`
	CreatedAt            int64                      `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	LastLoginAt          int64                      `json:"last_login_at" gorm:"default:0;column:last_login_at"`
	AuthVersion          int64                      `json:"-" gorm:"type:bigint;not null;default:1;column:auth_version"`
	AdminPermissions     map[string]map[string]bool `json:"admin_permissions,omitempty" gorm:"-:all"`
}

func (affiliateLegacyUser) TableName() string { return "users" }

func TestAffiliateWithdrawalDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			originalDB, originalLogDB := DB, LOG_DB
			originalMainType, originalLogType := common.MainDatabaseType(), common.LogDatabaseType()
			t.Cleanup(func() {
				DB, LOG_DB = originalDB, originalLogDB
				common.SetDatabaseTypes(originalMainType, originalLogType)
				initCol()
			})
			var db, logDB *gorm.DB
			var err error
			if dialect == "sqlite" {
				db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "main.db")+"?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"), &gorm.Config{})
				require.NoError(t, err)
				logDB, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "log.db")+"?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"), &gorm.Config{})
				require.NoError(t, err)
			} else {
				key := strings.ToUpper(dialect)
				dsn := os.Getenv("TEST_" + key + "_DSN")
				logDSN := os.Getenv("TEST_AFFILIATE_" + key + "_LOG_DSN")
				if dsn == "" || logDSN == "" {
					t.Skip("isolated main and log database DSNs are required")
				}
				t.Setenv("AFFILIATE_MATRIX_DSN", dsn)
				t.Setenv("AFFILIATE_MATRIX_LOG_DSN", logDSN)
				db, _, err = chooseDB("AFFILIATE_MATRIX_DSN", false)
				require.NoError(t, err)
				logDB, _, err = chooseDB("AFFILIATE_MATRIX_LOG_DSN", true)
				require.NoError(t, err)
			}
			DB, LOG_DB = db, logDB
			common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
			initCol()
			for _, connection := range []*gorm.DB{DB, LOG_DB} {
				sqlDB, err := connection.DB()
				require.NoError(t, err)
				t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			}
			var version string
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			require.NoError(t, DB.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s; separate log database enabled", version)
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&AffiliateWithdrawal{}, &User{}))
				require.NoError(t, logDB.Migrator().DropTable(&Log{}))
			})
			// These DSNs must refer to disposable databases; never reuse an application database.
			require.False(t, DB.Migrator().HasTable(&User{}), "matrix requires an empty isolated database")
			require.NoError(t, LOG_DB.AutoMigrate(&Log{}))
			require.NoError(t, LOG_DB.AutoMigrate(&Log{}))
			require.NoError(t, DB.AutoMigrate(&User{}, &AffiliateWithdrawal{}))
			recorder := &migrationSQLRecorder{}
			require.NoError(t, DB.Session(&gorm.Session{Logger: recorder}).AutoMigrate(&User{}, &AffiliateWithdrawal{}))
			assert.Empty(t, recorder.schemaMutations(), "fresh migration must be idempotent")
			t.Run("withdrawal_and_transfer_accounting", testAffiliateWithdrawalAccounting)
			t.Run("concurrent_spending", testAffiliateConcurrentSpending)

			require.NoError(t, DB.Migrator().DropTable(&AffiliateWithdrawal{}, &User{}))
			require.NoError(t, LOG_DB.Where("1 = 1").Delete(&Log{}).Error)
			require.NoError(t, DB.AutoMigrate(&affiliateLegacyUser{}))
			legacy := affiliateLegacyUser{Username: "legacy_referral", Password: "preserved-password-hash", AffCode: "legacy_referral", AffQuota: 800, AffHistoryQuota: 1200, Quota: 400}
			require.NoError(t, DB.Create(&legacy).Error)
			RecordAffiliateLog(legacy.Id, "register", 200, nil)
			RecordAffiliateLog(legacy.Id, "topup", 1000, nil)
			RecordAffiliateLog(legacy.Id, "transfer", -400, nil)
			beforeIndexes, err := DB.Migrator().GetIndexes(&affiliateLegacyUser{})
			require.NoError(t, err)
			require.NoError(t, DB.AutoMigrate(&User{}, &AffiliateWithdrawal{}))
			recorder.reset()
			require.NoError(t, DB.Session(&gorm.Session{Logger: recorder}).AutoMigrate(&User{}, &AffiliateWithdrawal{}))
			assert.Empty(t, recorder.schemaMutations(), "upgrade migration must be idempotent")
			for _, index := range beforeIndexes {
				assert.True(t, DB.Migrator().HasIndex(&User{}, index.Name()), index.Name())
			}
			saved, err := GetAffiliateUser(legacy.Id)
			require.NoError(t, err)
			assert.Equal(t, 800, saved.AffWithdrawableQuota)
			assert.Equal(t, 800, saved.AffQuota)
			assert.Equal(t, 1200, saved.AffHistoryQuota)
			assert.Equal(t, 400, saved.Quota)
			assert.Equal(t, legacy.Password, saved.Password)
			again, err := GetAffiliateUser(legacy.Id)
			require.NoError(t, err)
			assert.Equal(t, saved.AffWithdrawableQuota, again.AffWithdrawableQuota)
			duplicate := User{Username: legacy.Username, AffCode: "another_code"}
			assert.Error(t, DB.Create(&duplicate).Error, "username uniqueness survives migration")
			duplicate = User{Username: "another_user", AffCode: legacy.AffCode}
			assert.Error(t, DB.Create(&duplicate).Error, "referral code uniqueness survives migration")
			request := AffiliateWithdrawalRequest{RequestID: uuid.NewString(), Quota: 800, Method: "bank", AccountName: "Legacy", Account: "123"}
			_, err = CreateAffiliateWithdrawal(legacy.Id, request)
			require.NoError(t, err)
			require.NoError(t, LOG_DB.Where("1 = 1").Delete(&Log{}).Error)
			saved, err = GetAffiliateUser(legacy.Id)
			require.NoError(t, err)
			assert.Zero(t, saved.AffWithdrawableQuota, "eligibility must never be reconstructed twice")
		})
	}
}

func testAffiliateWithdrawalAccounting(t *testing.T) {
	setupTopupRebateTestState(t, 10, true)
	previousReward := common.QuotaForInviter
	common.QuotaForInviter = 200
	t.Cleanup(func() { common.QuotaForInviter = previousReward })
	inviter := newTopupRebateTestUser(t, "withdraw_inviter", 0)
	invitee := newTopupRebateTestUser(t, "withdraw_invitee", inviter.Id)
	require.NoError(t, inviteUser(inviter.Id))
	request := AffiliateWithdrawalRequest{RequestID: uuid.NewString(), Quota: 1, Method: "bank", AccountName: "Test", Account: "123"}
	_, err := CreateAffiliateWithdrawal(inviter.Id, request)
	assert.ErrorIs(t, err, ErrAffiliateWithdrawalInsufficient, "registration rewards cannot be withdrawn")
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { _, _, err := grantTopupInviterRebate(tx, invitee.Id, 10000); return err }))
	require.NoError(t, inviter.TransferAffQuotaToQuota(400))
	assert.Equal(t, 800, inviter.AffWithdrawableQuota)
	assert.Equal(t, 400, inviter.Quota)
	request.Quota = 500
	withdrawal, err := CreateAffiliateWithdrawal(inviter.Id, request)
	require.NoError(t, err)
	assert.Equal(t, "0.001", withdrawal.AmountUSD)
	assert.Equal(t, AffiliateWithdrawalPending, withdrawal.Status)
	repeat, err := CreateAffiliateWithdrawal(inviter.Id, request)
	require.NoError(t, err)
	assert.Equal(t, withdrawal.ID, repeat.ID)
	conflict := request
	conflict.Account = "another"
	_, err = CreateAffiliateWithdrawal(inviter.Id, conflict)
	assert.ErrorIs(t, err, ErrAffiliateWithdrawalConflict)
	stored, err := GetAffiliateUser(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 300, stored.AffQuota)
	assert.Equal(t, 300, stored.AffWithdrawableQuota)
	assert.Equal(t, 400, stored.Quota)
	assert.Equal(t, 1200, stored.AffHistoryQuota)
	require.Error(t, stored.TransferAffQuotaToQuota(301), "pending withdrawal funds cannot be transferred")
	request.RequestID, request.Quota = uuid.NewString(), 301
	_, err = CreateAffiliateWithdrawal(inviter.Id, request)
	assert.ErrorIs(t, err, ErrAffiliateWithdrawalInsufficient)
	_, err = ReviewAffiliateWithdrawal(withdrawal.ID, 99, AffiliateWithdrawalRejected, "Invalid recipient")
	require.NoError(t, err)
	_, err = ReviewAffiliateWithdrawal(withdrawal.ID, 99, AffiliateWithdrawalRejected, "Repeated request")
	require.NoError(t, err)
	_, err = ReviewAffiliateWithdrawal(withdrawal.ID, 99, AffiliateWithdrawalPaid, "reference")
	assert.ErrorIs(t, err, ErrAffiliateWithdrawalProcessed)
	stored, err = GetAffiliateUser(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 800, stored.AffWithdrawableQuota, "rejection refunds exactly once")
	request.RequestID, request.Quota = uuid.NewString(), 600
	paid, err := CreateAffiliateWithdrawal(inviter.Id, request)
	require.NoError(t, err)
	_, err = ReviewAffiliateWithdrawal(paid.ID, 99, AffiliateWithdrawalPaid, "bank-2026-001")
	require.NoError(t, err)
	_, err = ReviewAffiliateWithdrawal(paid.ID, 99, AffiliateWithdrawalPaid, "bank-2026-001")
	require.NoError(t, err)
	_, err = ReviewAffiliateWithdrawal(paid.ID, 99, AffiliateWithdrawalRejected, "refund")
	assert.ErrorIs(t, err, ErrAffiliateWithdrawalProcessed)
	require.NoError(t, stored.TransferAffQuotaToQuota(200))
	assert.Zero(t, stored.AffWithdrawableQuota)
	assert.Equal(t, 600, stored.Quota)
	request.RequestID, request.Quota = uuid.NewString(), 1
	_, err = CreateAffiliateWithdrawal(inviter.Id, request)
	assert.ErrorIs(t, err, ErrAffiliateWithdrawalInsufficient, "transferred rebates permanently lose withdrawal eligibility")
	items, err := ListAffiliateWithdrawals(invitee.Id, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Empty(t, items, "withdrawal history is scoped to its owner")
}

func testAffiliateConcurrentSpending(t *testing.T) {
	user := newTopupRebateTestUser(t, "concurrent_referral", 0)
	require.NoError(t, DB.Model(user).Updates(map[string]any{"aff_quota": 1000, "aff_history": 1000, "aff_withdrawable_quota": 1000, "aff_withdrawal_initialized": true}).Error)
	start := make(chan struct{})
	outcomes := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Go(func() {
		<-start
		_, err := CreateAffiliateWithdrawal(user.Id, AffiliateWithdrawalRequest{RequestID: uuid.NewString(), Quota: 700, Method: "bank", AccountName: "Test", Account: "123"})
		outcomes <- err
	})
	wg.Go(func() { <-start; target := User{Id: user.Id}; outcomes <- target.TransferAffQuotaToQuota(700) })
	close(start)
	wg.Wait()
	close(outcomes)
	successes := 0
	for err := range outcomes {
		if err == nil {
			successes++
		}
	}
	assert.Equal(t, 1, successes, "only one concurrent spend can consume the shared funds")
	stored, err := GetAffiliateUser(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 300, stored.AffQuota)
	assert.Equal(t, 300, stored.AffWithdrawableQuota)
	var withdrawals []AffiliateWithdrawal
	require.NoError(t, DB.Where("user_id = ?", user.Id).Find(&withdrawals).Error)
	total := stored.Quota + stored.AffQuota
	for _, withdrawal := range withdrawals {
		total += withdrawal.Quota
	}
	assert.Equal(t, 1000, total, "transfer and withdrawal preserve total funds")
}

func TestAffiliateLegacyIncompleteHistoryAndInvalidAmounts(t *testing.T) {
	setupTopupRebateTestState(t, 10, true)
	require.NoError(t, DB.AutoMigrate(&AffiliateWithdrawal{}))
	user := newTopupRebateTestUser(t, "incomplete_history", 0)
	require.NoError(t, DB.Model(user).Updates(map[string]any{"aff_quota": 1000, "aff_history": 2000}).Error)
	RecordAffiliateLog(user.Id, "topup", 1000, nil)
	stored, err := GetAffiliateUser(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 1000, stored.AffQuota)
	assert.Zero(t, stored.AffWithdrawableQuota)
	for _, amount := range []int{-1, 0, common.MaxWalletQuota + 1} {
		_, err := CreateAffiliateWithdrawal(user.Id, AffiliateWithdrawalRequest{RequestID: uuid.NewString(), Quota: amount, Method: "bank", AccountName: "Test", Account: "123"})
		assert.ErrorIs(t, err, ErrAffiliateWithdrawalInvalid)
		assert.Error(t, stored.TransferAffQuotaToQuota(amount))
	}
	require.NoError(t, DB.Model(user).Update("quota", common.MaxWalletQuota).Error)
	assert.ErrorIs(t, stored.TransferAffQuotaToQuota(1), ErrWalletQuotaLimitExceeded)
	require.NoError(t, DB.First(stored, user.Id).Error)
	assert.Equal(t, 1000, stored.AffQuota, "failed transfer leaves rewards untouched")
	invitee := newTopupRebateTestUser(t, "bounded_rebate_invitee", user.Id)
	require.NoError(t, DB.Model(user).Updates(map[string]any{"aff_quota": common.MaxWalletQuota, "aff_history": common.MaxWalletQuota, "aff_withdrawable_quota": common.MaxWalletQuota}).Error)
	err = DB.Transaction(func(tx *gorm.DB) error {
		_, _, err := grantTopupInviterRebate(tx, invitee.Id, 100)
		return err
	})
	assert.ErrorIs(t, err, ErrWalletQuotaLimitExceeded)
	require.NoError(t, DB.First(stored, user.Id).Error)
	assert.Equal(t, common.MaxWalletQuota, stored.AffWithdrawableQuota, "oversized accumulated rebates cannot overflow the wallet")
}
