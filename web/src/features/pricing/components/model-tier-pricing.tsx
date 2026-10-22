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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import type { ParsedTier } from '../lib/billing-expr'
import { formatBillingCondition } from '../lib/billing-expression/condition-display'
import {
  getDynamicDisplayGroupRatio,
  type DynamicPricingTier,
} from '../lib/dynamic-price'
import type { PricingModel } from '../types'
import { DynamicPricingBreakdown } from './dynamic-pricing-breakdown'
import type { ModelPriceCellOptions } from './model-price-cell'
import {
  ModelTokenPriceCell,
  type CatalogPriceType,
} from './model-token-price-cell'

export type ModelPricingDetails = {
  tiers: DynamicPricingTier[]
  hasRequestRules: boolean
  kind: 'time' | 'tiered' | 'rules'
}

export function ModelTierPricing(props: {
  id: string
  model: PricingModel
  details: ModelPricingDetails
  options: ModelPriceCellOptions
  cardView?: boolean
}) {
  const { t, i18n } = useTranslation()
  const priceTableLabel =
    props.details.kind === 'time'
      ? t('Time-based price table')
      : t('Tiered price table')
  const unit =
    (props.options.tokenUnit ?? DEFAULT_TOKEN_UNIT) === 'K' ? '1K' : '1M'
  const prices: Array<{ type: CatalogPriceType; label: string }> = [
    { type: 'input', label: t('Input price') },
    { type: 'output', label: t('Output price') },
    { type: 'create_cache', label: t('Cache Creation') },
    { type: 'cache', label: t('Cache Read') },
  ]
  const tokenTiers = props.details.tiers.filter(
    (tier): tier is ParsedTier =>
      !('unitPrices' in tier) && tier.billingUnit !== 'request'
  )

  function tierCondition(tier: ParsedTier): string {
    const source =
      tier.conditionText ||
      tier.conditions
        .map(
          (condition) => `${condition.var} ${condition.op} ${condition.value}`
        )
        .join(' && ')
    if (!source) {
      return t(props.details.tiers.length > 1 ? 'Other cases' : 'All requests')
    }
    return formatBillingCondition(source, t, i18n.language) ?? source
  }

  let content: ReactNode
  if (tokenTiers.length !== props.details.tiers.length) {
    content = (
      <DynamicPricingBreakdown
        billingExpr={props.model.billing_expr}
        usageSchema={props.model.billing_usage_schema}
        compact
        hideRequestRules
        hideUnparsedExpression
        priceMultiplier={
          props.options.groupRatioMultiplier ??
          getDynamicDisplayGroupRatio(props.model, props.options.selectedGroup)
        }
        taskPriceOptions={props.options}
      />
    )
  } else if (props.cardView) {
    content = (
      <div className='gateway-catalog-tier-cards'>
        {tokenTiers.map((tier) => (
          <div key={JSON.stringify(tier)} className='gateway-catalog-tier-card'>
            <div className='gateway-catalog-tier-condition'>
              {tierCondition(tier)}
            </div>
            <dl className='gateway-catalog-tier-fields'>
              {prices.map((price) => (
                <div key={price.type}>
                  <dt>{price.label}</dt>
                  <dd>
                    <ModelTokenPriceCell
                      model={props.model}
                      type={price.type}
                      options={props.options}
                      tier={tier}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    )
  } else {
    content = (
      <StaticDataTable
        className='gateway-catalog-tier-table'
        tableProps={{ 'aria-label': priceTableLabel }}
        data={tokenTiers}
        columns={[
          {
            id: 'condition',
            header: t('Applicable conditions'),
            cellClassName: 'gateway-catalog-tier-condition',
            cell: tierCondition,
          },
          ...prices.map((price) => ({
            id: price.type,
            header: (
              <span className='gateway-catalog-price-heading'>
                <span>{price.label}</span>
                <span className='gateway-catalog-price-unit'>
                  /{t('{{unit}} tokens', { unit })}
                </span>
              </span>
            ),
            cell: (tier: ParsedTier) => (
              <ModelTokenPriceCell
                model={props.model}
                type={price.type}
                options={props.options}
                tier={tier}
              />
            ),
          })),
        ]}
      />
    )
  }

  return (
    <section
      id={props.id}
      role='region'
      aria-label={`${props.model.model_name} · ${props.details.kind === 'rules' ? t('Pricing rules') : priceTableLabel}`}
      className='gateway-catalog-tier-details'
    >
      {content}
      {props.details.hasRequestRules && (
        <div className='gateway-catalog-conditional-rules'>
          <DynamicPricingBreakdown
            billingExpr={props.model.billing_expr}
            compact
            hideTierPrices
            hideUnparsedExpression
          />
          <p className='gateway-catalog-rules-note'>
            {t('Base prices exclude conditional multipliers.')}
          </p>
        </div>
      )}
    </section>
  )
}
