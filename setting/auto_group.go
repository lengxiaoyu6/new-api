package setting

import (
	"fmt"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
)

const DefaultMaxTokenAutoGroups = 5

var autoGroups = []string{
	"default",
}

var DefaultUseAutoGroup = false

var maxTokenAutoGroups atomic.Int64
var autoGroupsMutex sync.RWMutex

func init() {
	maxTokenAutoGroups.Store(DefaultMaxTokenAutoGroups)
}

func ContainsAutoGroup(group string) bool {
	return slices.Contains(GetAutoGroups(), common.ResolveGroupName(group))
}

func UpdateAutoGroupsByJsonString(jsonString string) error {
	var groups []string
	if err := common.Unmarshal([]byte(jsonString), &groups); err != nil {
		return err
	}
	autoGroupsMutex.Lock()
	autoGroups = groups
	autoGroupsMutex.Unlock()
	return nil
}

func AutoGroups2JsonString() string {
	jsonBytes, err := common.Marshal(GetAutoGroups())
	if err != nil {
		return "[]"
	}
	return string(jsonBytes)
}

func GetAutoGroups() []string {
	autoGroupsMutex.RLock()
	defer autoGroupsMutex.RUnlock()
	groups := make([]string, 0, len(autoGroups))
	for _, group := range autoGroups {
		group = common.ResolveGroupName(group)
		if !slices.Contains(groups, group) {
			groups = append(groups, group)
		}
	}
	return groups
}

func GetMaxTokenAutoGroups() int {
	return int(maxTokenAutoGroups.Load())
}

func ValidateMaxTokenAutoGroups(value string) error {
	maxCount, err := strconv.Atoi(value)
	if err != nil || maxCount <= 0 {
		return fmt.Errorf("MaxTokenAutoGroups must be a positive integer")
	}
	return nil
}

func UpdateMaxTokenAutoGroups(value string) error {
	if err := ValidateMaxTokenAutoGroups(value); err != nil {
		return err
	}
	maxCount, _ := strconv.Atoi(value)
	maxTokenAutoGroups.Store(int64(maxCount))
	return nil
}
