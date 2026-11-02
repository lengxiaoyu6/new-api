package setting

import (
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// The default descriptions are English source keys that the web console
// translates; descriptions an administrator saves are shown as written.
var userUsableGroups = map[string]string{
	"default": "Default group",
	"vip":     "VIP group",
}
var userUsableGroupsMutex sync.RWMutex

func GetUserUsableGroupsCopy() map[string]string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	copyUserUsableGroups := make(map[string]string)
	for name, description := range userUsableGroups {
		canonical := common.ResolveGroupName(name)
		if _, exists := copyUserUsableGroups[canonical]; !exists || name == canonical {
			copyUserUsableGroups[canonical] = description
		}
	}
	return copyUserUsableGroups
}

func UserUsableGroups2JSONString() string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	jsonBytes, err := common.Marshal(userUsableGroups)
	if err != nil {
		common.SysLog(common.LogText("error marshalling user groups: %s", err.Error()))
	}
	return string(jsonBytes)
}

func UpdateUserUsableGroupsByJSONString(jsonStr string) error {
	userUsableGroupsMutex.Lock()
	defer userUsableGroupsMutex.Unlock()

	userUsableGroups = make(map[string]string)
	return common.Unmarshal([]byte(jsonStr), &userUsableGroups)
}

func GetUsableGroupDescription(groupName string) string {
	userUsableGroupsMutex.RLock()
	defer userUsableGroupsMutex.RUnlock()

	for _, candidate := range common.GroupNameCandidates(groupName) {
		if desc, ok := userUsableGroups[candidate]; ok {
			return desc
		}
	}
	return groupName
}
