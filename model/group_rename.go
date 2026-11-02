package model

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var groupRenameSync sync.Mutex
var groupRenameAppliedRevision atomic.Uint64

var ErrGroupNameInvalid = errors.New("Group names must contain 1 to 50 characters without commas, control characters, or surrounding whitespace")
var ErrGroupNameReserved = errors.New("Default, automatic, and previous group names cannot be renamed or reused")
var ErrGroupNameMissing = errors.New("The group to rename does not exist")
var ErrGroupNameExists = errors.New("The new group name is already in use")

type GroupRenameResult struct {
	OldName string           `json:"old_name"`
	NewName string           `json:"new_name"`
	Updated map[string]int64 `json:"updated"`
}

func parseGroupRenameState(value string) (*common.GroupRenameState, error) {
	var state common.GroupRenameState
	if err := common.UnmarshalJsonStr(value, &state); err != nil {
		return nil, err
	}
	for name, target := range state.Aliases {
		if name == "" || target == "" || name == target {
			return nil, errors.New("Invalid group rename state")
		}
		seen := map[string]bool{name: true}
		for next := target; next != ""; next = state.Aliases[next] {
			if seen[next] {
				return nil, errors.New("Invalid group rename state")
			}
			seen[next] = true
		}
	}
	return &state, nil
}

// SyncGroupNames checks the durable revision before authenticated requests.
// The single primary-key read works across instances with or without Redis;
// full configuration/channel refresh happens only after a rename.
func SyncGroupNames(ctx context.Context) error {
	if DB == nil || DB.Config.Plugins["group_names"] == nil {
		return nil
	}
	var option Option
	err := DB.WithContext(ctx).Where(&Option{Key: setting.GroupRenameStateOption}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	state, err := parseGroupRenameState(option.Value)
	if err != nil {
		return err
	}
	if state.Revision <= groupRenameAppliedRevision.Load() {
		return nil
	}
	groupRenameSync.Lock()
	defer groupRenameSync.Unlock()
	if state.Revision <= groupRenameAppliedRevision.Load() {
		return nil
	}
	// Publish aliases before replacing configuration. Readers can use either
	// name in an older cache until the refreshed snapshot becomes available.
	common.PublishGroupRenameState(state)
	var options []Option
	if err := DB.WithContext(ctx).Where(map[string]any{"key": setting.GroupReferenceOptionKeys}).Find(&options).Error; err != nil {
		return err
	}
	for _, option := range options {
		if err := updateOptionMap(option.Key, option.Value); err != nil {
			return err
		}
	}
	InitChannelCache()
	_ = getSubscriptionPlanCache().Purge()
	groupRenameAppliedRevision.Store(state.Revision)
	return nil
}

func RenameGroup(ctx context.Context, oldName, newName string) (*GroupRenameResult, error) {
	for _, name := range []string{oldName, newName} {
		if !utf8.ValidString(name) || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 50 ||
			strings.TrimSpace(name) != name || strings.Contains(name, ",") || strings.ContainsFunc(name, unicode.IsControl) {
			return nil, ErrGroupNameInvalid
		}
		if name == "default" || name == "auto" {
			return nil, ErrGroupNameReserved
		}
	}
	if oldName == newName {
		return nil, ErrGroupNameExists
	}
	result := &GroupRenameResult{OldName: oldName, NewName: newName, Updated: make(map[string]int64)}
	err := DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		state, err := lockGroupRenameState(tx)
		if err != nil {
			return err
		}
		if _, exists := state.Aliases[oldName]; exists {
			return ErrGroupNameReserved
		}
		if _, exists := state.Aliases[newName]; exists {
			return ErrGroupNameReserved
		}
		// Every group-bearing write takes the same option-row lock. Internal
		// migration writes bypass normalization until the transaction commits.
		tx = tx.Session(&gorm.Session{SkipHooks: true})
		current := ratio_setting.GetGroupRatioCopy()
		hasRatioOption, sourceExists := false, false
		var options []Option
		if err := tx.Where(map[string]any{"key": setting.GroupReferenceOptionKeys}).Find(&options).Error; err != nil {
			return err
		}
		for _, option := range options {
			names, err := setting.GroupOptionNames(option.Key, option.Value)
			if err != nil {
				return err
			}
			if slices.Contains(names, newName) {
				return ErrGroupNameExists
			}
			if option.Key == "GroupRatio" || option.Key == "group_ratio_setting.group_ratio" {
				hasRatioOption = true
				sourceExists = sourceExists || slices.Contains(names, oldName)
			}
		}
		if !hasRatioOption {
			_, sourceExists = current[oldName]
		}
		if !sourceExists {
			return ErrGroupNameMissing
		}
		if _, exists := current[newName]; exists {
			return ErrGroupNameExists
		}
		aliases := maps.Clone(state.Aliases)
		if aliases == nil {
			aliases = make(map[string]string)
		}
		aliases[oldName] = newName
		for name := range aliases {
			aliases[name] = common.CanonicalGroupName(name, aliases)
		}
		// Scalar references use portable ORM updates, including soft-deleted
		// rows so restoring a record cannot bring back the previous name.
		for _, entry := range []struct {
			model   any
			columns []string
		}{
			{&User{}, []string{"group"}},
			{&Token{}, []string{"group"}},
			{&Ability{}, []string{"group"}},
			{&SubscriptionPlan{}, []string{"upgrade_group", "downgrade_group"}},
			{&UserSubscription{}, []string{"upgrade_group", "downgrade_group", "prev_user_group"}},
			{&Task{}, []string{"group"}},
		} {
			for _, column := range entry.columns {
				var count int64
				if err := tx.Unscoped().Model(entry.model).Where(clause.Eq{Column: clause.Column{Name: column}, Value: newName}).Count(&count).Error; err != nil {
					return err
				}
				if count != 0 {
					return ErrGroupNameExists
				}
				update := tx.Unscoped().Model(entry.model).
					Where(clause.Eq{Column: clause.Column{Name: column}, Value: oldName}).UpdateColumn(column, newName)
				if update.Error != nil {
					return update.Error
				}
				result.Updated[update.Statement.Table+"."+column] = update.RowsAffected
			}
		}
		if err := renameGroupLists(tx, newName, aliases, result.Updated); err != nil {
			return err
		}
		// Persist defaults too: a group can still use a built-in configuration
		// without an options row on a fresh installation.
		defaults := map[string]string{
			"GroupRatio":                 ratio_setting.GroupRatio2JSONString(),
			"GroupGroupRatio":            ratio_setting.GroupGroupRatio2JSONString(),
			"TopupGroupRatio":            common.TopupGroupRatio2JSONString(),
			"UserUsableGroups":           setting.UserUsableGroups2JSONString(),
			"AutoGroups":                 setting.AutoGroups2JsonString(),
			"ModelRequestRateLimitGroup": setting.ModelRequestRateLimitGroup2JSONString(),
		}
		existing := make(map[string]string)
		for _, option := range options {
			existing[option.Key] = option.Value
		}
		for key, value := range defaults {
			if _, present := existing[key]; !present {
				existing[key] = value
			}
		}
		for key, value := range existing {
			renamed, err := setting.CanonicalGroupOption(key, value, aliases)
			if err != nil {
				return err
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "key"}},
				DoUpdates: clause.AssignmentColumns([]string{"value"}),
			}).Create(&Option{Key: key, Value: renamed}).Error; err != nil {
				return err
			}
		}
		encoded, err := common.Marshal(common.GroupRenameState{Revision: state.Revision + 1, Aliases: aliases})
		if err != nil {
			return err
		}
		return tx.Model(&Option{}).Where(&Option{Key: setting.GroupRenameStateOption}).
			UpdateColumn("value", string(encoded)).Error
	})
	if err != nil {
		return nil, err
	}
	if err := SyncGroupNames(ctx); err != nil {
		// The committed revision remains discoverable by every instance. Report
		// refresh failures in the server log without inviting a second rename.
		common.SysError("refresh group rename state: " + err.Error())
	}
	return result, nil
}

func renameGroupLists(tx *gorm.DB, newName string, aliases map[string]string, updated map[string]int64) error {
	for _, entry := range []struct {
		model   any
		columns []string
	}{
		{&Channel{}, []string{"group", "settings"}},
		{&Token{}, []string{"auto_groups"}},
		{&SubscriptionPlan{}, []string{"allowed_groups"}},
		{&UserSubscription{}, []string{"allowed_groups"}},
	} {
		for _, column := range entry.columns {
			var records []struct {
				ID    int
				Value string
			}
			// Scan aliases avoid dialect-specific JSON and CSV SQL.
			query := tx.Unscoped().Model(entry.model).Select([]string{"id", column})
			rows, err := query.Rows()
			if err != nil {
				return err
			}
			for rows.Next() {
				var id int
				var raw *string
				if err := rows.Scan(&id, &raw); err != nil {
					rows.Close()
					return err
				}
				if raw != nil {
					records = append(records, struct {
						ID    int
						Value string
					}{id, *raw})
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return err
			}
			for _, record := range records {
				raw := record.Value
				if raw == "" {
					continue
				}
				if column == "group" || column == "allowed_groups" {
					if slices.Contains(strings.Split(common.CanonicalGroupList(raw, nil), ","), newName) {
						return ErrGroupNameExists
					}
				}
				if column == "auto_groups" {
					var groups []string
					if err := common.UnmarshalJsonStr(raw, &groups); err != nil {
						return err
					}
					if slices.Contains(groups, newName) {
						return ErrGroupNameExists
					}
				}
				if column == "settings" {
					var data map[string]json.RawMessage
					if err := common.UnmarshalJsonStr(raw, &data); err != nil {
						return err
					}
					if groups, ok := data["group_models"]; ok {
						names, err := setting.GroupOptionNames("GroupRatio", string(groups))
						if err != nil {
							return err
						}
						if slices.Contains(names, newName) {
							return ErrGroupNameExists
						}
					}
				}
				value, err := canonicalGroupField(query.Statement.Table, column, raw, aliases)
				if err != nil {
					return err
				}
				if value == raw {
					continue
				}
				change := tx.Unscoped().Model(entry.model).Where("id = ?", record.ID).UpdateColumn(column, value)
				if change.Error != nil {
					return change.Error
				}
				updated[query.Statement.Table+"."+column] += change.RowsAffected
			}
		}
	}
	return nil
}
