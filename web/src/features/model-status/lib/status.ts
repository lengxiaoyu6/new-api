/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type {
  ModelHealthStatus,
  ModelStatusApiGroup,
  ModelStatusApiItem,
  ModelStatusApiProvider,
  ModelStatusGroupMetric,
  ModelStatusItem,
  ModelStatusSort,
  ProviderFilterOption,
} from '../types'

export const STATUS_FILTERS: Exclude<ModelHealthStatus, 'unknown'>[] = [
  'healthy',
  'degraded',
  'down',
]

/** Status label used on the public page. Keys must exist in the locale files. */
export function statusLabelKey(status: ModelHealthStatus): string {
  if (status === 'healthy') return 'Healthy'
  if (status === 'degraded') return 'Unstable'
  if (status === 'down') return 'Unavailable'
  return 'No data yet'
}

export function filterLabelKey(filter: string): string {
  if (filter === 'all') return 'All'
  return statusLabelKey(filter as ModelHealthStatus)
}

export function aggregateStatus(models: ModelStatusItem[]): ModelHealthStatus {
  const knownModels = models.filter((model) => model.status !== 'unknown')
  if (knownModels.length === 0) return 'unknown'
  if (knownModels.some((model) => model.status === 'down')) return 'down'
  if (knownModels.some((model) => model.status === 'degraded')) {
    return 'degraded'
  }
  return 'healthy'
}

export function getModelStatusLevel(
  healthScore: number,
  successRate: number
): ModelHealthStatus {
  if (!Number.isFinite(healthScore) || !Number.isFinite(successRate)) {
    return 'unknown'
  }
  if (healthScore < 60 || successRate < 80) return 'down'
  if (healthScore < 90 || successRate < 97) return 'degraded'
  return 'healthy'
}

function normalizeStatusMetric(
  value: number | null | undefined,
  requestCount: number
): number {
  if (requestCount <= 0) return Number.NaN
  return value ?? Number.NaN
}

function normalizeTrendRates(values: (number | null)[] | undefined): number[] {
  return (
    values?.map((value) =>
      value !== null && Number.isFinite(value) ? value : Number.NaN
    ) ?? []
  )
}

function normalizeModelStatusGroup(
  group: ModelStatusApiGroup
): ModelStatusGroupMetric {
  const requestCount = group.request_count ?? 0
  const healthScore = normalizeStatusMetric(group.health_score, requestCount)
  const successRate = normalizeStatusMetric(group.success_rate, requestCount)

  return {
    group: group.group,
    healthScore,
    fastestTtftMs: group.fastest_ttft_ms ?? Number.NaN,
    slowestTtftMs: group.slowest_ttft_ms ?? Number.NaN,
    successRate,
    requestCount,
    ttftSampleCount: group.ttft_sample_count,
    lastUpdated: group.last_updated,
    recentSuccessRates: normalizeTrendRates(group.recent_success_rates),
    status:
      group.status ??
      group.health ??
      getModelStatusLevel(healthScore, successRate),
  }
}

export function normalizeModelStatusItem(
  item: ModelStatusApiItem,
  provider?: Pick<
    ModelStatusApiProvider,
    'provider_id' | 'provider_name' | 'vendor_id'
  >
): ModelStatusItem {
  const providerName =
    item.provider_name ??
    provider?.provider_name ??
    item.provider ??
    item.owner_by ??
    'Unknown'
  const requestCount = item.request_count ?? 0
  const healthScore = normalizeStatusMetric(item.health_score, requestCount)
  const successRate = normalizeStatusMetric(item.success_rate, requestCount)

  return {
    providerId:
      item.provider_id ??
      provider?.provider_id ??
      `provider:${providerName.toLowerCase()}`,
    provider: providerName,
    vendorId: item.vendor_id ?? provider?.vendor_id,
    modelName: item.model_name,
    healthScore,
    fastestTtftMs: item.fastest_ttft_ms ?? Number.NaN,
    slowestTtftMs: item.slowest_ttft_ms ?? Number.NaN,
    successRate,
    requestCount,
    ttftSampleCount: item.ttft_sample_count,
    lastUpdated: item.last_updated,
    recentSuccessRates: normalizeTrendRates(item.recent_success_rates),
    groups:
      item.groups
        ?.filter((group) => group.group !== '')
        .map((group) => normalizeModelStatusGroup(group))
        .sort((a, b) => a.group.localeCompare(b.group)) ?? [],
    status:
      item.status ??
      item.health ??
      getModelStatusLevel(healthScore, successRate),
  }
}

export function buildProviderOptions(
  items: ModelStatusItem[]
): ProviderFilterOption[] {
  const providers = new Map<string, string>()
  for (const item of items) {
    if (!providers.has(item.providerId)) {
      providers.set(item.providerId, item.provider)
    }
  }

  return [...providers.entries()]
    .map<ProviderFilterOption>((entry) => ({
      providerId: entry[0],
      provider: entry[1],
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider))
}

export type ModelStatusFilters = {
  provider: string
  status: string
  keyword: string
  sort: ModelStatusSort
}

export function filterAndSortModels(
  items: ModelStatusItem[],
  filters: ModelStatusFilters
): ModelStatusItem[] {
  const keyword = filters.keyword.trim().toLowerCase()

  const filtered = items.filter((item) => {
    if (filters.provider !== 'all' && item.providerId !== filters.provider) {
      return false
    }
    if (filters.status !== 'all' && item.status !== filters.status) {
      return false
    }
    if (keyword === '') return true

    return (
      item.modelName.toLowerCase().includes(keyword) ||
      item.provider.toLowerCase().includes(keyword)
    )
  })

  return filtered.sort((a, b) => {
    if (filters.sort === 'name') {
      return a.modelName.localeCompare(b.modelName)
    }
    return (
      statusPriority(a.status) - statusPriority(b.status) ||
      a.modelName.localeCompare(b.modelName)
    )
  })
}

function statusPriority(status: ModelHealthStatus): number {
  if (status === 'down') return 0
  if (status === 'degraded') return 1
  if (status === 'unknown') return 2
  return 3
}

/** Semantic token classes — follow the active theme instead of fixed hues. */
export function statusTextClass(status: ModelHealthStatus): string {
  if (status === 'healthy') return 'text-success'
  if (status === 'degraded') return 'text-warning'
  if (status === 'down') return 'text-destructive'
  return 'text-muted-foreground'
}

export function statusDotClass(status: ModelHealthStatus): string {
  if (status === 'healthy') return 'bg-success'
  if (status === 'degraded') return 'bg-warning'
  if (status === 'down') return 'bg-destructive'
  return 'bg-muted-foreground'
}

export function statusBadgeClass(status: ModelHealthStatus): string {
  if (status === 'healthy') {
    return 'border-success/40 bg-success/10 text-success'
  }
  if (status === 'degraded') {
    return 'border-warning/40 bg-warning/10 text-warning'
  }
  if (status === 'down') {
    return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
  return 'border-border bg-muted/50 text-muted-foreground'
}

export function statusBarClass(status: ModelHealthStatus): string {
  if (status === 'healthy') return 'bg-success'
  if (status === 'degraded') return 'bg-warning'
  if (status === 'down') return 'bg-destructive'
  return 'bg-muted-foreground/40'
}
