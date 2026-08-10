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
import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { statusDotClass, statusTextClass } from '../lib/status'
import type { ModelHealthStatus, ModelStatusItem } from '../types'

const STATUS_ORDER: ModelHealthStatus[] = [
  'healthy',
  'degraded',
  'down',
  'unknown',
]

function statusLabelKey(status: ModelHealthStatus): string {
  if (status === 'healthy') return 'Healthy'
  if (status === 'degraded') return 'Unstable'
  if (status === 'down') return 'Unavailable'
  return 'No data yet'
}

type VerdictLevel = 'ok' | 'warn' | 'bad' | 'unknown'

export function VerdictSummary(props: {
  items: ModelStatusItem[]
  activeStatus: string
  onStatusSelect: (status: string) => void
}) {
  const { t } = useTranslation()

  const counts = useMemo(() => {
    const result: Record<ModelHealthStatus, number> = {
      healthy: 0,
      degraded: 0,
      down: 0,
      unknown: 0,
    }
    for (const item of props.items) {
      result[item.status] += 1
    }
    return result
  }, [props.items])

  const averageRate = useMemo(() => {
    const known = props.items.filter((item) =>
      Number.isFinite(item.successRate)
    )
    if (known.length === 0) return Number.NaN
    const sum = known.reduce((total, item) => total + item.successRate, 0)
    return sum / known.length
  }, [props.items])

  let level: VerdictLevel = 'ok'
  let titleKey = 'All systems operational'
  if (props.items.length === 0 || counts.unknown === props.items.length) {
    level = 'unknown'
    titleKey = 'No data available'
  } else if (counts.down > 0) {
    level = 'bad'
    titleKey = '{{count}} models are unavailable'
  } else if (counts.degraded > 0) {
    level = 'warn'
    titleKey = 'Some models are unstable'
  }

  const total = props.items.length
  const distributionClass: Record<ModelHealthStatus, string> = {
    healthy: 'bg-success',
    degraded: 'bg-warning',
    down: 'bg-destructive',
    unknown: 'bg-muted-foreground/40',
  }

  return (
    <Card className='gap-0 rounded-lg py-0'>
      <CardContent className='px-0'>
        <div className='grid lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.4fr)]'>
          <div className='border-border/70 flex items-center gap-3.5 border-b p-4 sm:p-5 lg:border-r lg:border-b-0'>
            <div
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-full',
                level === 'ok' && 'bg-success/10 text-success',
                level === 'warn' && 'bg-warning/10 text-warning',
                level === 'bad' && 'bg-destructive/10 text-destructive',
                level === 'unknown' &&
                  'bg-muted text-muted-foreground ring-border ring-1'
              )}
              aria-hidden
            >
              {level === 'ok' && <CircleCheck className='size-5' />}
              {level === 'warn' && <TriangleAlert className='size-5' />}
              {level === 'bad' && <CircleX className='size-5' />}
              {level === 'unknown' && <CircleHelp className='size-5' />}
            </div>
            <div className='min-w-0'>
              <h2 className='truncate text-lg font-semibold tracking-tight'>
                {t(titleKey, { count: counts.down })}
              </h2>
              <p className='text-muted-foreground mt-0.5 text-sm'>
                {t('Overall 24h availability is {{rate}}', {
                  rate: Number.isFinite(averageRate)
                    ? `${averageRate.toFixed(1)}%`
                    : '—',
                })}
              </p>
            </div>
          </div>
          <div className='grid grid-cols-2 sm:grid-cols-4'>
            {STATUS_ORDER.map((status) => (
              <Button
                key={status}
                type='button'
                variant='ghost'
                aria-pressed={props.activeStatus === status}
                onClick={() => props.onStatusSelect(status)}
                className={cn(
                  'border-border/70 h-auto min-h-20 flex-col items-start gap-1 rounded-none border-r border-b px-4 py-3 shadow-none last:border-r-0 sm:border-b-0',
                  props.activeStatus === status &&
                    'bg-muted ring-ring ring-1 ring-inset'
                )}
              >
                <span
                  className={cn(
                    'font-mono text-2xl leading-none font-semibold tabular-nums',
                    statusTextClass(status)
                  )}
                >
                  {counts[status]}
                </span>
                <span className='text-muted-foreground flex items-center gap-1.5 text-xs font-normal'>
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 rounded-full',
                      statusDotClass(status)
                    )}
                  />
                  {t(statusLabelKey(status))}
                </span>
              </Button>
            ))}
          </div>
        </div>

        <div
          aria-hidden
          className='border-border/70 flex items-center gap-4 border-t px-4 py-3 sm:px-5'
        >
          <div className='bg-muted flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full'>
            {STATUS_ORDER.map((status) => {
              if (counts[status] === 0) return null
              return (
                <span
                  key={status}
                  className={cn('h-full', distributionClass[status])}
                  style={{ width: `${(counts[status] / total) * 100}%` }}
                />
              )
            })}
          </div>
          <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
            {t('{{count}} models', { count: total })}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
