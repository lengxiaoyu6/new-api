package ratio_setting

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

var defaultGroupRatio = map[string]float64{
	"default": 1,
	"vip":     1,
	"svip":    1,
}

var groupRatioMap = types.NewRWMap[string, float64]()

var defaultGroupGroupRatio = map[string]map[string]float64{
	"vip": {
		"edit_this": 0.9,
	},
}

var groupGroupRatioMap = types.NewRWMap[string, map[string]float64]()

var defaultGroupSpecialUsableGroup = map[string]map[string]string{}

type GroupRatioSetting struct {
	GroupRatio              *types.RWMap[string, float64]            `json:"group_ratio"`
	GroupGroupRatio         *types.RWMap[string, map[string]float64] `json:"group_group_ratio"`
	GroupSpecialUsableGroup *types.RWMap[string, map[string]string]  `json:"group_special_usable_group"`
}

var groupRatioSetting GroupRatioSetting

func init() {
	groupSpecialUsableGroup := types.NewRWMap[string, map[string]string]()
	groupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)

	groupRatioMap.AddAll(defaultGroupRatio)
	groupGroupRatioMap.AddAll(defaultGroupGroupRatio)

	groupRatioSetting = GroupRatioSetting{
		GroupSpecialUsableGroup: groupSpecialUsableGroup,
		GroupRatio:              groupRatioMap,
		GroupGroupRatio:         groupGroupRatioMap,
	}

	config.GlobalConfig.Register("group_ratio_setting", &groupRatioSetting)
}

func GetGroupRatioSetting() *GroupRatioSetting {
	if groupRatioSetting.GroupSpecialUsableGroup == nil {
		groupRatioSetting.GroupSpecialUsableGroup = types.NewRWMap[string, map[string]string]()
		groupRatioSetting.GroupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)
	}
	return &groupRatioSetting
}

func GetGroupRatioCopy() map[string]float64 {
	groups := groupRatioMap.ReadAll()
	for name, ratio := range groups {
		canonical := common.ResolveGroupName(name)
		if canonical != name {
			if _, exists := groups[canonical]; !exists {
				groups[canonical] = ratio
			}
			delete(groups, name)
		}
	}
	return groups
}

func ContainsGroupRatio(name string) bool {
	for _, candidate := range common.GroupNameCandidates(name) {
		if _, ok := groupRatioMap.Get(candidate); ok {
			return true
		}
	}
	return false
}

func GroupRatio2JSONString() string {
	data, _ := common.Marshal(GetGroupRatioCopy())
	return string(data)
}

func UpdateGroupRatioByJSONString(jsonStr string) error {
	var err error
	jsonStr, err = setting.CanonicalGroupOption("GroupRatio", jsonStr, common.GroupRenameSnapshot.Load().Aliases)
	if err != nil {
		return err
	}
	return types.LoadFromJsonString(groupRatioMap, jsonStr)
}

func GetGroupRatio(name string) float64 {
	for _, candidate := range common.GroupNameCandidates(name) {
		if ratio, ok := groupRatioMap.Get(candidate); ok {
			return ratio
		}
	}
	common.SysLog(common.LogText("group ratio not found: %s", name))
	return 1
}

func GetGroupGroupRatio(userGroup, usingGroup string) (float64, bool) {
	for _, userName := range common.GroupNameCandidates(userGroup) {
		gp, ok := groupGroupRatioMap.Get(userName)
		if !ok {
			continue
		}
		for _, group := range common.GroupNameCandidates(usingGroup) {
			if ratio, ok := gp[group]; ok {
				return ratio, true
			}
		}
	}
	return -1, false
}

func GroupGroupRatio2JSONString() string {
	return groupGroupRatioMap.MarshalJSONString()
}

func UpdateGroupGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupGroupRatioMap, jsonStr)
}

func CheckGroupRatio(jsonStr string) error {
	checkGroupRatio := make(map[string]float64)
	err := common.UnmarshalJsonStr(jsonStr, &checkGroupRatio)
	if err != nil {
		return err
	}
	for name, ratio := range checkGroupRatio {
		if ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}
