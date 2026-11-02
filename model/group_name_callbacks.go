package model

import (
	"encoding/json"
	"errors"
	"reflect"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// groupNames serializes group-bearing writes with renames, including map
// updates and bulk creates. Quota-only writes do not acquire this lock.
type groupNames struct{}

func (groupNames) Name() string { return "group_names" }

func (groupNames) Initialize(db *gorm.DB) error {
	state := Option{Key: setting.GroupRenameStateOption, Value: `{"revision":0,"aliases":{}}`}
	if err := db.Session(&gorm.Session{SkipHooks: true}).
		Clauses(clause.OnConflict{DoNothing: true}).Create(&state).Error; err != nil {
		return err
	}
	if err := db.Callback().Create().Before("gorm:before_create").Register("new_api:group_names", canonicalGroupMutation); err != nil {
		return err
	}
	if err := db.Callback().Update().Before("gorm:before_update").Register("new_api:group_names", canonicalGroupMutation); err != nil {
		return err
	}
	return db.Callback().Query().After("gorm:after_query").Register("new_api:group_names", canonicalGroupQuery)
}

func groupReferenceColumns(table string) []string {
	switch table {
	case "users", "abilities", "tasks":
		return []string{"group"}
	case "tokens":
		return []string{"group", "auto_groups"}
	case "channels":
		return []string{"group", "settings"}
	case "subscription_plans":
		return []string{"upgrade_group", "downgrade_group", "allowed_groups"}
	case "user_subscriptions":
		return []string{"upgrade_group", "downgrade_group", "prev_user_group", "allowed_groups"}
	case "options":
		return []string{"value"}
	default:
		return nil
	}
}

func lockGroupRenameState(tx *gorm.DB) (*common.GroupRenameState, error) {
	query := tx.Session(&gorm.Session{NewDB: true, SkipHooks: true})
	row := Option{Key: setting.GroupRenameStateOption, Value: `{"revision":0,"aliases":{}}`}
	// This first write also obtains SQLite's writer lock before any reads.
	if err := query.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		return nil, err
	}
	row = Option{}
	if err := lockForUpdate(query).Where(&Option{Key: setting.GroupRenameStateOption}).First(&row).Error; err != nil {
		return nil, err
	}
	return parseGroupRenameState(row.Value)
}

func canonicalGroupMutation(tx *gorm.DB) {
	if tx.Error != nil || tx.Statement.SkipHooks || tx.Statement.Schema == nil {
		return
	}
	columns := groupReferenceColumns(tx.Statement.Table)
	if len(columns) == 0 {
		return
	}
	if tx.Statement.Table == "options" {
		option, ok := tx.Statement.Dest.(*Option)
		if !ok || !setting.IsGroupReferenceOption(option.Key) {
			return
		}
	}
	// Inspect selected fields before locking, so balance/status updates and
	// other unrelated mutations keep their existing locking behavior.
	present := false
	if values, ok := tx.Statement.Dest.(map[string]any); ok {
		for key := range values {
			field := tx.Statement.Schema.LookUpField(key)
			if field == nil {
				continue
			}
			for _, column := range columns {
				if field.DBName == column {
					present = true
				}
			}
		}
	} else {
		selected, restricted := tx.Statement.SelectAndOmitColumns(false, true)
		for _, column := range columns {
			if included, explicit := selected[column]; (explicit && included) || (!explicit && !restricted) {
				present = true
			}
		}
	}
	if !present {
		return
	}
	state, err := lockGroupRenameState(tx)
	if err != nil {
		tx.AddError(err)
		return
	}
	common.PublishGroupRenameState(state)
	tx.AddError(canonicalGroupRecords(tx, state.Aliases))
}

func canonicalGroupQuery(tx *gorm.DB) {
	if tx.Error != nil || tx.Statement.SkipHooks || tx.Statement.Schema == nil || tx.Statement.Table == "options" {
		return
	}
	if len(groupReferenceColumns(tx.Statement.Table)) == 0 {
		return
	}
	var row Option
	err := tx.Session(&gorm.Session{NewDB: true, SkipHooks: true}).
		Where(&Option{Key: setting.GroupRenameStateOption}).First(&row).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		tx.AddError(err)
		return
	}
	if err == nil {
		state, err := parseGroupRenameState(row.Value)
		if err != nil {
			tx.AddError(err)
			return
		}
		common.PublishGroupRenameState(state)
	}
	tx.AddError(canonicalGroupRecords(tx, common.GroupRenameSnapshot.Load().Aliases))
}

func canonicalGroupRecords(tx *gorm.DB, aliases map[string]string) error {
	if len(aliases) == 0 {
		return nil
	}
	columns := groupReferenceColumns(tx.Statement.Table)
	if len(columns) == 0 {
		return nil
	}
	if option, ok := tx.Statement.Dest.(*Option); ok {
		value, err := setting.CanonicalGroupOption(option.Key, option.Value, aliases)
		if err == nil {
			option.Value = value
		}
		return err
	}
	if values, ok := tx.Statement.Dest.(map[string]any); ok {
		for key, value := range values {
			field := tx.Statement.Schema.LookUpField(key)
			if field == nil {
				continue
			}
			for _, column := range columns {
				if field.DBName != column || value == nil {
					continue
				}
				raw, ok := value.(string)
				if !ok {
					return errors.New("Group reference must be a string")
				}
				normalized, err := canonicalGroupField(tx.Statement.Table, column, raw, aliases)
				if err != nil {
					return err
				}
				values[key] = normalized
			}
		}
		return nil
	}
	value := reflect.ValueOf(tx.Statement.Dest)
	for value.Kind() == reflect.Pointer && !value.IsNil() {
		value = value.Elem()
	}
	// Updates(T{...}) can receive an unaddressable struct value. Replace it
	// with an addressable copy so normalization changes the SQL assignments.
	if value.Kind() == reflect.Struct && !value.CanAddr() {
		copy := reflect.New(value.Type())
		copy.Elem().Set(value)
		tx.Statement.Dest = copy.Interface()
		value = copy.Elem()
	}
	if value.Kind() == reflect.Slice || value.Kind() == reflect.Array {
		for i := range value.Len() {
			record := value.Index(i)
			for record.Kind() == reflect.Pointer && !record.IsNil() {
				record = record.Elem()
			}
			if record.Kind() == reflect.Struct {
				if err := canonicalGroupStruct(tx, record, columns, aliases); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if value.Kind() == reflect.Struct {
		return canonicalGroupStruct(tx, value, columns, aliases)
	}
	return nil
}

func canonicalGroupStruct(tx *gorm.DB, value reflect.Value, columns []string, aliases map[string]string) error {
	recordSchema := tx.Statement.Schema
	if value.Type() != recordSchema.ModelType {
		// Model(&User{}).First(&projection) retains the User schema, while
		// authentication queries often return smaller structs. Field access
		// must use the destination's layout, including its column tags.
		statement := &gorm.Statement{DB: tx}
		if err := statement.Parse(value.Addr().Interface()); err != nil {
			return err
		}
		recordSchema = statement.Schema
	}
	for _, column := range columns {
		field := recordSchema.LookUpField(column)
		if field == nil {
			continue
		}
		raw, _ := field.ValueOf(tx.Statement.Context, value)
		text, ok := raw.(string)
		if !ok || text == "" {
			continue
		}
		normalized, err := canonicalGroupField(tx.Statement.Table, column, text, aliases)
		if err != nil {
			return err
		}
		if err := field.Set(tx.Statement.Context, value, normalized); err != nil {
			return err
		}
	}
	return nil
}

func canonicalGroupField(table, column, value string, aliases map[string]string) (string, error) {
	if value == "" {
		return value, nil
	}
	if column == "auto_groups" {
		return setting.CanonicalAutoGroups(value, aliases)
	}
	if column == "allowed_groups" || (table == "channels" && column == "group") {
		return common.CanonicalGroupList(value, aliases), nil
	}
	if table == "channels" && column == "settings" {
		var data map[string]json.RawMessage
		if err := common.UnmarshalJsonStr(value, &data); err != nil {
			return "", err
		}
		raw, exists := data["group_models"]
		if !exists {
			return value, nil
		}
		renamed, err := setting.CanonicalGroupOption("GroupRatio", string(raw), aliases)
		if err != nil {
			return "", err
		}
		data["group_models"] = json.RawMessage(renamed)
		encoded, err := common.Marshal(data)
		return string(encoded), err
	}
	return common.CanonicalGroupName(value, aliases), nil
}
