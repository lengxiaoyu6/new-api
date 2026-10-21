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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useSystemConfigStore } from '@/stores/system-config-store'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import { useBillingTime } from '../hooks/use-billing-time'
import type { ParsedTier } from '../lib/billing-expr'
import {
  formatDynamicUnitPrice,
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
  isUnconfiguredTaskUsageModel,
} from '../lib/dynamic-price'
import { isTokenBasedModel } from '../lib/model-helpers'
import { formatPrice } from '../lib/price'
import type { PricingModel } from '../types'
import { ModelPriceCell, type ModelPriceCellOptions } from './model-price-cell'

export type CatalogPriceType = 'input' | 'output' | 'create_cache' | 'cache'

const TOKEN_FIELDS = {
  input: 'inputPrice',
  output: 'outputPrice',
  create_cache: 'cacheCreatePrice',
  cache: 'cacheReadPrice',
} as const

export function ModelTokenPriceCell(props: {
  model: PricingModel
  type: CatalogPriceType
  options: ModelPriceCellOptions
  tier?: ParsedTier
}) {
  const { t } = useTranslation()
  const currency = useSystemConfigStore((state) => state.config.currency)
  const billingTime = useBillingTime(props.model.billing_expr, !props.tier)
  const tokenUnit = props.options.tokenUnit ?? DEFAULT_TOKEN_UNIT
  const dynamicOptions = {
    ...props.options,
    tokenUnit,
    now: billingTime === undefined ? undefined : new Date(billingTime),
    groupRatioMultiplier:
      props.options.groupRatioMultiplier ??
      getDynamicDisplayGroupRatio(props.model, props.options.selectedGroup),
  }
  const summary = useMemo(
    () =>
      props.tier ? null : getDynamicPricingSummary(props.model, dynamicOptions),
    // Currency is read by the shared price formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      props.model,
      props.tier,
      tokenUnit,
      props.options.priceRate,
      props.options.usdExchangeRate,
      props.options.showRechargePrice,
      props.options.selectedGroup,
      props.options.groupRatioMultiplier,
      billingTime,
      currency,
    ]
  )
  const isRequestExpression = summary?.primaryEntries.some(
    (entry) => entry.unit === 'request' || entry.unit === 'image'
  )
  if (
    !props.tier &&
    (summary?.isTaskUsage ||
      summary?.isSpecialExpression ||
      summary?.isMixedBilling ||
      isRequestExpression ||
      isUnconfiguredTaskUsageModel(props.model) ||
      (!summary && !isTokenBasedModel(props.model)))
  ) {
    return props.type === 'input' ? (
      <ModelPriceCell
        model={props.model}
        options={props.options}
        showExpression={false}
      />
    ) : (
      <span className='text-muted-foreground'>—</span>
    )
  }

  let prices: Array<{ duration?: string; value: string }> = []
  if (summary || props.tier) {
    const fields = [TOKEN_FIELDS[props.type]] as string[]
    let tiers = summary?.tiers ?? []
    if (props.tier) {
      tiers = [props.tier]
    } else if (summary?.isTimePricing) {
      tiers = [summary.tier].filter((tier) => tier !== null)
    }
    if (
      props.type === 'create_cache' &&
      tiers.some((tier) => tier && 'cacheCreate1hPrice' in tier)
    ) {
      fields.push('cacheCreate1hPrice')
    }
    prices = fields.flatMap((field) => {
      const values = tiers.flatMap((tier) => {
        if (!tier || 'unitPrices' in tier || tier.billingUnit === 'request') {
          return []
        }
        const value = tier[field]
        return typeof value === 'number' && Number.isFinite(value) && value >= 0
          ? [value]
          : []
      })
      if (values.length === 0) return []
      const minimum = Math.min(...values)
      const formatted = formatDynamicUnitPrice(minimum, dynamicOptions)
      let duration: string | undefined
      if (fields.length > 1) {
        duration = field === 'cacheCreate1hPrice' ? '1h' : '5m'
      }
      return [
        {
          duration,
          value:
            Math.max(...values) > minimum
              ? t('Starting at {{price}}', { price: formatted })
              : formatted,
        },
      ]
    })
  } else {
    const ratios = {
      input: props.model.model_ratio,
      output: props.model.completion_ratio,
      cache: props.model.cache_ratio,
      create_cache: props.model.create_cache_ratio,
    }
    const ratio = ratios[props.type]
    if (
      ratio != null &&
      Number.isFinite(ratio) &&
      Number.isFinite(props.model.model_ratio)
    ) {
      prices = [
        {
          value: formatPrice(
            props.model,
            props.type,
            tokenUnit,
            props.options.showRechargePrice,
            props.options.priceRate,
            props.options.usdExchangeRate,
            props.options.selectedGroup,
            true,
            props.options.groupRatioMultiplier
          ),
        },
      ]
    }
  }
  if (prices.length === 0) {
    return <span className='text-muted-foreground'>—</span>
  }
  return (
    <span className='gateway-catalog-token-price'>
      {prices.map((price, index) => (
        <span key={price.duration ?? index} className='whitespace-nowrap'>
          {price.value}
          {price.duration && ` (${price.duration})`}
        </span>
      ))}
      {summary?.isTimePricing && (
        <span className='text-muted-foreground block text-[10px]'>
          {t('Current period price')}
        </span>
      )}
    </span>
  )
}
