package setting

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const GroupRenameStateOption = "GroupRenameState"

var GroupReferenceOptionKeys = []string{
	"GroupRatio", "TopupGroupRatio", "UserUsableGroups", "GroupGroupRatio",
	"AutoGroups", "ModelRequestRateLimitGroup", "GroupSpecialUsableGroup",
	"group_ratio_setting.group_ratio",
	"group_ratio_setting.group_group_ratio",
	"group_ratio_setting.group_special_usable_group",
}

func IsGroupReferenceOption(key string) bool {
	return slices.Contains(GroupReferenceOptionKeys, key)
}

// GroupOptionNames returns only group identifiers, never descriptions or model
// names. Renaming into any referenced name would combine distinct groups.
func GroupOptionNames(key, value string) ([]string, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	if key == "AutoGroups" {
		var names []string
		err := common.UnmarshalJsonStr(value, &names)
		return names, err
	}
	var groups map[string]json.RawMessage
	if err := common.UnmarshalJsonStr(value, &groups); err != nil {
		return nil, err
	}
	var names []string
	nested := key == "GroupGroupRatio" || key == "group_ratio_setting.group_group_ratio"
	special := key == "GroupSpecialUsableGroup" || key == "group_ratio_setting.group_special_usable_group"
	for name, raw := range groups {
		names = append(names, name)
		if !nested && !special {
			continue
		}
		var targets map[string]json.RawMessage
		if err := common.Unmarshal(raw, &targets); err != nil {
			return nil, err
		}
		for target := range targets {
			if special && (strings.HasPrefix(target, "+:") || strings.HasPrefix(target, "-:")) {
				target = target[2:]
			}
			names = append(names, target)
		}
	}
	return names, nil
}

// CanonicalGroupOption changes group references, preserving descriptions,
// prices, model identifiers, and the order of automatic groups.
func CanonicalGroupOption(key, value string, aliases map[string]string) (string, error) {
	if !IsGroupReferenceOption(key) || len(aliases) == 0 || strings.TrimSpace(value) == "" {
		return value, nil
	}
	if key == "AutoGroups" {
		return CanonicalAutoGroups(value, aliases)
	}
	var groups map[string]json.RawMessage
	if err := common.UnmarshalJsonStr(value, &groups); err != nil {
		return "", err
	}
	nested := key == "GroupGroupRatio" || key == "group_ratio_setting.group_group_ratio"
	special := key == "GroupSpecialUsableGroup" || key == "group_ratio_setting.group_special_usable_group"
	result := make(map[string]json.RawMessage, len(groups))
	if groups == nil {
		return value, nil
	}
	for name, raw := range groups {
		canonical := common.CanonicalGroupName(name, aliases)
		if _, exists := result[canonical]; exists {
			return "", errors.New("Group settings contain conflicting names")
		}
		if nested || special {
			var targets map[string]json.RawMessage
			if err := common.Unmarshal(raw, &targets); err != nil {
				return "", err
			}
			renamed := make(map[string]json.RawMessage, len(targets))
			for target, data := range targets {
				prefix := ""
				if special && (strings.HasPrefix(target, "+:") || strings.HasPrefix(target, "-:")) {
					prefix, target = target[:2], target[2:]
				}
				target = prefix + common.CanonicalGroupName(target, aliases)
				if _, exists := renamed[target]; exists {
					return "", errors.New("Group settings contain conflicting names")
				}
				renamed[target] = data
			}
			if targets != nil {
				encoded, err := common.Marshal(renamed)
				if err != nil {
					return "", err
				}
				raw = encoded
			}
		}
		result[canonical] = raw
	}
	data, err := common.Marshal(result)
	return string(data), err
}

func CanonicalAutoGroups(value string, aliases map[string]string) (string, error) {
	if value == "" || len(aliases) == 0 {
		return value, nil
	}
	var groups []string
	if err := common.UnmarshalJsonStr(value, &groups); err != nil {
		return "", err
	}
	if groups == nil {
		return value, nil
	}
	result := make([]string, 0, len(groups))
	for _, group := range groups {
		group = common.CanonicalGroupName(group, aliases)
		if !slices.Contains(result, group) {
			result = append(result, group)
		}
	}
	data, err := common.Marshal(result)
	return string(data), err
}
