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
import { Pause, Play } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getLobeIcon } from '@/lib/lobe-icon'

import type { HomeCatalogModel } from '../types'

export function GatewayTicker(props: {
  models: HomeCatalogModel[]
  loading?: boolean
}) {
  const { t } = useTranslation()
  const [paused, setPaused] = useState(false)
  const windowRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const models = useMemo(() => {
    const seen = new Set<string>()
    return props.models.filter((model) => {
      if (seen.has(model.model_name)) return false
      seen.add(model.model_name)
      return true
    })
  }, [props.models])

  useLayoutEffect(() => {
    const viewport = windowRef.current
    const list = listRef.current
    if (!viewport || !list || props.loading) return

    const measure = () => {
      const items = [...list.querySelectorAll('li')].map((item) => ({
        item,
        offset: item.offsetLeft,
        width: item.getBoundingClientRect().width,
      }))
      if (items.length === 0) return
      const widest = Math.max(...items.map((item) => item.width))
      const cycleWidth = Math.max(
        list.getBoundingClientRect().width,
        viewport.getBoundingClientRect().width + widest
      )
      if (cycleWidth <= 0) return

      // Each chip wraps outside the viewport; no second copy is rendered.
      list.style.setProperty('--gateway-ticker-cycle-width', `${cycleWidth}px`)
      list.style.setProperty('--gateway-ticker-duration', `${cycleWidth / 32}s`)
      for (const entry of items) {
        entry.item.style.setProperty(
          '--gateway-ticker-item-offset',
          `${entry.offset}px`
        )
        entry.item.style.setProperty(
          '--gateway-ticker-item-width',
          `${entry.width}px`
        )
        entry.item.style.setProperty(
          '--gateway-ticker-item-delay',
          `${-(cycleWidth - entry.offset - entry.width) / 32}s`
        )
      }
      list.dataset.ready = 'true'
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(list)
    return () => observer.disconnect()
  }, [models, props.loading])

  if (props.loading) {
    return (
      <section
        className='gateway-ticker'
        aria-label={t('Model ticker')}
        aria-busy='true'
      >
        <div className='gateway-ticker-window' aria-hidden='true'>
          <div className='flex w-max gap-3'>
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton
                key={index}
                className='h-8 w-36 rounded-full motion-reduce:animate-none'
              />
            ))}
          </div>
        </div>
        <Skeleton
          className='mr-2 size-8 shrink-0 motion-reduce:animate-none'
          aria-hidden='true'
        />
      </section>
    )
  }
  if (models.length === 0) return null

  return (
    <section
      className='gateway-ticker'
      aria-label={t('Model ticker')}
      aria-busy={false}
    >
      <div
        ref={windowRef}
        className='gateway-ticker-window'
        data-paused={paused}
      >
        <div className='gateway-ticker-track'>
          <ul ref={listRef} className='gateway-ticker-list'>
            {models.map((model) => (
              <li key={model.model_name} className='gateway-ticker-chip'>
                <span aria-hidden='true'>
                  {getLobeIcon(model.icon || '', 14)}
                </span>
                <span className='font-mono text-[11px] whitespace-nowrap'>
                  {model.model_name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Button
        variant='ghost'
        size='icon'
        className='gateway-ticker-control size-8'
        onClick={() => setPaused((value) => !value)}
        aria-label={paused ? t('Resume model ticker') : t('Pause model ticker')}
        aria-pressed={paused}
      >
        {paused ? (
          <Play className='size-3.5' aria-hidden='true' />
        ) : (
          <Pause className='size-3.5' aria-hidden='true' />
        )}
      </Button>
    </section>
  )
}
