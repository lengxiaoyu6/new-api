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
import { Network } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getLobeIcon } from '@/lib/lobe-icon'

import type { HomeCatalogVendor } from '../types'

interface GatewayModelNetworkProps {
  vendors: HomeCatalogVendor[]
  loading?: boolean
  systemName: string
  logo: string
}

export function GatewayModelNetwork(props: GatewayModelNetworkProps) {
  const { t } = useTranslation()
  const visibleVendors = props.vendors.slice(0, 8)
  const nodes = visibleVendors.map((vendor, index) => {
    const angle =
      (index / visibleVendors.length) * Math.PI * 2 +
      (visibleVendors.length === 2 ? Math.PI : -Math.PI * 0.75)
    return {
      vendor,
      x: 50 + Math.cos(angle) * 34,
      y: 48 + Math.sin(angle) * 34,
    }
  })
  return (
    <section
      className='gateway-network'
      aria-label={t('Model network')}
      aria-busy={props.loading}
    >
      <div className='gateway-network-map'>
        <div className='gateway-network-orbit' aria-hidden='true' />
        <svg
          className='gateway-network-lines'
          viewBox='0 0 480 300'
          preserveAspectRatio='none'
          fill='none'
          aria-hidden='true'
        >
          {nodes.map((node) => (
            <g key={node.vendor.id}>
              <path
                d={`M 240 144 Q ${node.x * 4.8} 144 ${node.x * 4.8} ${node.y * 3}`}
                pathLength='100'
              />
              <path
                className='gateway-network-beam'
                d={`M 240 144 Q ${node.x * 4.8} 144 ${node.x * 4.8} ${node.y * 3}`}
                pathLength='100'
              />
            </g>
          ))}
        </svg>
        <div className='gateway-network-hub'>
          <div className='gateway-network-logo'>
            {props.logo ? (
              <img src={props.logo} alt='' />
            ) : (
              <Network className='size-8' aria-hidden='true' />
            )}
          </div>
          <span title={props.systemName}>{props.systemName}</span>
          <small>{t('One API')}</small>
        </div>
        {props.loading && (
          <ul className='gateway-network-nodes' aria-hidden='true'>
            {Array.from({ length: 8 }, (_, index) => {
              const angle = (index / 8) * Math.PI * 2 - Math.PI * 0.75
              return (
                <li
                  key={index}
                  style={
                    {
                      '--node-x': `${50 + Math.cos(angle) * 34}%`,
                      '--node-y': `${48 + Math.sin(angle) * 34}%`,
                    } as CSSProperties
                  }
                >
                  <div className='gateway-network-node'>
                    <Skeleton className='size-[46px] rounded-[14px] motion-reduce:animate-none' />
                    <Skeleton className='h-3 w-14 motion-reduce:animate-none' />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {nodes.length > 0 && (
          <ul aria-label={t('Vendors')} className='gateway-network-nodes'>
            {nodes.map((node) => (
              <li
                key={node.vendor.id}
                style={
                  {
                    '--node-x': `${node.x}%`,
                    '--node-y': `${node.y}%`,
                  } as CSSProperties
                }
              >
                <Button
                  variant='ghost'
                  role='link'
                  className='gateway-network-node'
                  aria-label={node.vendor.name}
                  render={
                    <Link to='/pricing' search={{ vendor: node.vendor.name }} />
                  }
                >
                  <span className='gateway-network-icon' aria-hidden='true'>
                    {getLobeIcon(node.vendor.icon || node.vendor.name, 26)}
                  </span>
                  <span className='gateway-network-name'>
                    {node.vendor.name}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
