package model

import (
	"cmp"
	"slices"
	"sync/atomic"
	"time"
)

type HomeCatalogModel struct {
	ModelName string `json:"model_name"`
	Icon      string `json:"icon,omitempty"`
}

type HomeCatalogVendor struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
}

type HomeCatalog struct {
	Models  []HomeCatalogModel  `json:"models"`
	Vendors []HomeCatalogVendor `json:"vendors"`
}

type homeCatalogSnapshot struct {
	groups map[string]homeCatalogGroup
}

type homeCatalogGroup struct {
	models  []homeCatalogModel
	vendors []HomeCatalogVendor
}

type homeCatalogModel struct {
	HomeCatalogModel
	vendorID int
}

// orderHomeCatalogModels retains every unique name and interleaves vendors.
func orderHomeCatalogModels(models []homeCatalogModel) []homeCatalogModel {
	slices.SortFunc(models, func(a, b homeCatalogModel) int {
		if order := cmp.Compare(a.ModelName, b.ModelName); order != 0 {
			return order
		}
		return cmp.Compare(a.vendorID, b.vendorID)
	})
	byVendor := make(map[int][]homeCatalogModel)
	vendors := make([]int, 0)
	seen := make(map[string]struct{})
	for _, item := range models {
		if _, exists := seen[item.ModelName]; exists {
			continue
		}
		seen[item.ModelName] = struct{}{}
		if len(byVendor[item.vendorID]) == 0 {
			vendors = append(vendors, item.vendorID)
		}
		byVendor[item.vendorID] = append(byVendor[item.vendorID], item)
	}
	ordered := make([]homeCatalogModel, 0, len(seen))
	for index := 0; len(ordered) < len(seen); index++ {
		for _, vendorID := range vendors {
			items := byVendor[vendorID]
			if index < len(items) {
				ordered = append(ordered, items[index])
			}
		}
	}
	return ordered
}

var homeCatalogCache atomic.Pointer[homeCatalogSnapshot]

// publishHomeCatalog runs under updatePricingLock and publishes immutable
// display metadata per group. Readers never acquire the pricing refresh locks.
func publishHomeCatalog(pricing []Pricing, vendors []PricingVendor) {
	vendorIcons := make(map[int]string, len(vendors))
	for _, vendor := range vendors {
		vendorIcons[vendor.ID] = vendor.Icon
	}
	groups := make(map[string]homeCatalogGroup)
	vendorGroups := make(map[int]map[string]struct{})
	for _, item := range pricing {
		icon := item.Icon
		if icon == "" {
			icon = vendorIcons[item.VendorID]
		}
		for _, group := range item.EnableGroup {
			catalog := groups[group]
			catalog.models = append(catalog.models, homeCatalogModel{
				HomeCatalogModel: HomeCatalogModel{ModelName: item.ModelName, Icon: icon},
				vendorID:         item.VendorID,
			})
			groups[group] = catalog
			if vendorGroups[item.VendorID] == nil {
				vendorGroups[item.VendorID] = make(map[string]struct{})
			}
			vendorGroups[item.VendorID][group] = struct{}{}
		}
	}
	for group, catalog := range groups {
		catalog.models = orderHomeCatalogModels(catalog.models)
		groups[group] = catalog
	}
	sortedVendors := slices.Clone(vendors)
	slices.SortFunc(sortedVendors, func(a, b PricingVendor) int {
		if order := cmp.Compare(a.Name, b.Name); order != 0 {
			return order
		}
		return cmp.Compare(a.ID, b.ID)
	})
	for _, vendor := range sortedVendors {
		for group := range vendorGroups[vendor.ID] {
			catalog := groups[group]
			if len(catalog.vendors) < 8 {
				catalog.vendors = append(catalog.vendors, HomeCatalogVendor{
					ID: vendor.ID, Name: vendor.Name, Icon: vendor.Icon,
				})
				groups[group] = catalog
			}
		}
	}
	homeCatalogCache.Store(&homeCatalogSnapshot{groups: groups})
}

// GetHomeCatalog combines the cached display metadata for currently usable
// groups. The "all" group follows the pricing catalog's visibility rules.
func GetHomeCatalog(usableGroups map[string]string) HomeCatalog {
	catalog := HomeCatalog{Models: []HomeCatalogModel{}, Vendors: []HomeCatalogVendor{}}
	snapshot := homeCatalogCache.Load()
	if snapshot == nil || len(usableGroups) == 0 {
		return catalog
	}
	groups := make([]string, 0, len(usableGroups)+1)
	groups = append(groups, "all")
	for group := range usableGroups {
		if group != "all" {
			groups = append(groups, group)
		}
	}
	models := make(map[string]homeCatalogModel)
	vendors := make(map[int]HomeCatalogVendor)
	for _, group := range groups {
		for _, item := range snapshot.groups[group].models {
			models[item.ModelName] = item
		}
		for _, vendor := range snapshot.groups[group].vendors {
			vendors[vendor.ID] = vendor
		}
	}
	candidates := make([]homeCatalogModel, 0, len(models))
	for _, item := range models {
		candidates = append(candidates, item)
	}
	for _, item := range orderHomeCatalogModels(candidates) {
		catalog.Models = append(catalog.Models, item.HomeCatalogModel)
	}
	for _, vendor := range vendors {
		catalog.Vendors = append(catalog.Vendors, vendor)
	}
	slices.SortFunc(catalog.Vendors, func(a, b HomeCatalogVendor) int {
		if order := cmp.Compare(a.Name, b.Name); order != 0 {
			return order
		}
		return cmp.Compare(a.ID, b.ID)
	})
	catalog.Vendors = catalog.Vendors[:min(len(catalog.Vendors), 8)]
	return catalog
}

// SyncHomeCatalog keeps the showcase current even when no pricing page is
// opened. Invalidating pricing preserves the last complete showcase.
func SyncHomeCatalog() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		updatePricingLock.Lock()
		if time.Since(lastGetPricingTime) >= time.Minute || pricingMap == nil {
			modelSupportEndpointsLock.Lock()
			updatePricing()
			modelSupportEndpointsLock.Unlock()
		}
		updatePricingLock.Unlock()
	}
}
