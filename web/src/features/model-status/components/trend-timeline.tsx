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
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

const TREND_BAR_COUNT = 10
const TREND_INTERVAL_SECONDS = 30 * 60

type TrendInterval = {
  start: number
  end: number
}

type TrendBar = {
  key: string
  value: number
  interval?: TrendInterval
}

export function TrendTimeline(props: {
  values: number[]
  currentValue: number
  label: string
  emptyLabel: string
  trendEnd?: number
  compact?: boolean
}) {
  const { i18n, t } = useTranslation()
  const values = props.values.slice(-TREND_BAR_COUNT)
  const timelineValues = [
    ...Array.from(
      { length: TREND_BAR_COUNT - values.length },
      () => Number.NaN
    ),
    ...values,
  ]
  const hasData = timelineValues.some(Number.isFinite)
  const currentValue = Number.isFinite(props.currentValue)
    ? props.currentValue
    : timelineValues.findLast(Number.isFinite)
  const bars = buildTrendBars(
    timelineValues,
    buildTrendIntervals(props.trendEnd)
  )

  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center',
        props.compact ? 'gap-2' : 'gap-3'
      )}
    >
      <TooltipProvider delay={100}>
        <div
          role='img'
          aria-label={
            hasData
              ? `${props.label}: ${formatTrendRate(currentValue)}`
              : `${props.label}: ${props.emptyLabel}`
          }
          className={cn(
            'grid w-full max-w-[480px] min-w-0 flex-1 grid-cols-10 items-center overflow-hidden',
            props.compact ? 'gap-0.5' : 'gap-1',
            props.compact ? 'h-6' : 'h-8'
          )}
        >
          {bars.map((bar) => {
            const intervalLabel = formatTrendInterval(
              bar.interval,
              i18n.language
            )
            const rateLabel = Number.isFinite(bar.value)
              ? formatTrendRate(bar.value)
              : props.emptyLabel
            const tooltipLabel = [
              intervalLabel,
              `${t('Success rate')}: ${rateLabel}`,
            ]
              .filter(Boolean)
              .join('\n')

            return (
              <Tooltip key={bar.key}>
                <TooltipTrigger
                  render={
                    <span
                      data-trend-bar
                      data-has-requests={Number.isFinite(bar.value)}
                      title={tooltipLabel}
                      aria-hidden
                      className={cn(
                        'min-w-0 rounded-[2px] transition-opacity hover:opacity-70',
                        props.compact ? 'h-4' : 'h-6',
                        trendBarClass(bar.value)
                      )}
                    />
                  }
                />
                <TooltipContent side='top' className='font-mono text-xs'>
                  {intervalLabel && (
                    <div className='font-medium'>{intervalLabel}</div>
                  )}
                  <div>
                    {t('Success rate')}: {rateLabel}
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </TooltipProvider>
      <span
        className={cn(
          'w-14 shrink-0 text-right font-mono font-semibold tabular-nums',
          props.compact ? 'text-xs' : 'text-sm',
          trendTextClass(currentValue)
        )}
      >
        {formatTrendRate(currentValue)}
      </span>
    </div>
  )
}

function formatTrendRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function trendBarClass(value: number): string {
  if (!Number.isFinite(value)) return 'bg-muted-foreground/25'
  if (value >= 97) return 'bg-success'
  if (value >= 80) return 'bg-warning'
  return 'bg-destructive'
}

function buildTrendBars(
  values: number[],
  intervals: (TrendInterval | undefined)[]
): TrendBar[] {
  const occurrences = new Map<number, number>()

  return values.map((value, index) => {
    const occurrence = (occurrences.get(value) ?? 0) + 1
    occurrences.set(value, occurrence)
    return { key: `${value}-${occurrence}`, value, interval: intervals[index] }
  })
}

function buildTrendIntervals(trendEnd?: number): (TrendInterval | undefined)[] {
  if (!Number.isFinite(trendEnd) || trendEnd === undefined || trendEnd <= 0) {
    return Array.from({ length: TREND_BAR_COUNT }, () => undefined)
  }

  const endTimestamp = Math.floor(trendEnd)
  const currentIntervalStart =
    endTimestamp - (endTimestamp % TREND_INTERVAL_SECONDS)
  const firstIntervalStart =
    currentIntervalStart - (TREND_BAR_COUNT - 1) * TREND_INTERVAL_SECONDS

  return Array.from({ length: TREND_BAR_COUNT }, (_, index) => {
    const start = firstIntervalStart + index * TREND_INTERVAL_SECONDS
    return { start, end: start + TREND_INTERVAL_SECONDS }
  })
}

function formatTrendInterval(
  interval: TrendInterval | undefined,
  language: string
): string | undefined {
  if (!interval) return undefined

  const locale = toIntlLocale(language)
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
  })
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const start = new Date(interval.start * 1000)
  const end = new Date(interval.end * 1000)
  const startDate = dateFormatter.format(start)
  const endDate = dateFormatter.format(end)
  const startTime = formatTrendClock(timeFormatter.format(start))
  const endTime = formatTrendClock(timeFormatter.format(end))

  if (startDate === endDate) {
    return `${startDate} ${startTime}-${endTime}`
  }
  return `${startDate} ${startTime}-${endDate} ${endTime}`
}

function formatTrendClock(value: string): string {
  return value.replace(/^0(?=\d)/, '')
}

function trendTextClass(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'text-muted-foreground'
  }
  if (value >= 97) return 'text-success'
  if (value >= 80) return 'text-warning'
  return 'text-destructive'
}
