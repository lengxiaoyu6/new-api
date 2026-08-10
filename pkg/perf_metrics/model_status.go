package perfmetrics

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/model"
)

type ModelStatusQueryParams struct {
	Hours  int
	Groups []string
}

type ModelStatusResponse struct {
	WindowHours int                   `json:"window_hours"`
	GeneratedAt int64                 `json:"generated_at"`
	LastUpdated string                `json:"last_updated"`
	Providers   []ModelStatusProvider `json:"providers"`
	Models      []ModelStatusItem     `json:"models"`
}

type ModelStatusProvider struct {
	ProviderID      string            `json:"provider_id"`
	ProviderName    string            `json:"provider_name"`
	Provider        string            `json:"provider"`
	VendorID        int               `json:"vendor_id,omitempty"`
	ChannelType     int               `json:"channel_type"`
	Health          string            `json:"health"`
	Status          string            `json:"status"`
	HealthScore     float64           `json:"health_score"`
	FastestTtftMs   int64             `json:"fastest_ttft_ms"`
	SlowestTtftMs   int64             `json:"slowest_ttft_ms"`
	SuccessRate     float64           `json:"success_rate"`
	RequestCount    int64             `json:"request_count"`
	TtftSampleCount int64             `json:"ttft_sample_count"`
	LastUpdated     string            `json:"last_updated"`
	Models          []ModelStatusItem `json:"models"`
}

type ModelStatusItem struct {
	ProviderID         string             `json:"provider_id"`
	ProviderName       string             `json:"provider_name"`
	Provider           string             `json:"provider"`
	VendorID           int                `json:"vendor_id,omitempty"`
	ChannelType        int                `json:"channel_type"`
	ModelName          string             `json:"model_name"`
	Health             string             `json:"health"`
	Status             string             `json:"status"`
	HealthScore        float64            `json:"health_score"`
	FastestTtftMs      int64              `json:"fastest_ttft_ms"`
	SlowestTtftMs      int64              `json:"slowest_ttft_ms"`
	SuccessRate        float64            `json:"success_rate"`
	RequestCount       int64              `json:"request_count"`
	TtftSampleCount    int64              `json:"ttft_sample_count"`
	LastUpdated        string             `json:"last_updated"`
	RecentSuccessRates []float64          `json:"recent_success_rates,omitempty"`
	Groups             []ModelStatusGroup `json:"groups"`
}

type ModelStatusGroup struct {
	Group              string    `json:"group"`
	Health             string    `json:"health"`
	Status             string    `json:"status"`
	HealthScore        float64   `json:"health_score"`
	FastestTtftMs      int64     `json:"fastest_ttft_ms"`
	SlowestTtftMs      int64     `json:"slowest_ttft_ms"`
	SuccessRate        float64   `json:"success_rate"`
	RequestCount       int64     `json:"request_count"`
	TtftSampleCount    int64     `json:"ttft_sample_count"`
	LastUpdated        string    `json:"last_updated"`
	RecentSuccessRates []float64 `json:"recent_success_rates,omitempty"`
}

type modelStatusKey struct {
	modelName string
	group     string
}

type modelStatusCatalogItem struct {
	providerID   string
	providerName string
	vendorID     int
	modelName    string
	groups       []string
}

type modelStatusProviderCatalog struct {
	providerID   string
	providerName string
	vendorID     int
}

type modelStatusAccumulator struct {
	counters
	lastUpdated int64
}

func QueryModelStatus(params ModelStatusQueryParams) (ModelStatusResponse, error) {
	hours := params.Hours
	if hours <= 0 {
		hours = 24
	}
	if hours > 24*30 {
		hours = 24 * 30
	}

	endTs := time.Now().Unix()
	startTs := endTs - int64(hours)*3600
	rows, err := model.GetPerfMetricsForStatus(startTs, endTs, params.Groups)
	if err != nil {
		return ModelStatusResponse{}, err
	}

	catalog := buildModelStatusCatalog(model.GetPricing(), model.GetVendors(), params.Groups)
	groupTotals := make(map[modelStatusKey]modelStatusAccumulator)
	modelBuckets := make(map[string]map[int64]counters)
	groupBuckets := make(map[modelStatusKey]map[int64]counters)
	allowedGroups := allowedGroupSet(params.Groups)
	for _, row := range rows {
		value := counters{
			requestCount:   row.RequestCount,
			successCount:   row.SuccessCount,
			totalLatencyMs: row.TotalLatencyMs,
			ttftSumMs:      row.TtftSumMs,
			ttftCount:      row.TtftCount,
			fastestTtftMs:  row.FastestTtftMs,
			slowestTtftMs:  row.SlowestTtftMs,
			outputTokens:   row.OutputTokens,
			generationMs:   row.GenerationMs,
		}
		groupKey := modelStatusKey{modelName: row.ModelName, group: row.Group}
		addModelStatusCounters(groupTotals, groupKey, value, row.BucketTs)
		mergeModelStatusGroupBucket(groupBuckets, groupKey, row.BucketTs, value)
		mergeModelBucket(modelBuckets, row.ModelName, row.BucketTs, value)
	}

	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		if k.bucketTs < startTs || k.bucketTs > endTs {
			return true
		}
		if allowedGroups != nil {
			if _, ok := allowedGroups[k.group]; !ok {
				return true
			}
		}
		snapshot := value.(*atomicBucket).snapshot()
		if snapshot.requestCount == 0 {
			return true
		}
		groupKey := modelStatusKey{modelName: k.model, group: k.group}
		addModelStatusCounters(groupTotals, groupKey, snapshot, k.bucketTs)
		mergeModelStatusGroupBucket(groupBuckets, groupKey, k.bucketTs, snapshot)
		mergeModelBucket(modelBuckets, k.model, k.bucketTs, snapshot)
		return true
	})

	items := make([]ModelStatusItem, 0, len(catalog))
	providerCatalog := make(map[string]modelStatusProviderCatalog)
	providerTotals := make(map[string]modelStatusAccumulator)
	modelsByProvider := make(map[string][]ModelStatusItem)
	for _, catalogItem := range catalog {
		total := modelStatusAccumulator{}
		groups := make([]ModelStatusGroup, 0, len(catalogItem.groups))
		for _, group := range catalogItem.groups {
			groupKey := modelStatusKey{modelName: catalogItem.modelName, group: group}
			groupTotal := groupTotals[groupKey]
			addStatusAccumulatorCounters(&total, groupTotal.counters, groupTotal.lastUpdated)
			groupTrend := statusTrendRates(groupBuckets[groupKey], modelStatusTrendPoints)
			groups = append(groups, buildModelStatusGroup(group, groupTotal, groupTrend))
		}

		item := buildModelStatusItem(catalogItem, total, groups, statusTrendRates(modelBuckets[catalogItem.modelName], modelStatusTrendPoints))
		items = append(items, item)
		modelsByProvider[item.ProviderID] = append(modelsByProvider[item.ProviderID], item)
		current := providerTotals[item.ProviderID]
		addStatusAccumulatorCounters(&current, total.counters, total.lastUpdated)
		providerTotals[item.ProviderID] = current
		if _, ok := providerCatalog[item.ProviderID]; !ok {
			providerCatalog[item.ProviderID] = modelStatusProviderCatalog{
				providerID:   item.ProviderID,
				providerName: item.ProviderName,
				vendorID:     item.VendorID,
			}
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ProviderName != items[j].ProviderName {
			return items[i].ProviderName < items[j].ProviderName
		}
		return items[i].ModelName < items[j].ModelName
	})

	providers := make([]ModelStatusProvider, 0, len(modelsByProvider))
	for providerID, models := range modelsByProvider {
		provider := buildModelStatusProvider(providerCatalog[providerID], providerTotals[providerID])
		provider.Models = models
		providers = append(providers, provider)
	}
	sort.Slice(providers, func(i, j int) bool {
		if providers[i].ProviderName != providers[j].ProviderName {
			return providers[i].ProviderName < providers[j].ProviderName
		}
		return providers[i].ProviderID < providers[j].ProviderID
	})

	return ModelStatusResponse{
		WindowHours: hours,
		GeneratedAt: endTs,
		LastUpdated: formatStatusTime(endTs),
		Providers:   providers,
		Models:      items,
	}, nil
}

func addModelStatusCounters(totals map[modelStatusKey]modelStatusAccumulator, key modelStatusKey, value counters, bucketTs int64) {
	if value.requestCount == 0 || key.modelName == "" || key.group == "" {
		return
	}
	current := totals[key]
	addStatusAccumulatorCounters(&current, value, bucketTs)
	totals[key] = current
}

func addStatusAccumulatorCounters(current *modelStatusAccumulator, value counters, bucketTs int64) {
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.totalLatencyMs += value.totalLatencyMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	mergeTtftBounds(&current.counters, value)
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	if bucketTs > current.lastUpdated {
		current.lastUpdated = bucketTs
	}
}

func mergeModelStatusGroupBucket(
	buckets map[modelStatusKey]map[int64]counters,
	key modelStatusKey,
	bucketTs int64,
	value counters,
) {
	if value.requestCount == 0 {
		return
	}
	if buckets[key] == nil {
		buckets[key] = map[int64]counters{}
	}
	current := buckets[key][bucketTs]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.totalLatencyMs += value.totalLatencyMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	mergeTtftBounds(&current, value)
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	buckets[key][bucketTs] = current
}

func buildModelStatusItem(catalogItem modelStatusCatalogItem, total modelStatusAccumulator, groups []ModelStatusGroup, trend []float64) ModelStatusItem {
	status := statusForCounters(total.counters)
	successRateValue := roundStatusMetric(successRate(total.counters))
	return ModelStatusItem{
		ProviderID:         catalogItem.providerID,
		ProviderName:       catalogItem.providerName,
		Provider:           catalogItem.providerName,
		VendorID:           catalogItem.vendorID,
		ChannelType:        0,
		ModelName:          catalogItem.modelName,
		Health:             status,
		Status:             status,
		HealthScore:        successRateValue,
		FastestTtftMs:      statusFastestTtft(total.counters),
		SlowestTtftMs:      statusSlowestTtft(total.counters),
		SuccessRate:        successRateValue,
		RequestCount:       total.requestCount,
		TtftSampleCount:    total.ttftCount,
		LastUpdated:        formatStatusTime(total.lastUpdated),
		RecentSuccessRates: trend,
		Groups:             groups,
	}
}

func buildModelStatusGroup(group string, total modelStatusAccumulator, trend []float64) ModelStatusGroup {
	status := statusForCounters(total.counters)
	successRateValue := roundStatusMetric(successRate(total.counters))
	return ModelStatusGroup{
		Group:              group,
		Health:             status,
		Status:             status,
		HealthScore:        successRateValue,
		FastestTtftMs:      statusFastestTtft(total.counters),
		SlowestTtftMs:      statusSlowestTtft(total.counters),
		SuccessRate:        successRateValue,
		RequestCount:       total.requestCount,
		TtftSampleCount:    total.ttftCount,
		LastUpdated:        formatStatusTime(total.lastUpdated),
		RecentSuccessRates: trend,
	}
}

func buildModelStatusProvider(catalog modelStatusProviderCatalog, total modelStatusAccumulator) ModelStatusProvider {
	status := statusForCounters(total.counters)
	successRateValue := roundStatusMetric(successRate(total.counters))
	return ModelStatusProvider{
		ProviderID:      catalog.providerID,
		ProviderName:    catalog.providerName,
		Provider:        catalog.providerName,
		VendorID:        catalog.vendorID,
		ChannelType:     0,
		Health:          status,
		Status:          status,
		HealthScore:     successRateValue,
		FastestTtftMs:   statusFastestTtft(total.counters),
		SlowestTtftMs:   statusSlowestTtft(total.counters),
		SuccessRate:     successRateValue,
		RequestCount:    total.requestCount,
		TtftSampleCount: total.ttftCount,
		LastUpdated:     formatStatusTime(total.lastUpdated),
		Models:          []ModelStatusItem{},
	}
}

func buildModelStatusCatalog(pricing []model.Pricing, vendors []model.PricingVendor, groups []string) []modelStatusCatalogItem {
	vendorNames := make(map[int]string, len(vendors))
	for _, vendor := range vendors {
		if vendor.ID <= 0 || vendor.Name == "" {
			continue
		}
		vendorNames[vendor.ID] = vendor.Name
	}

	allowedGroups := allowedGroupSet(groups)
	seenModels := make(map[string]struct{}, len(pricing))
	catalog := make([]modelStatusCatalogItem, 0, len(pricing))
	for _, item := range pricing {
		if item.ModelName == "" {
			continue
		}
		if _, ok := seenModels[item.ModelName]; ok {
			continue
		}
		statusGroups := modelStatusCatalogGroups(item.EnableGroup, allowedGroups)
		if allowedGroups != nil && len(statusGroups) == 0 {
			continue
		}
		providerName := vendorNames[item.VendorID]
		if providerName == "" {
			providerName = "Unknown"
		}
		seenModels[item.ModelName] = struct{}{}
		catalog = append(catalog, modelStatusCatalogItem{
			providerID:   modelStatusVendorID(item.VendorID),
			providerName: providerName,
			vendorID:     item.VendorID,
			modelName:    item.ModelName,
			groups:       statusGroups,
		})
	}
	sort.Slice(catalog, func(i, j int) bool {
		if catalog[i].providerName != catalog[j].providerName {
			return catalog[i].providerName < catalog[j].providerName
		}
		return catalog[i].modelName < catalog[j].modelName
	})
	return catalog
}

func modelStatusCatalogGroups(groups []string, allowedGroups map[string]struct{}) []string {
	seen := make(map[string]struct{}, len(groups))
	result := make([]string, 0, len(groups))
	for _, group := range groups {
		if group == "" {
			continue
		}
		if allowedGroups != nil && group != "all" {
			if _, ok := allowedGroups[group]; !ok {
				continue
			}
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		result = append(result, group)
	}
	sort.Strings(result)
	return result
}

func modelStatusVendorID(vendorID int) string {
	return fmt.Sprintf("vendor:%d", vendorID)
}

func statusFastestTtft(value counters) int64 {
	if value.ttftCount <= 0 {
		return 0
	}
	return value.fastestTtftMs
}

func statusSlowestTtft(value counters) int64 {
	if value.ttftCount <= 0 {
		return 0
	}
	return value.slowestTtftMs
}

func statusForCounters(value counters) string {
	if value.requestCount == 0 {
		return "unknown"
	}
	rate := successRate(value)
	if rate < 80 {
		return "down"
	}
	if rate < 97 {
		return "degraded"
	}
	return "healthy"
}

func roundStatusMetric(value float64) float64 {
	if !math.IsNaN(value) && !math.IsInf(value, 0) {
		return math.Round(value*100) / 100
	}
	return 0
}

// modelStatusTrendPoints caps the per-bucket success-rate series so the
// response stays small even for long windows at fine bucket granularity.
// Points are downsampled evenly across the requested window.
const modelStatusTrendPoints = 96

func statusTrendRates(buckets map[int64]counters, maxPoints int) []float64 {
	if len(buckets) == 0 || maxPoints <= 0 {
		return nil
	}
	timestamps := make([]int64, 0, len(buckets))
	for ts := range buckets {
		timestamps = append(timestamps, ts)
	}
	sort.Slice(timestamps, func(i, j int) bool {
		return timestamps[i] < timestamps[j]
	})

	rates := make([]float64, 0, len(timestamps))
	for _, ts := range timestamps {
		rates = append(rates, roundStatusMetric(successRate(buckets[ts])))
	}

	if len(rates) <= maxPoints {
		return rates
	}
	step := float64(len(rates)-1) / float64(maxPoints-1)
	out := make([]float64, 0, maxPoints)
	for i := 0; i < maxPoints; i++ {
		out = append(out, rates[int(math.Round(step*float64(i)))])
	}
	return out
}

func formatStatusTime(ts int64) string {
	if ts <= 0 {
		return ""
	}
	return time.Unix(ts, 0).UTC().Format(time.RFC3339)
}
