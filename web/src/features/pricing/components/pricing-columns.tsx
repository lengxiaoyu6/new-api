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
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronDown, Clock3 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import type { PricingModel } from '../types'
import { ModelPerfBadge, type ModelPerfBadgeData } from './model-perf-badge'
import type { ModelPriceCellOptions } from './model-price-cell'
import {
  ModelTierPricing,
  type ModelPricingDetails,
} from './model-tier-pricing'
import {
  ModelTokenPriceCell,
  type CatalogPriceType,
} from './model-token-price-cell'

export type PricingColumnsOptions = ModelPriceCellOptions & {
  onModelClick?: (modelName: string) => void
  performance?: Map<string, ModelPerfBadgeData>
  cardView?: boolean
  mobileView?: boolean
  pricingDetails?: Map<string, ModelPricingDetails>
  tierPanelPrefix?: string
}

export function usePricingColumns(
  options: PricingColumnsOptions = {}
): ColumnDef<PricingModel>[] {
  const { t } = useTranslation()
  const unit = (options.tokenUnit ?? DEFAULT_TOKEN_UNIT) === 'K' ? '1K' : '1M'
  return useMemo(() => {
    const prices: Array<{ type: CatalogPriceType; label: string }> = [
      { type: 'input', label: t('Input price') },
      { type: 'output', label: t('Output price') },
      { type: 'create_cache', label: t('Cache Creation') },
      { type: 'cache', label: t('Cache Read') },
    ]
    return [
      {
        accessorKey: 'model_name',
        header: t('Model'),
        meta: { label: t('Model'), mobileTitle: true },
        size: 420,
        enableSorting: false,
        cell: ({ row }) => {
          const model = row.original
          const icon = model.icon || model.vendor_icon
          const details = options.pricingDetails?.get(model.model_name)
          let expansionLabel = t('Tiered pricing')
          let expansionText = t('Tiered')
          if (details?.hasRequestRules) {
            expansionLabel = t('Pricing rules')
            expansionText =
              details.tiers.length > 1 ? t('Pricing rules') : t('Conditions')
          }
          return (
            <div className='gateway-catalog-model-name'>
              <Button
                variant='ghost'
                className='gateway-catalog-model-button'
                onClick={() => options.onModelClick?.(model.model_name)}
                title={model.model_name}
              >
                {icon && <span aria-hidden>{getLobeIcon(icon, 18)}</span>}
                <span>{model.model_name}</span>
              </Button>
              {row.getCanExpand() && (
                <Button
                  variant='ghost'
                  size={options.mobileView ? 'icon-sm' : 'xs'}
                  className={cn(
                    'gateway-catalog-tier-toggle',
                    options.mobileView && 'gateway-catalog-tier-toggle-icon'
                  )}
                  aria-label={`${expansionLabel} · ${model.model_name}`}
                  aria-expanded={row.getIsExpanded()}
                  aria-controls={`${options.tierPanelPrefix}-${encodeURIComponent(model.model_name)}`}
                  title={row.getIsExpanded() ? t('Collapse') : t('Expand')}
                  onClick={() => row.toggleExpanded()}
                >
                  {!options.mobileView && expansionText}
                  <ChevronDown className='size-3' aria-hidden />
                </Button>
              )}
              <CopyButton
                value={model.model_name}
                tooltip={t('Copy model name')}
                className='size-7'
                iconClassName='size-3.5'
              />
            </div>
          )
        },
      },
      ...prices.map((price) => ({
        id: price.type,
        size: 110,
        enableSorting: false,
        meta: {
          label: options.cardView
            ? `${price.label} /${t('{{unit}} tokens', { unit })}`
            : undefined,
        },
        header: () => (
          <span className='gateway-catalog-price-heading'>
            <span>{price.label}</span>
            <span className='gateway-catalog-price-unit'>
              /{t('{{unit}} tokens', { unit })}
            </span>
          </span>
        ),
        cell: ({ row }: { row: { original: PricingModel } }) => (
          <ModelTokenPriceCell
            model={row.original}
            type={price.type}
            options={options}
          />
        ),
      })),
      {
        id: 'actions',
        size: 240,
        enableSorting: false,
        header: () => (
          <span className='gateway-catalog-availability-heading'>
            <span>{t('Availability')}</span>
            <span className='gateway-catalog-window'>
              <Clock3 className='size-3' aria-hidden />
              {t('Past 24 hours')}
            </span>
          </span>
        ),
        cell: ({ row }) => {
          const details = options.pricingDetails?.get(row.original.model_name)
          return (
            <div className='w-full min-w-0'>
              <ModelPerfBadge
                variant='availability'
                perf={options.performance?.get(row.original.model_name)}
              />
              {options.cardView && details && row.getIsExpanded() && (
                <ModelTierPricing
                  id={`${options.tierPanelPrefix}-${encodeURIComponent(row.original.model_name)}`}
                  model={row.original}
                  details={details}
                  options={options}
                  cardView
                />
              )}
            </div>
          )
        },
      },
    ]
  }, [t, unit, options])
}
