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
  const timelineWidth = Math.min(bars.length * 5, 480)

  return (
    <div className='flex min-w-0 items-center gap-3'>
      <div
        role='img'
        aria-label={
          hasData
            ? `${props.label}: ${formatTrendRate(currentValue)}`
            : `${props.label}: ${props.emptyLabel}`
        }
        className='flex h-8 max-w-full min-w-0 shrink items-center gap-px overflow-hidden'
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
              'h-6 min-w-[1px] max-w-1 flex-1 rounded-[1px] transition-opacity hover:opacity-70',
              trendBarClass(bar.value)
            )}
          />
        ))}
      </div>
      <span
        className={cn(
          'w-14 shrink-0 text-right font-mono text-sm font-semibold tabular-nums',
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
