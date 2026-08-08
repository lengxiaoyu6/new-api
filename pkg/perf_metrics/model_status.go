package perfmetrics

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/constant"
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
	ProviderID      string  `json:"provider_id"`
	ProviderName    string  `json:"provider_name"`
	Provider        string  `json:"provider"`
	ChannelType     int     `json:"channel_type"`
	ModelName       string  `json:"model_name"`
	Health          string  `json:"health"`
	Status          string  `json:"status"`
	HealthScore     float64 `json:"health_score"`
	FastestTtftMs   int64   `json:"fastest_ttft_ms"`
	SlowestTtftMs   int64   `json:"slowest_ttft_ms"`
	SuccessRate     float64 `json:"success_rate"`
	RequestCount    int64   `json:"request_count"`
	TtftSampleCount int64   `json:"ttft_sample_count"`
	LastUpdated     string  `json:"last_updated"`
}

type modelStatusKey struct {
	channelType int
	modelName   string
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

	modelTotals := make(map[modelStatusKey]modelStatusAccumulator)
	providerTotals := make(map[int]modelStatusAccumulator)
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
		addModelStatusCounters(modelTotals, modelStatusKey{channelType: row.ChannelType, modelName: row.ModelName}, value, row.BucketTs)
		addProviderStatusCounters(providerTotals, row.ChannelType, value, row.BucketTs)
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
		addModelStatusCounters(modelTotals, modelStatusKey{channelType: k.channelType, modelName: k.model}, snapshot, k.bucketTs)
		addProviderStatusCounters(providerTotals, k.channelType, snapshot, k.bucketTs)
		return true
	})

	items := make([]ModelStatusItem, 0, len(modelTotals))
	latestBucketTs := int64(0)
	for key, total := range modelTotals {
		if total.requestCount == 0 {
			continue
		}
		if total.lastUpdated > latestBucketTs {
			latestBucketTs = total.lastUpdated
		}
		items = append(items, buildModelStatusItem(key.channelType, key.modelName, total))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ProviderName != items[j].ProviderName {
			return items[i].ProviderName < items[j].ProviderName
		}
		if items[i].ChannelType != items[j].ChannelType {
			return items[i].ChannelType < items[j].ChannelType
		}
		return items[i].ModelName < items[j].ModelName
	})

	modelsByProvider := make(map[int][]ModelStatusItem)
	for _, item := range items {
		modelsByProvider[item.ChannelType] = append(modelsByProvider[item.ChannelType], item)
	}

	providers := make([]ModelStatusProvider, 0, len(providerTotals))
	for channelType, total := range providerTotals {
		if total.requestCount == 0 {
			continue
		}
		provider := buildModelStatusProvider(channelType, total)
		provider.Models = modelsByProvider[channelType]
		providers = append(providers, provider)
	}
	sort.Slice(providers, func(i, j int) bool {
		if providers[i].ProviderName != providers[j].ProviderName {
			return providers[i].ProviderName < providers[j].ProviderName
		}
		return providers[i].ChannelType < providers[j].ChannelType
	})

	return ModelStatusResponse{
		WindowHours: hours,
		GeneratedAt: endTs,
		LastUpdated: formatStatusTime(latestBucketTs),
		Providers:   providers,
		Models:      items,
	}, nil
}

func addModelStatusCounters(totals map[modelStatusKey]modelStatusAccumulator, key modelStatusKey, value counters, bucketTs int64) {
	if value.requestCount == 0 || key.modelName == "" {
		return
	}
	current := totals[key]
	addStatusAccumulatorCounters(&current, value, bucketTs)
	totals[key] = current
}

func addProviderStatusCounters(totals map[int]modelStatusAccumulator, channelType int, value counters, bucketTs int64) {
	if value.requestCount == 0 {
		return
	}
	current := totals[channelType]
	addStatusAccumulatorCounters(&current, value, bucketTs)
	totals[channelType] = current
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

func buildModelStatusItem(channelType int, modelName string, total modelStatusAccumulator) ModelStatusItem {
	providerName := constant.GetChannelTypeName(channelType)
	status := statusForCounters(total.counters)
	successRateValue := roundStatusMetric(successRate(total.counters))
	return ModelStatusItem{
		ProviderID:      modelStatusProviderID(channelType),
		ProviderName:    providerName,
		Provider:        providerName,
		ChannelType:     channelType,
		ModelName:       modelName,
		Health:          status,
		Status:          status,
		HealthScore:     successRateValue,
		FastestTtftMs:   statusFastestTtft(total.counters),
		SlowestTtftMs:   statusSlowestTtft(total.counters),
		SuccessRate:     successRateValue,
		RequestCount:    total.requestCount,
		TtftSampleCount: total.ttftCount,
		LastUpdated:     formatStatusTime(total.lastUpdated),
	}
}

func buildModelStatusProvider(channelType int, total modelStatusAccumulator) ModelStatusProvider {
	providerName := constant.GetChannelTypeName(channelType)
	status := statusForCounters(total.counters)
	successRateValue := roundStatusMetric(successRate(total.counters))
	return ModelStatusProvider{
		ProviderID:      modelStatusProviderID(channelType),
		ProviderName:    providerName,
		Provider:        providerName,
		ChannelType:     channelType,
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

func modelStatusProviderID(channelType int) string {
	return fmt.Sprintf("channel:%d", channelType)
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

func formatStatusTime(ts int64) string {
	if ts <= 0 {
		return ""
	}
	return time.Unix(ts, 0).UTC().Format(time.RFC3339)
}
