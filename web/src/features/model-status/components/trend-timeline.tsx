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
import { cn } from '@/lib/utils'

const MAX_TREND_BARS = 96

export function TrendTimeline(props: {
  values: number[]
  currentValue: number
  label: string
  emptyLabel: string
  compact?: boolean
}) {
  const values = props.values.slice(-MAX_TREND_BARS)
  const hasData = values.some(Number.isFinite)
  const currentValue = Number.isFinite(props.currentValue)
    ? props.currentValue
    : values.findLast(Number.isFinite)
  const timelineValues = hasData
    ? values
    : Array.from({ length: MAX_TREND_BARS }, () => Number.NaN)
  const bars = buildTrendBars(timelineValues)
  const timelineWidth = Math.min(bars.length * (props.compact ? 4 : 5), 480)

  return (
    <div
      className={cn(
        'flex min-w-0 items-center',
        props.compact ? 'gap-2' : 'gap-3'
      )}
    >
      <div
        role='img'
        aria-label={
          hasData
            ? `${props.label}: ${formatTrendRate(currentValue)}`
            : `${props.label}: ${props.emptyLabel}`
        }
        className={cn(
          'flex max-w-full min-w-0 shrink items-center gap-px overflow-hidden',
          props.compact ? 'h-6' : 'h-8'
        )}
        style={{ width: `${timelineWidth}px` }}
      >
        {bars.map((bar) => (
          <span
            key={bar.key}
            title={
              Number.isFinite(bar.value)
                ? formatTrendRate(bar.value)
                : props.emptyLabel
            }
            aria-hidden
            className={cn(
              'min-w-[1px] flex-1 rounded-[1px] transition-opacity hover:opacity-70',
              props.compact ? 'h-4 max-w-[3px]' : 'h-6 max-w-1',
              trendBarClass(bar.value)
            )}
          />
        ))}
      </div>
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

function buildTrendBars(values: number[]): { key: string; value: number }[] {
  const occurrences = new Map<number, number>()

  return values.map((value) => {
    const occurrence = (occurrences.get(value) ?? 0) + 1
    occurrences.set(value, occurrence)
    return { key: `${value}-${occurrence}`, value }
  })
}

function trendTextClass(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'text-muted-foreground'
  }
  if (value >= 97) return 'text-success'
  if (value >= 80) return 'text-warning'
  return 'text-destructive'
}
