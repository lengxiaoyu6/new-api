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
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatLatency,
  formatUptimePct,
  getSuccessRateDotClass,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import { getModelStatus } from './api'
import type {
  ModelHealthStatus,
  ModelStatusApiItem,
  ModelStatusApiProvider,
  ModelStatusFilter,
  ModelStatusItem,
  ProviderStatusGroup,
} from './types'

const STATUS_FILTERS: ModelStatusFilter[] = [
  'all',
  'healthy',
  'degraded',
  'down',
]

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100
}

function formatHealth(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value)}%`
}

function statusLabelKey(status: ModelHealthStatus): string {
  if (status === 'healthy') return 'Healthy'
  if (status === 'degraded') return 'Degraded'
  if (status === 'down') return 'Down'
  return 'Unknown'
}

function filterLabelKey(filter: ModelStatusFilter): string {
  if (filter === 'all') return 'All'
  return statusLabelKey(filter)
}

function aggregateStatus(
  models: ModelStatusItem[]
): ModelHealthStatus {
  const knownModels = models.filter((model) => model.status !== 'unknown')
  if (knownModels.length === 0) return 'unknown'
  if (knownModels.some((model) => model.status === 'down')) return 'down'
  if (knownModels.some((model) => model.status === 'degraded')) {
    return 'degraded'
  }
  return 'healthy'
}

function getModelStatusLevel(
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

function normalizeModelStatusItem(
  item: ModelStatusApiItem,
  provider?: Pick<ModelStatusApiProvider, 'provider_id' | 'provider_name'>
): ModelStatusItem {
  const providerName =
    item.provider_name ??
    provider?.provider_name ??
    item.provider ??
    item.owner_by ??
    'Unknown'
  const healthScore = item.health_score ?? Number.NaN
  const successRate = item.success_rate ?? Number.NaN

  return {
    providerId:
      item.provider_id ??
      provider?.provider_id ??
      `provider:${providerName.toLowerCase()}`,
    provider: providerName,
    modelName: item.model_name,
    healthScore,
    fastestTtftMs: item.fastest_ttft_ms ?? Number.NaN,
    slowestTtftMs: item.slowest_ttft_ms ?? Number.NaN,
    successRate,
    requestCount: item.request_count ?? 0,
    ttftSampleCount: item.ttft_sample_count,
    lastUpdated: item.last_updated,
    status:
      item.status ??
      item.health ??
      getModelStatusLevel(healthScore, successRate),
  }
}

function healthTextClass(value: number): string {
  if (!Number.isFinite(value)) return 'text-muted-foreground'
  if (value >= 90) return 'text-emerald-600 dark:text-emerald-400'
  if (value >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function statusBadgeClass(status: ModelHealthStatus): string {
  if (status === 'healthy') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  if (status === 'degraded') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (status === 'unknown') {
    return 'border-muted-foreground/30 bg-muted/50 text-muted-foreground'
  }
  return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
}

function statusDotClass(status: ModelHealthStatus): string {
  if (status === 'healthy') return 'bg-emerald-500'
  if (status === 'degraded') return 'bg-amber-500'
  if (status === 'unknown') return 'bg-muted-foreground'
  return 'bg-red-500'
}

function buildProviderGroups(items: ModelStatusItem[]): ProviderStatusGroup[] {
  const groups = new Map<
    string,
    { provider: string; models: ModelStatusItem[] }
  >()

  for (const item of items) {
    const existing = groups.get(item.providerId)
    if (existing) {
      existing.models.push(item)
      continue
    }
    groups.set(item.providerId, { provider: item.provider, models: [item] })
  }

  return [...groups.entries()]
    .map<ProviderStatusGroup>((entry) => {
      const models = [...entry[1].models].sort((a, b) =>
        a.modelName.localeCompare(b.modelName)
      )
      const averageHealth = roundMetric(
        average(
          models
            .map((model) => model.healthScore)
            .filter((value) => Number.isFinite(value))
        )
      )
      const averageSuccessRate = roundMetric(
        average(
          models
            .map((model) => model.successRate)
            .filter((value) => Number.isFinite(value))
        )
      )

      return {
        providerId: entry[0],
        provider: entry[1].provider,
        models,
        averageHealth,
        averageSuccessRate,
        requestCount: models.reduce(
          (sum, model) => sum + model.requestCount,
          0
        ),
        status: aggregateStatus(models),
      }
    })
    .sort((a, b) => a.provider.localeCompare(b.provider))
}

function buildPageStats(items: ModelStatusItem[]) {
  const providers = new Set(items.map((item) => item.providerId))
  const averageHealth = roundMetric(
    average(
      items
        .map((item) => item.healthScore)
        .filter((value) => Number.isFinite(value))
    )
  )
  const averageSuccessRate = roundMetric(
    average(
      items
        .map((item) => item.successRate)
        .filter((value) => Number.isFinite(value))
    )
  )
  const requestCount = items.reduce(
    (sum, item) => sum + item.requestCount,
    0
  )

  return {
    providerCount: providers.size,
    modelCount: items.length,
    averageHealth,
    averageSuccessRate,
    requestCount,
  }
}

type ModelStatusContentProps = {
  items: ModelStatusItem[]
  isLoading?: boolean
  isError?: boolean
  isFetching?: boolean
  lastUpdated?: string | number
  onRefresh?: () => void
}

export function ModelStatus() {
  const modelStatusQuery = useQuery({
    queryKey: ['model-status', 24],
    queryFn: () => getModelStatus(24),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  })

  const items = useMemo(() => {
    const data = modelStatusQuery.data?.data
    if (!data) return []

    if (data.providers && data.providers.length > 0) {
      return data.providers.flatMap((provider) =>
        provider.models.map((item) => normalizeModelStatusItem(item, provider))
      )
    }

    return data.models?.map((item) => normalizeModelStatusItem(item)) ?? []
  }, [modelStatusQuery.data])

  const lastUpdated =
    modelStatusQuery.data?.data.last_updated ??
    modelStatusQuery.data?.data.generated_at

  return (
    <PublicLayout showMainContainer={false}>
      <ModelStatusContent
        items={items}
        isLoading={modelStatusQuery.isLoading}
        isError={modelStatusQuery.isError}
        isFetching={modelStatusQuery.isFetching}
        lastUpdated={lastUpdated}
        onRefresh={() => void modelStatusQuery.refetch()}
      />
    </PublicLayout>
  )
}

export function ModelStatusContent(props: ModelStatusContentProps) {
  const { i18n, t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ModelStatusFilter>('all')
  const items = props.items

  const pageStats = useMemo(() => buildPageStats(items), [items])

  const filteredItems = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()

    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false
      }
      if (keyword === '') return true

      return (
        item.provider.toLowerCase().includes(keyword) ||
        item.modelName.toLowerCase().includes(keyword)
      )
    })
  }, [items, searchQuery, statusFilter])

  const providerGroups = useMemo(
    () => buildProviderGroups(filteredItems),
    [filteredItems]
  )

  return (
    <main className='relative'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.10]'
        style={{
          background: [
            'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.72 0.18 250 / 80%) 0%, transparent 70%)',
            'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.65 0.15 200 / 60%) 0%, transparent 70%)',
            'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.70 0.12 280 / 40%) 0%, transparent 70%)',
          ].join(', '),
          maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, black 40%, transparent 100%)',
        }}
      />

      <PageTransition className='relative mx-auto w-full max-w-[1280px] space-y-6 px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
        <header className='flex flex-col gap-5 pt-5 sm:pt-10'>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div className='max-w-3xl'>
              <div className='mb-3 flex flex-wrap items-center gap-2'>
                <Badge variant='outline'>{t('Live metrics')}</Badge>
                <Badge variant='secondary'>{t('Auto refresh')}</Badge>
              </div>
              <h1 className='text-[clamp(2rem,5.5vw,3.5rem)] leading-[1.15] font-bold tracking-tight'>
                {t('Model Status')}
              </h1>
              <p className='text-muted-foreground/80 mt-3 text-sm sm:text-base'>
                {t(
                  'Monitor model availability and first-token performance by provider.'
                )}
              </p>
            </div>
            <div className='flex flex-col items-start gap-2 sm:items-end'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={props.onRefresh}
                disabled={!props.onRefresh || props.isFetching}
              >
                <RefreshCw
                  aria-hidden
                  className={cn('size-4', props.isFetching && 'animate-spin')}
                />
                {t('Refresh')}
              </Button>
              {props.lastUpdated && (
                <span className='text-muted-foreground text-xs'>
                  {t('Last updated:')}{' '}
                  {formatLastUpdated(props.lastUpdated, i18n.language)}
                </span>
              )}
            </div>
          </div>
        </header>

        {props.isLoading && <ModelStatusLoading />}
        {!props.isLoading && props.isError && (
          <ModelStatusError onRetry={props.onRefresh} />
        )}
        {!props.isLoading && !props.isError && (
          <>
            <section
              aria-label={t('Model status summary')}
              className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'
            >
              <SummaryCard
                label={t('Providers')}
                value={pageStats.providerCount}
              />
              <SummaryCard label={t('Models')} value={pageStats.modelCount} />
              <SummaryCard
                label={t('Requests')}
                value={pageStats.requestCount.toLocaleString()}
              />
              <SummaryCard
                label={t('Average health')}
                value={formatHealth(pageStats.averageHealth)}
                valueClassName={healthTextClass(pageStats.averageHealth)}
              />
              <SummaryCard
                label={t('Average success rate')}
                value={formatUptimePct(pageStats.averageSuccessRate)}
                valueClassName={getSuccessRateTextClass(
                  pageStats.averageSuccessRate
                )}
              />
            </section>

            <Card className='bg-card/80 backdrop-blur'>
              <CardContent className='space-y-4'>
                <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
                  <div>
                    <label className='sr-only' htmlFor='model-status-search'>
                      {t('Search model status')}
                    </label>
                    <Input
                      id='model-status-search'
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('Search provider or model...')}
                    />
                  </div>
                  <div
                    role='group'
                    aria-label={t('Health status filter')}
                    className='flex flex-wrap gap-2'
                  >
                    {STATUS_FILTERS.map((filter) => (
                      <Button
                        key={filter}
                        type='button'
                        size='sm'
                        variant={
                          statusFilter === filter ? 'default' : 'outline'
                        }
                        aria-pressed={statusFilter === filter}
                        onClick={() => setStatusFilter(filter)}
                      >
                        {t(filterLabelKey(filter))}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {providerGroups.length > 0 ? (
              <section className='space-y-4'>
                {providerGroups.map((group) => (
                  <ProviderCard key={group.providerId} group={group} />
                ))}
              </section>
            ) : (
              <Card className='bg-card/70 border-dashed'>
                <CardContent className='py-12 text-center'>
                  <h2 className='text-base font-semibold'>
                    {t('No model status matches the current filters')}
                  </h2>
                  <p className='text-muted-foreground mt-2 text-sm'>
                    {t('Adjust the search keyword or health status filter.')}
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </PageTransition>
    </main>
  )
}

function formatLastUpdated(value: string | number, language: string): string {
  const numericValue = Number(value)
  const date = new Date(
    Number.isFinite(numericValue) && numericValue < 1_000_000_000_000
      ? numericValue * 1000
      : value
  )
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function ModelStatusLoading() {
  const { t } = useTranslation()

  return (
    <div className='space-y-4' aria-label={t('Loading...')}>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
        {Array.from({ length: 5 }, (_, index) => (
          <Card key={index} className='bg-card/80'>
            <CardContent className='space-y-3'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-8 w-16' />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className='bg-card/80'>
        <CardContent className='space-y-4 py-6'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-24 w-full' />
        </CardContent>
      </Card>
    </div>
  )
}

function ModelStatusError(props: { onRetry?: () => void }) {
  const { t } = useTranslation()

  return (
    <Card className='border-destructive/30 bg-card/80'>
      <CardContent className='flex flex-col items-center gap-4 py-12 text-center'>
        <div className='text-destructive text-base font-semibold'>
          {t('Loading failed')}
        </div>
        <p className='text-muted-foreground max-w-md text-sm'>
          {t('Request failed')}
        </p>
        <Button
          type='button'
          variant='outline'
          onClick={props.onRetry}
          disabled={!props.onRetry}
        >
          {t('Refresh')}
        </Button>
      </CardContent>
    </Card>
  )
}

function SummaryCard(props: {
  label: string
  value: number | string
  valueClassName?: string
}) {
  return (
    <Card className='bg-card/80 backdrop-blur'>
      <CardContent>
        <div className='text-muted-foreground text-sm'>{props.label}</div>
        <div
          className={cn(
            'mt-2 text-2xl font-semibold tabular-nums',
            props.valueClassName
          )}
        >
          {props.value}
        </div>
      </CardContent>
    </Card>
  )
}

function ProviderCard(props: { group: ProviderStatusGroup }) {
  const { t } = useTranslation()

  return (
    <Card className='bg-card/80 backdrop-blur'>
      <CardHeader className='gap-3 sm:grid-cols-[1fr_auto]'>
        <div>
          <CardTitle className='flex flex-wrap items-center gap-2'>
            <span>{props.group.provider}</span>
            <StatusBadge status={props.group.status} />
          </CardTitle>
          <CardDescription>
            {t('{{count}} models monitored', {
              count: props.group.models.length,
            })}
          </CardDescription>
        </div>
        <div className='grid grid-cols-2 gap-3 text-right text-sm sm:min-w-64'>
          <ProviderMetric
            label={t('Average health')}
            value={formatHealth(props.group.averageHealth)}
            className={healthTextClass(props.group.averageHealth)}
          />
          <ProviderMetric
            label={t('Average success rate')}
            value={formatUptimePct(props.group.averageSuccessRate)}
            className={getSuccessRateTextClass(props.group.averageSuccessRate)}
          />
        </div>
      </CardHeader>

      <CardContent className='px-0'>
        <div className='text-muted-foreground hidden border-t px-4 py-2 text-xs font-medium md:grid md:grid-cols-[minmax(220px,1.4fr)_minmax(170px,1fr)_120px_120px_120px] md:items-center md:gap-4'>
          <div>{t('Model')}</div>
          <div>{t('Health score')}</div>
          <div className='text-right'>{t('Fastest first token')}</div>
          <div className='text-right'>{t('Slowest first token')}</div>
          <div className='text-right'>{t('Success rate')}</div>
        </div>
        <div className='divide-border divide-y border-t md:border-t-0'>
          {props.group.models.map((item) => (
            <ModelRow
              key={`${item.providerId}-${item.modelName}`}
              item={item}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ProviderMetric(props: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div className={cn('mt-1 font-semibold tabular-nums', props.className)}>
        {props.value}
      </div>
    </div>
  )
}

function ModelRow(props: { item: ModelStatusItem }) {
  const { t } = useTranslation()

  return (
    <article className='grid gap-3 px-4 py-4 md:grid-cols-[minmax(220px,1.4fr)_minmax(170px,1fr)_120px_120px_120px] md:items-center md:gap-4'>
      <div className='min-w-0'>
        <div className='text-foreground truncate font-medium'>
          {props.item.modelName}
        </div>
        <div className='mt-1 flex items-center gap-2'>
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              statusDotClass(props.item.status)
            )}
          />
          <span className='text-muted-foreground text-xs'>
            {t(statusLabelKey(props.item.status))}
          </span>
        </div>
      </div>

      <div className='space-y-2'>
        <div className='flex items-center justify-between gap-3 text-xs'>
          <span className='text-muted-foreground md:hidden'>
            {t('Health score')}
          </span>
          <span
            className={cn(
              'font-semibold tabular-nums md:ml-auto',
              healthTextClass(props.item.healthScore)
            )}
          >
            {formatHealth(props.item.healthScore)}
          </span>
        </div>
        <Progress
          value={
            Number.isFinite(props.item.healthScore)
              ? Math.max(0, Math.min(100, props.item.healthScore))
              : 0
          }
          aria-label={t('{{model}} health score', {
            model: props.item.modelName,
          })}
        />
      </div>

      <MetricBlock
        label={t('Fastest first token')}
        value={formatLatency(props.item.fastestTtftMs)}
      />
      <MetricBlock
        label={t('Slowest first token')}
        value={formatLatency(props.item.slowestTtftMs)}
      />
      <MetricBlock
        label={t('Success rate')}
        value={formatUptimePct(props.item.successRate)}
        className={getSuccessRateTextClass(props.item.successRate)}
        dotClassName={getSuccessRateDotClass(props.item.successRate)}
      />
    </article>
  )
}

function MetricBlock(props: {
  label: string
  value: string
  className?: string
  dotClassName?: string
}) {
  return (
    <div className='flex items-center justify-between gap-3 md:block md:text-right'>
      <span className='text-muted-foreground text-xs md:hidden'>
        {props.label}
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 font-mono text-sm tabular-nums',
          props.className
        )}
      >
        {props.dotClassName && (
          <span
            aria-hidden
            className={cn('size-1.5 rounded-full', props.dotClassName)}
          />
        )}
        {props.value}
      </span>
    </div>
  )
}

function StatusBadge(props: { status: ModelHealthStatus }) {
  const { t } = useTranslation()

  return (
    <Badge variant='outline' className={statusBadgeClass(props.status)}>
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', statusDotClass(props.status))}
      />
      {t(statusLabelKey(props.status))}
    </Badge>
  )
}
