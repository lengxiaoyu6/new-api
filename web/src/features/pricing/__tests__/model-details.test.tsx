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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ModelDetailsContent } from '../components/model-details'
import type { PricingModel } from '../types'

vi.mock('@/features/performance-metrics/api', () => ({
  getPerfMetrics: vi.fn().mockResolvedValue({ data: { groups: [] } }),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: null, loading: false, error: null }),
}))

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
    enable_groups: ['default', 'premium'],
    ...overrides,
  }
}

function renderModelDetails(model: PricingModel) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ModelDetailsContent
        model={model}
        groupRatio={{ default: 1, premium: 2 }}
        usableGroup={{
          default: { desc: 'Default', ratio: 1 },
          premium: { desc: 'Premium', ratio: 2 },
        }}
        endpointMap={{}}
        autoGroups={[]}
        priceRate={1}
        usdExchangeRate={1}
        tokenUnit='M'
      />
    </QueryClientProvider>
  )
}

function getGroupPricingSection() {
  return screen.getByText('Pricing by Group').closest('section') as HTMLElement
}

describe('model details channel billing display', () => {
  it('uses channel tiers for overridden groups and model tiers for fallback groups', () => {
    renderModelDetails(
      pricingModel({
        billing_mode: 'tiered_expr',
        billing_expr:
          'len > 100000 ? tier("model-long", p * 2 + c * 4) : tier("model-base", p + c * 2)',
        channel_pricing: [
          {
            profile_key: 'long-context',
            label: { en: 'Channel override' },
            source: 'channel',
            channel_count: 1,
            groups: ['default'],
            billing_mode: 'tiered_expr',
            billing_expr:
              'len > 100000 ? tier("channel-long", p * 3 + c * 6) : tier("channel-base", p * 1.5 + c * 3)',
            expr_hash: 'channel',
          },
        ],
      })
    )

    const pricingSection = getGroupPricingSection()
    expect(within(pricingSection).getByText('Channel override')).toBeVisible()
    expect(
      within(pricingSection).getAllByText('channel-long')
    ).not.toHaveLength(0)
    expect(
      within(pricingSection).getAllByText('channel-base')
    ).not.toHaveLength(0)
    expect(
      within(pricingSection).getAllByText(/^model-long(?:$|:)/)
    ).not.toHaveLength(0)
    expect(within(pricingSection).getAllByText('model-base')).not.toHaveLength(
      0
    )

    const channelOverride = screen
      .getByText('Channel override')
      .closest('.overflow-hidden') as HTMLElement
    expect(
      within(channelOverride).queryByText(/^model-long(?:$|:)/)
    ).not.toBeInTheDocument()
    expect(
      within(channelOverride).queryByText('model-base')
    ).not.toBeInTheDocument()
  })

  it('shows a channel long-context tier when the model fallback only has a base tier', () => {
    renderModelDetails(
      pricingModel({
        enable_groups: ['default'],
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("model-base", p + c * 2)',
        channel_pricing: [
          {
            profile_key: 'long-context',
            label: { en: 'Long-context channel pricing' },
            source: 'channel',
            channel_count: 1,
            groups: ['default'],
            billing_mode: 'tiered_expr',
            billing_expr:
              'len > 100000 ? tier("channel-long", p * 2 + c * 4) : tier("channel-base", p + c * 2)',
            expr_hash: 'channel-long',
          },
        ],
      })
    )

    const pricingSection = getGroupPricingSection()
    expect(
      within(pricingSection).getByText('Long-context channel pricing')
    ).toBeVisible()
    expect(
      within(pricingSection).getAllByText('channel-long')
    ).not.toHaveLength(0)
    expect(
      within(pricingSection).getAllByText('channel-base')
    ).not.toHaveLength(0)
    expect(
      within(pricingSection).queryByText('model-base')
    ).not.toBeInTheDocument()
  })
})
