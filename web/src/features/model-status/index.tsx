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
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import { getModelStatus } from './api'
import { ModelList } from './components/model-list'
import { VerdictSummary } from './components/verdict-summary'
import {
  buildProviderOptions,
  filterAndSortModels,
  filterLabelKey,
  normalizeModelStatusItem,
  statusDotClass,
} from './lib/status'
import type { ModelStatusItem, ModelStatusSort } from './types'

const STATUS_TABS = ['all', 'healthy', 'degraded', 'down', 'unknown'] as const
const ALL_PROVIDERS_VALUE = 'all'

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
    modelStatusQuery.data?.data.last_updated ||
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
  const [statusFilter, setStatusFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState(ALL_PROVIDERS_VALUE)
  const [sort, setSort] = useState<ModelStatusSort>('status')
  const items = props.items

  const providerOptions = useMemo(() => buildProviderOptions(items), [items])
  const activeProviderFilter = providerOptions.some(
    (option) => option.providerId === providerFilter
  )
    ? providerFilter
    : ALL_PROVIDERS_VALUE

  const visibleItems = useMemo(
    () =>
      filterAndSortModels(items, {
        provider: activeProviderFilter,
        status: statusFilter,
        keyword: searchQuery,
        sort,
      }),
    [activeProviderFilter, items, searchQuery, sort, statusFilter]
  )

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    activeProviderFilter !== ALL_PROVIDERS_VALUE ||
    statusFilter !== 'all' ||
    sort !== 'status'

  const clearFilters = () => {
    setSearchQuery('')
    setProviderFilter(ALL_PROVIDERS_VALUE)
    setStatusFilter('all')
    setSort('status')
  }

  return (
    <main>
      <PageTransition>
        <header className='border-border/70 bg-muted/20 border-b'>
          <div className='mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-4 pt-24 pb-7 sm:px-6 sm:pt-28 sm:pb-8 lg:flex-row lg:items-end lg:justify-between xl:px-8'>
            <div className='max-w-3xl'>
              <div className='text-muted-foreground mb-2.5 flex items-center gap-2 text-xs font-medium'>
                <span
                  aria-hidden
                  className='bg-success ring-success/20 size-2 rounded-full ring-4'
                />
                <span>{t('Live metrics')}</span>
                <span aria-hidden>·</span>
                <span>{t('Past 24 hours')}</span>
              </div>
              <h1 className='text-3xl leading-tight font-semibold tracking-tight sm:text-4xl'>
                {t('Model Status')}
              </h1>
              <p className='text-muted-foreground mt-2 max-w-2xl text-sm leading-6 sm:text-base'>
                {t('Live 24h availability trends for all models.')}
              </p>
            </div>
            <div className='flex items-center gap-3 lg:justify-end'>
              <div className='text-muted-foreground min-w-0 text-xs lg:text-right'>
                <div className='text-foreground/80 font-medium'>
                  {t('Auto refresh')}
                </div>
                {props.lastUpdated && (
                  <div className='mt-0.5 truncate'>
                    {t('Last updated:')}{' '}
                    {formatLastUpdated(props.lastUpdated, i18n.language)}
                  </div>
                )}
              </div>
              <Button
                type='button'
                variant='outline'
                size='icon'
                onClick={props.onRefresh}
                disabled={!props.onRefresh || props.isFetching}
                aria-label={t('Refresh')}
                title={t('Refresh')}
              >
                <RefreshCw
                  aria-hidden
                  className={cn('size-4', props.isFetching && 'animate-spin')}
                />
              </Button>
            </div>
          </div>
        </header>

        <div className='mx-auto w-full max-w-[1280px] space-y-5 px-4 py-5 pb-10 sm:px-6 sm:py-6 sm:pb-12 xl:px-8'>
          {props.isLoading && <ModelStatusLoading />}
          {!props.isLoading && props.isError && (
            <ModelStatusError onRetry={props.onRefresh} />
          )}
          {!props.isLoading && !props.isError && (
            <>
              <VerdictSummary
                items={items}
                activeStatus={statusFilter}
                onStatusSelect={(status) =>
                  setStatusFilter((current) =>
                    current === status ? 'all' : status
                  )
                }
              />

              <Card size='sm' className='rounded-lg'>
                <CardContent>
                  <div
                    role='search'
                    aria-label={t('Search model status')}
                    className='grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_180px_180px_minmax(420px,auto)]'
                  >
                    <div className='relative'>
                      <label className='sr-only' htmlFor='model-status-search'>
                        {t('Search model name...')}
                      </label>
                      <Search
                        aria-hidden
                        className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
                      />
                      <Input
                        id='model-status-search'
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={t('Search model name...')}
                        className='pr-8 pl-8'
                      />
                      {searchQuery !== '' && (
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon-xs'
                          onClick={() => setSearchQuery('')}
                          className='absolute top-1/2 right-1 -translate-y-1/2'
                          aria-label={t('Clear search')}
                        >
                          <X aria-hidden className='size-3.5' />
                        </Button>
                      )}
                    </div>
                    <div>
                      <label
                        className='sr-only'
                        htmlFor='model-status-provider'
                      >
                        {t('Provider')}
                      </label>
                      <NativeSelect
                        id='model-status-provider'
                        className='w-full'
                        value={activeProviderFilter}
                        onChange={(event) =>
                          setProviderFilter(event.target.value)
                        }
                        aria-label={t('Provider')}
                      >
                        <NativeSelectOption value={ALL_PROVIDERS_VALUE}>
                          {t('All providers')}
                        </NativeSelectOption>
                        {providerOptions.map((option) => (
                          <NativeSelectOption
                            key={option.providerId}
                            value={option.providerId}
                          >
                            {option.provider}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                    <div>
                      <label className='sr-only' htmlFor='model-status-sort'>
                        {t('Sort')}
                      </label>
                      <NativeSelect
                        id='model-status-sort'
                        className='w-full'
                        value={sort}
                        onChange={(event) =>
                          setSort(event.target.value as ModelStatusSort)
                        }
                        aria-label={t('Sort')}
                      >
                        <NativeSelectOption value='status'>
                          {t('Sort by status')}
                        </NativeSelectOption>
                        <NativeSelectOption value='name'>
                          {t('Sort by name')}
                        </NativeSelectOption>
                      </NativeSelect>
                    </div>
                    <div
                      role='group'
                      aria-label={t('Status')}
                      className='bg-muted/70 flex min-w-0 gap-1 overflow-x-auto rounded-lg p-0.5'
                    >
                      {STATUS_TABS.map((filter) => (
                        <Button
                          key={filter}
                          type='button'
                          size='sm'
                          variant={
                            statusFilter === filter ? 'outline' : 'ghost'
                          }
                          aria-pressed={statusFilter === filter}
                          onClick={() => setStatusFilter(filter)}
                          className={cn(
                            'min-w-max flex-1 gap-1.5 px-2 shadow-none',
                            statusFilter === filter && 'bg-background'
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'size-1.5 rounded-full',
                              filter === 'all'
                                ? 'bg-primary'
                                : statusDotClass(filter)
                            )}
                          />
                          {t(filterLabelKey(filter))}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className='border-border/70 mt-3 flex min-h-7 items-center justify-between gap-3 border-t pt-3'>
                    <div
                      className='text-muted-foreground text-xs'
                      aria-live='polite'
                    >
                      <span className='text-foreground font-semibold tabular-nums'>
                        {visibleItems.length}
                      </span>{' '}
                      / {items.length} {t('models')}
                    </div>
                    {hasActiveFilters && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={clearFilters}
                      >
                        <X aria-hidden className='size-3.5' />
                        {t('Clear filters')}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {visibleItems.length > 0 ? (
                <ModelList items={visibleItems} />
              ) : (
                <Card className='rounded-lg border-dashed'>
                  <CardContent className='py-12 text-center'>
                    <h2 className='text-base font-semibold'>
                      {t('No matching models')}
                    </h2>
                    <p className='text-muted-foreground mt-2 text-sm'>
                      {t('Try a different keyword or clear the filters.')}
                    </p>
                    {hasActiveFilters && (
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={clearFilters}
                        className='mt-4'
                      >
                        {t('Clear filters')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
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

  return new Intl.DateTimeFormat(toIntlLocale(language), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function ModelStatusLoading() {
  const { t } = useTranslation()

  return (
    <div className='space-y-4' aria-label={t('Loading...')}>
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
