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
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'

import { useHomeCatalog } from '../hooks/use-home-catalog'
import { GatewayModelNetwork } from './gateway-model-network'
import { GatewaySections } from './gateway-sections'
import { GatewayTicker } from './gateway-ticker'
import { HeroButtons } from './hero-buttons'

export function GatewayLanding(props: { isAuthenticated: boolean }) {
  const { t } = useTranslation()
  const { systemName, logo } = useSystemConfig()
  const { status } = useStatus()
  const catalog = useHomeCatalog(props.isAuthenticated)
  const serverAddress =
    (typeof status?.server_address === 'string' &&
      status.server_address.trim()) ||
    window.location.origin
  const baseUrl = serverAddress.replace(/\/+$/, '').replace(/\/v1$/, '')

  return (
    <main id='content'>
      <section className='gateway-hero' aria-labelledby='gateway-title'>
        <div className='gateway-grid-decoration' aria-hidden='true' />
        <div className='gateway-container gateway-hero-grid'>
          <div className='gateway-entrance min-w-0'>
            <span className='gateway-badge'>
              <Sparkles className='size-3' aria-hidden='true' />
              {t('One key. A world of models.')}
            </span>
            <h1 id='gateway-title' className='gateway-title'>
              {systemName}
              <span>{t('Every model. One API.')}</span>
            </h1>
            <p className='text-muted-foreground mt-5 max-w-md text-sm leading-7'>
              {t(
                'Bring AI models together through one gateway. Connect familiar tools and build with the API that fits.'
              )}
            </p>
            <div className='gateway-actions mt-6 flex flex-wrap gap-3'>
              <HeroButtons
                isAuthenticated={props.isAuthenticated}
                secondaryAction='pricing'
              />
            </div>
          </div>
          <div className='gateway-entrance gateway-entrance-delayed min-w-0'>
            <GatewayModelNetwork
              vendors={catalog.vendors}
              loading={catalog.loading}
              systemName={systemName}
              logo={logo}
            />
          </div>
        </div>
        <Link to='/pricing' className='gateway-scroll'>
          <ArrowUpRight className='size-3.5' aria-hidden='true' />
          {t('Explore models')}
        </Link>
      </section>
      <GatewayTicker models={catalog.models} loading={catalog.loading} />
      <GatewaySections
        isAuthenticated={props.isAuthenticated}
        baseUrl={baseUrl}
      />
    </main>
  )
}
