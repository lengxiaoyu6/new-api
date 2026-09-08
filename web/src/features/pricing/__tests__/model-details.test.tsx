/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChannelBillingProfilesSummary } from '../components/model-details'
import type { PricingModel } from '../types'

vi.mock('../components/model-details-performance', () => ({
  ModelDetailsPerformance: () => null,
}))

function pricingModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'example-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 2,
    enable_groups: ['default'],
    ...overrides,
  }
}

describe('channel billing profile summary', () => {
  it('shows channel tiers while hiding inherited profiles and raw expressions', () => {
    const inheritedExpression = 'tier("inherited", p * 9 + c * 9)'
    const channelExpression =
      'len > 100000 ? tier("long", p * 2 + c * 4) : tier("base", p + c * 2)'

    render(
      <ChannelBillingProfilesSummary
        model={pricingModel({
          channel_pricing: [
            {
              profile_key: '',
              source: 'model',
              channel_count: 2,
              groups: ['default'],
              billing_mode: 'tiered_expr',
              billing_expr: inheritedExpression,
              expr_hash: 'inherited',
            },
            {
              profile_key: 'long-context',
              label: { en: 'Long-context pricing' },
              source: 'channel',
              channel_count: 1,
              groups: ['default'],
              billing_mode: 'tiered_expr',
              billing_expr: channelExpression,
              expr_hash: 'channel',
            },
          ],
        })}
        group='default'
        groupRatio={1}
      />
    )

    expect(screen.getByText('Long-context pricing')).toBeVisible()
    expect(screen.getAllByText('long').length).toBeGreaterThan(0)
    expect(screen.getAllByText('base').length).toBeGreaterThan(0)
    expect(screen.queryByText('inherited')).not.toBeInTheDocument()
    expect(screen.queryByText(inheritedExpression)).not.toBeInTheDocument()
    expect(screen.queryByText(channelExpression)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Inherited model pricing')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Used by 1 channels')).not.toBeInTheDocument()
  })
})
