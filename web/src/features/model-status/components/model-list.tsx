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

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import type { ModelStatusItem } from '../types'
import { TrendTimeline } from './trend-timeline'

const MODEL_STATUS_GRID = 'lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]'

export function ModelList(props: { items: ModelStatusItem[] }) {
  const { t } = useTranslation()

  if (props.items.length === 0) return null

  const groups = new Map<
    string,
    { providerId: string; provider: string; items: ModelStatusItem[] }
  >()
  for (const item of props.items) {
    const group = groups.get(item.providerId)
    if (group) {
      group.items.push(item)
      continue
    }
    groups.set(item.providerId, {
      providerId: item.providerId,
      provider: item.provider,
      items: [item],
    })
  }
  const providerGroups = [...groups.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider)
  )

  return (
    <Card className='gap-0 rounded-lg py-0'>
      <div
        className={cn(
          'text-muted-foreground bg-muted/30 border-border/70 hidden border-b px-4 py-2.5 text-xs font-medium lg:grid lg:items-center lg:gap-4',
          MODEL_STATUS_GRID
        )}
      >
        <div>{t('Model')}</div>
        <div>{t('24h trend')}</div>
      </div>
      <div className='divide-border divide-y'>
        {providerGroups.map((group) => (
          <section
            key={group.providerId}
            data-provider-group={group.providerId}
            aria-label={group.provider}
          >
            <div className='bg-muted/20 border-border/70 flex items-center gap-2 border-b px-4 py-2.5'>
              <span
                aria-hidden
                className='bg-background text-muted-foreground ring-border grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold uppercase ring-1'
              >
                {group.provider.trim().charAt(0) || '?'}
              </span>
              <h2 className='truncate text-sm font-semibold'>
                {group.provider}
              </h2>
              <span className='text-muted-foreground ml-auto shrink-0 text-xs tabular-nums'>
                {t('{{count}} models', { count: group.items.length })}
              </span>
            </div>
            <div className='divide-border divide-y'>
              {group.items.map((item) => (
                <ModelRow
                  key={`${item.providerId}-${item.modelName}`}
                  item={item}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Card>
  )
}

function ModelRow(props: { item: ModelStatusItem }) {
  const { t } = useTranslation()

  return (
    <article
      className='hover:bg-muted/25 px-4 py-3.5 transition-colors sm:pl-6'
      data-status={props.item.status}
      data-model={props.item.modelName}
    >
      <div
        className={cn(
          'grid gap-4 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)] lg:items-center'
        )}
      >
        <div className='flex min-w-0 items-center gap-3'>
          <div
            aria-hidden
            className='bg-muted text-muted-foreground ring-border grid size-8 shrink-0 place-items-center rounded-md text-xs font-semibold uppercase ring-1'
          >
            {props.item.modelName.trim().charAt(0) || '?'}
          </div>
          <div className='min-w-0'>
            <div
              className='text-foreground truncate font-mono text-sm font-semibold'
              title={props.item.modelName}
            >
              {props.item.modelName}
            </div>
          </div>
        </div>
        <TrendTimeline
          values={props.item.recentSuccessRates}
          currentValue={props.item.successRate}
          label={t('24h trend')}
          emptyLabel={t('No data yet')}
        />
        {props.item.status === 'unknown' && (
          <span className='sr-only'>{t('This model has no data yet')}</span>
        )}
      </div>
    </article>
  )
}
