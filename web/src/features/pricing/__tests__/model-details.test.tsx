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
import { render, screen, waitFor, within } from '@testing-library/react'
import { assert, describe, expect, it, vi } from 'vitest'

import { getPerfMetrics } from '@/features/performance-metrics/api'

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

function renderModelDetails(model: PricingModel, selectedGroup?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ModelDetailsContent
        model={model}
        selectedGroup={selectedGroup}
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

describe('model details metadata', () => {
  it('shows only provider and endpoints when other model metadata is configured', () => {
    renderModelDetails(
      pricingModel({
        vendor_name: 'OpenAI',
        supported_endpoint_types: ['openai', 'openai-response'],
        tags: 'reasoning',
        parameter_count: '70B',
      })
    )

    const section = screen
      .getByRole('heading', { name: 'Model' })
      .closest('section')
    assert.isNotNull(section)
    const metadata = within(section)

    for (const text of [
      'Provider',
      'OpenAI',
      'Endpoints',
      'openai',
      'openai-response',
    ]) {
      expect(metadata.getByText(text, { exact: true })).toBeVisible()
    }
    for (const text of [
      'Type',
      'Groups',
      'Tags',
      'Parameters',
      'default',
      'premium',
      'reasoning',
      '70B',
    ]) {
      expect(
        metadata.queryByText(text, { exact: true })
      ).not.toBeInTheDocument()
    }
  })

  it('omits the model section when provider and endpoints are unavailable', () => {
    renderModelDetails(
      pricingModel({
        supported_endpoint_types: ['', '   '],
        tags: 'reasoning',
        parameter_count: '70B',
      })
    )

    expect(
      screen.queryByRole('heading', { name: 'Model' })
    ).not.toBeInTheDocument()
  })
})

describe('model details channel billing display', () => {
  it('hides the custom profile name and tier table title while retaining selected group prices', () => {
    renderModelDetails(
      pricingModel({
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("model-base", p + c * 2)',
        channel_pricing: [
          {
            profile_key: 'custom-profile',
            label: { en: '1', zh: '1' },
            source: 'channel',
            channel_count: 1,
            groups: ['premium'],
            billing_mode: 'tiered_expr',
            billing_expr: 'tier("channel-base", p * 1.5 + c * 3)',
            expr_hash: 'custom',
          },
        ],
      }),
      'premium'
    )

    const pricingSection = getGroupPricingSection()
    expect(within(pricingSection).queryByText('1')).not.toBeInTheDocument()
    expect(
      within(pricingSection).queryByText('custom-profile')
    ).not.toBeInTheDocument()
    expect(
      within(pricingSection).queryByText('Tiered price table')
    ).not.toBeInTheDocument()
    expect(within(pricingSection).getByText('premium')).toBeVisible()
    expect(within(pricingSection).getByText('2x')).toBeVisible()
    const table = within(pricingSection).getByRole('table')
    expect(within(table).getByText('channel-base')).toBeVisible()
    expect(within(table).getByText('$3.0000')).toBeVisible()
    expect(within(table).getByText('$6.0000')).toBeVisible()
    expect(
      within(pricingSection).queryByText('model-base')
    ).not.toBeInTheDocument()
  })

  it('requests the selected group for overview performance statistics', async () => {
    renderModelDetails(pricingModel(), 'premium')

    await waitFor(() =>
      expect(getPerfMetrics).toHaveBeenCalledWith(
        'example-model',
        24,
        'premium'
      )
    )
  })

  it.each([
    { label: 'token', model: pricingModel() },
    {
      label: 'per-request',
      model: pricingModel({ quota_type: 1, model_price: 0.5 }),
    },
    {
      label: 'tiered',
      model: pricingModel({
        billing_mode: 'tiered_expr',
        billing_expr:
          'len > 100000 ? tier("long", p * 2 + c * 4) : tier("base", p + c * 2)',
      }),
    },
  ])('shows only the selected group for $label pricing', ({ model }) => {
    renderModelDetails(model, 'premium')

    const pricingSection = getGroupPricingSection()
    expect(within(pricingSection).getByText('premium')).toBeVisible()
    expect(
      within(pricingSection).queryByText('default')
    ).not.toBeInTheDocument()
    expect(within(pricingSection).getByText('2x')).toBeVisible()
  })

  it('omits other groups channel overrides when the selected group uses model pricing', () => {
    renderModelDetails(
      pricingModel({
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("model-base", p + c * 2)',
        channel_pricing: [
          {
            profile_key: 'override',
            label: { en: 'Other group override' },
            source: 'channel',
            channel_count: 1,
            groups: ['default'],
            billing_mode: 'tiered_expr',
            billing_expr: 'tier("other-group-tier", p * 3 + c * 6)',
            expr_hash: 'other-group',
          },
        ],
      }),
      'premium'
    )

    const pricingSection = getGroupPricingSection()
    expect(within(pricingSection).getByText('premium')).toBeVisible()
    expect(
      within(pricingSection).getAllByText('model-base').length
    ).toBeGreaterThan(0)
    expect(
      within(pricingSection).queryByText('Other group override')
    ).not.toBeInTheDocument()
    expect(
      within(pricingSection).queryByText('other-group-tier')
    ).not.toBeInTheDocument()
  })

  it('shows no group prices when the selected group cannot use the model', () => {
    renderModelDetails(pricingModel({ enable_groups: ['default'] }), 'premium')

    const pricingSection = getGroupPricingSection()
    expect(within(pricingSection).queryByRole('table')).not.toBeInTheDocument()
    expect(
      within(pricingSection).getByText(
        'This model is not available in any group, or no group pricing information is configured.'
      )
    ).toBeVisible()
  })

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
    expect(
      within(pricingSection).queryByText('Channel override')
    ).not.toBeInTheDocument()
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

    const channelOverride = within(pricingSection)
      .getByRole('cell', { name: 'channel-base' })
      .closest('table')
    assert.isNotNull(channelOverride)
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
      within(pricingSection).queryByText('Long-context channel pricing')
    ).not.toBeInTheDocument()
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
