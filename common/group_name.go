package common

import (
	"slices"
	"strings"
	"sync/atomic"
)

// GroupRenameState keeps old names reserved for the same group. The snapshot is
// immutable after publication, including Aliases.
type GroupRenameState struct {
	Revision uint64            `json:"revision"`
	Aliases  map[string]string `json:"aliases"`
}

var GroupRenameSnapshot atomic.Pointer[GroupRenameState]

func init() {
	GroupRenameSnapshot.Store(&GroupRenameState{})
}

func PublishGroupRenameState(state *GroupRenameState) {
	for {
		current := GroupRenameSnapshot.Load()
		if current.Revision >= state.Revision {
			return
		}
		if GroupRenameSnapshot.CompareAndSwap(current, state) {
			return
		}
	}
}

func CanonicalGroupName(name string, aliases map[string]string) string {
	for range len(aliases) {
		next, ok := aliases[name]
		if !ok {
			break
		}
		name = next
	}
	return name
}

func ResolveGroupName(name string) string {
	return CanonicalGroupName(name, GroupRenameSnapshot.Load().Aliases)
}

// GroupNameCandidates also covers a cache/configuration snapshot built before
// a rename. The canonical name always takes precedence.
func GroupNameCandidates(name string) []string {
	state := GroupRenameSnapshot.Load()
	canonical := CanonicalGroupName(name, state.Aliases)
	names := []string{canonical}
	for previous := range state.Aliases {
		if CanonicalGroupName(previous, state.Aliases) == canonical {
			names = append(names, previous)
		}
	}
	slices.Sort(names[1:])
	return names
}

func CanonicalGroupList(raw string, aliases map[string]string) string {
	groups := make([]string, 0)
	for part := range strings.SplitSeq(raw, ",") {
		name := CanonicalGroupName(strings.TrimSpace(part), aliases)
		if name != "" && !slices.Contains(groups, name) {
			groups = append(groups, name)
		}
	}
	return strings.Join(groups, ",")
}
