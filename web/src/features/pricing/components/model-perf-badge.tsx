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
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  formatLatency,
  formatThroughput,
  getSuccessRateDotClass,
} from '@/features/performance-metrics/lib/format'
import type { SuccessRatePoint } from '@/features/performance-metrics/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export type ModelPerfBadgeData = {
  window_start?: number
  window_end?: number
  avg_latency_ms: number
  success_rate: number
  avg_tps: number
  recent_success_series?: SuccessRatePoint[]
}

export interface ModelPerfBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  perf: ModelPerfBadgeData | undefined
  variant?: 'default' | 'availability'
}

const STATUS_SAMPLE_LIMIT = 24

export const ModelPerfBadge = memo(function ModelPerfBadge(
  props: ModelPerfBadgeProps
) {
  const { t, i18n } = useTranslation()
  const latencyText = formatLatency(props.perf?.avg_latency_ms ?? 0)
  const throughputText = formatThroughput(props.perf?.avg_tps ?? 0).replace(
    ' t/s',
    't/s'
  )
  const successRate = props.perf?.success_rate
  const hasSuccessRate =
    successRate != null &&
    Number.isFinite(successRate) &&
    successRate >= 0 &&
    successRate <= 100
  const statusSamples = useMemo(
    () =>
      (props.perf?.recent_success_series ?? [])
        .filter(
          (point) =>
            Number.isFinite(point.ts) &&
            Number.isFinite(point.success_rate) &&
            point.success_rate >= 0 &&
            point.success_rate <= 100
        )
        .sort((a, b) => a.ts - b.ts)
        .slice(-STATUS_SAMPLE_LIMIT),
    [props.perf?.recent_success_series]
  )
  const statusLabel =
    statusSamples.length > 0
      ? t('Success rate')
      : t('No performance data available')

  if (props.variant === 'availability') {
    const sampleMap = new Map(
      statusSamples.map((sample) => [sample.ts, sample])
    )
    const windowEnd = props.perf?.window_end
    let samples: Array<SuccessRatePoint | undefined> = statusSamples
    if (windowEnd != null && Number.isFinite(windowEnd)) {
      const lastHour = Math.floor(windowEnd / 3600) * 3600
      samples = Array.from({ length: STATUS_SAMPLE_LIMIT }, (_, index) =>
        sampleMap.get(lastHour - (STATUS_SAMPLE_LIMIT - 1 - index) * 3600)
      )
    }
    const rate = hasSuccessRate ? successRate : Number.NaN
    const rateText = hasSuccessRate
      ? `${formatNumber(rate, toIntlLocale(i18n.resolvedLanguage || i18n.language))}%`
      : '—'
    return (
      <div
        className={cn('gateway-catalog-availability', props.className)}
        aria-label={t('Performance metrics for the last 24 hours')}
        title={t(
          'Success rate excludes business rejections and includes the current partial hour.'
        )}
      >
        <span
          role='img'
          aria-label={statusLabel}
          className='gateway-catalog-status-bars'
        >
          {samples.length > 0 ? (
            samples.map((sample, index) => (
              <span
                key={sample?.ts ?? index}
                aria-hidden
                title={
                  sample
                    ? `${formatNumber(sample.success_rate)}%`
                    : t('No performance data available')
                }
                className={cn(
                  'gateway-catalog-status-bar',
                  sample
                    ? getSuccessRateDotClass(sample.success_rate)
                    : 'bg-muted'
                )}
                style={
                  sample
                    ? { height: `${Math.max(20, sample.success_rate)}%` }
                    : undefined
                }
              />
            ))
          ) : (
            <span className='text-muted-foreground text-xs'>
              {t('No performance data available')}
            </span>
          )}
        </span>
        <span className='gateway-catalog-status-rate'>
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              getSuccessRateDotClass(rate)
            )}
          />
          {rateText}
        </span>
      </div>
    )
  }

  return (
    <div
      aria-label={t('Performance metrics for the last 24 hours')}
      className={cn(
        'flex w-full min-w-0 items-center justify-between gap-3',
        props.className
      )}
    >
      <dl className='flex min-w-0 items-start gap-5 text-xs tabular-nums'>
        <div className='w-24 shrink-0'>
          <dt
            title={t(
              'Success rate excludes business rejections and includes the current partial hour.'
            )}
            className='text-muted-foreground flex items-center justify-between gap-1 text-[11px] leading-4'
          >
            <span>{t('Status')}</span>
            <span className='font-mono'>
              {hasSuccessRate ? `${successRate.toFixed(2)}%` : '—'}
            </span>
          </dt>
          <dd
            role='img'
            aria-label={statusLabel}
            title={statusLabel}
            className='mt-1 flex h-3 w-24 items-center gap-px'
          >
            {statusSamples.length > 0 ? (
              statusSamples.map((sample) => (
                <span
                  key={sample.ts}
                  aria-hidden
                  className={cn(
                    'h-full w-[3px] shrink-0 rounded-xs',
                    getSuccessRateDotClass(sample.success_rate)
                  )}
                />
              ))
            ) : (
              <span className='text-muted-foreground'>—</span>
            )}
          </dd>
        </div>
        <div title={t('Average latency')} className='shrink-0'>
          <dt className='text-muted-foreground text-[11px] leading-4'>
            {t('Latency short')}
          </dt>
          <dd className='mt-1 font-mono whitespace-nowrap'>
            {latencyText === '—' ? '—s' : latencyText}
          </dd>
        </div>
        <div title={t('Throughput')} className='shrink-0'>
          <dt className='text-muted-foreground text-[11px] leading-4'>
            {t('Throughput short')}
          </dt>
          <dd className='mt-1 font-mono whitespace-nowrap'>
            {throughputText === '—' ? '—t/s' : throughputText}
          </dd>
        </div>
      </dl>
      {props.children}
    </div>
  )
})
