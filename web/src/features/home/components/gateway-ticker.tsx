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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { PricingModel } from '@/features/pricing/types'
import { getLobeIcon } from '@/lib/lobe-icon'

export function GatewayTicker(props: { models: PricingModel[] }) {
  const { t } = useTranslation()
  const [paused, setPaused] = useState(false)
  if (props.models.length === 0) return null

  return (
    <section className='gateway-ticker' aria-label={t('Model ticker')}>
      <div className='gateway-ticker-window' data-paused={paused}>
        <div className='gateway-ticker-track'>
          {[false, true].map((duplicate) => (
            <ul
              key={String(duplicate)}
              className='gateway-ticker-list'
              aria-hidden={duplicate || undefined}
            >
              {props.models.slice(0, 12).map((model) => (
                <li key={model.model_name} className='gateway-ticker-chip'>
                  <span aria-hidden='true'>
                    {getLobeIcon(model.icon || model.vendor_icon || '', 14)}
                  </span>
                  <span className='max-w-52 truncate font-mono text-[11px]'>
                    {model.model_name}
                  </span>
                </li>
              ))}
            </ul>
          ))}
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
