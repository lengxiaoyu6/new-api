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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PerfSummaryAllData } from '@/features/performance-metrics/types'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { PricingTable } from '../components/pricing-table'
import type { PricingModel } from '../types'

const model: PricingModel = {
  id: 1,
  model_name: 'example-model',
  vendor_icon: 'OpenAI',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 6,
  cache_ratio: 0.1,
  create_cache_ratio: 0,
  enable_groups: ['default', 'premium'],
  group_ratio: { default: 1, premium: 2 },
}
const tieredModel: PricingModel = {
  ...model,
  billing_mode: 'tiered_expr',
  billing_expr:
    'len <= 272000 ? tier("standard", p * 2 + c * 12 + cc * 2.5 + cc1h * 4 + cr * 0) : tier("long", p * 4 + c * 18 + cc * 5 + cc1h * 8)',
}
const timeModel: PricingModel = {
  ...model,
  billing_mode: 'tiered_expr',
  billing_expr:
    'weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") <= 5 && hour("Asia/Shanghai") >= 8 && hour("Asia/Shanghai") < 12 ? tier("morning", p * 1 + c * 4) : weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") <= 5 && hour("Asia/Shanghai") >= 12 && hour("Asia/Shanghai") < 18 ? tier("afternoon", p * 2 + c * 8) : weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") <= 5 && hour("Asia/Shanghai") >= 18 && hour("Asia/Shanghai") < 23 ? tier("evening", p * 3 + c * 12) : tier("default", p * 4 + c * 16)',
}
const conditionalModel: PricingModel = {
  ...model,
  billing_mode: 'tiered_expr',
  billing_expr:
    'tier("base", p * 1 + c * 4 + cr * 0.02) * (weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") <= 5 && hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 18 ? 2 : 1) * (hour("Asia/Shanghai") >= 0 ? 1 : 1)',
  group_ratio: { default: 0.2, premium: 2 },
}
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        window_start: 86400,
        window_end: 169200,
        models: [
          {
            model_name: 'example-model',
            success_rate: 98.5,
            recent_success_series: [
              { ts: 86400, success_rate: 100 },
              { ts: 90000, success_rate: 75 },
            ],
          },
        ],
      },
    },
  })
})
afterEach(() => {
  client.clear()
})

function renderCatalog(
  models: PricingModel[] = [model],
  options: Partial<React.ComponentProps<typeof PricingTable>> = {}
) {
  const onModelClick = vi.fn()
  const result = render(
    <QueryClientProvider client={client}>
      <PricingTable models={models} onModelClick={onModelClick} {...options} />
    </QueryClientProvider>
  )
  return { ...result, onModelClick }
}

describe('responsive catalog table', () => {
  it.each(['table', 'mobile'])(
    'shows availability only for the selected group and keeps group caches separate in the %s view',
    async (view) => {
      client.setDefaultOptions({
        queries: { retry: false, gcTime: 60 * 1000 },
      })
      if (view === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const premium = Promise.withResolvers<{ data: PerfSummaryAllData }>()
      vi.mocked(api.get)
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              models: [
                {
                  model_name: 'example-model',
                  success_rate: 100,
                  recent_success_series: [{ ts: 86400, success_rate: 100 }],
                },
              ],
            },
          },
        })
        .mockReturnValueOnce(premium.promise)
        .mockResolvedValueOnce({
          data: { success: true, data: { models: [] } },
        })
      const { rerender } = renderCatalog([model], {
        selectedGroup: 'default',
      })
      expect(await screen.findByText('100%')).toBeVisible()
      expect(api.get).toHaveBeenLastCalledWith(
        '/api/perf-metrics/summary',
        expect.objectContaining({
          params: { hours: 24, recent_model: undefined, group: 'default' },
        })
      )

      rerender(
        <QueryClientProvider client={client}>
          <PricingTable models={[model]} selectedGroup='premium' />
        </QueryClientProvider>
      )
      await waitFor(() =>
        expect(api.get).toHaveBeenLastCalledWith(
          '/api/perf-metrics/summary',
          expect.objectContaining({
            params: { hours: 24, recent_model: undefined, group: 'premium' },
          })
        )
      )
      expect(screen.queryByText('100%')).not.toBeInTheDocument()
      expect(screen.queryByText('98.5%')).not.toBeInTheDocument()
      await act(async () => {
        premium.resolve({
          data: {
            success: true,
            data: {
              models: [
                {
                  model_name: 'example-model',
                  success_rate: 25,
                  avg_latency_ms: 1000,
                  avg_tps: 5,
                  recent_success_series: [{ ts: 86400, success_rate: 25 }],
                },
              ],
            },
          },
        })
      })
      expect(await screen.findByText('25%')).toBeVisible()
      expect(
        within(screen.getByRole('img', { name: 'Success rate' })).getByTitle(
          '25%'
        )
      ).toBeVisible()

      rerender(
        <QueryClientProvider client={client}>
          <PricingTable models={[model]} selectedGroup='empty' />
        </QueryClientProvider>
      )
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3))
      expect(screen.queryByText('25%')).not.toBeInTheDocument()
      expect(
        screen.getByText('—', { selector: '.gateway-catalog-status-rate' })
      ).toBeVisible()
      expect(
        screen.getByRole('img', { name: 'No performance data available' })
      ).toBeVisible()

      rerender(
        <QueryClientProvider client={client}>
          <PricingTable models={[model]} selectedGroup='default' />
        </QueryClientProvider>
      )
      expect(await screen.findByText('100%')).toBeVisible()
      expect(api.get).toHaveBeenCalledTimes(3)
    }
  )

  it('uses the global summary when all groups are selected', async () => {
    renderCatalog([model], { selectedGroup: 'all' })
    expect(await screen.findByText('98.5%')).toBeVisible()
    expect(api.get).toHaveBeenLastCalledWith(
      '/api/perf-metrics/summary',
      expect.objectContaining({
        params: { hours: 24, recent_model: undefined },
      })
    )
  })

  it('shows base prices in expanded tiers without applying group and recharge rates', async () => {
    const user = userEvent.setup()
    renderCatalog([tieredModel], {
      selectedGroup: 'premium',
      priceDisplayMode: 'official',
      showRechargePrice: true,
      priceRate: 0.25,
      usdExchangeRate: 1,
    })
    await screen.findByText('98.5%')
    await user.click(
      screen.getByRole('button', { name: 'Tiered pricing · example-model' })
    )
    const details = screen.getByRole('region', {
      name: 'example-model · Tiered price table',
    })
    for (const value of ['$2', '$12', '$4', '$18']) {
      expect(within(details).getByText(value, { exact: true })).toBeVisible()
    }
    expect(
      within(details).getByText('$2.5 (5m)', { exact: true })
    ).toBeVisible()
    expect(within(details).getByText('$4 (1h)', { exact: true })).toBeVisible()
  })

  it.each(['site', 'official'] as const)(
    'shows the %s per-request price with the appropriate group and recharge rates',
    (priceDisplayMode) => {
      renderCatalog([{ ...model, quota_type: 1, model_price: 1.25 }], {
        selectedGroup: 'premium',
        priceDisplayMode,
        showRechargePrice: true,
        priceRate: 0.25,
        usdExchangeRate: 1,
      })
      expect(
        screen.getByText(priceDisplayMode === 'official' ? '1.25' : '0.625', {
          exact: true,
        })
      ).toBeVisible()
    }
  )

  it.each(['table', 'mobile', 'card'] as const)(
    'expands a single base price with readable time multipliers in the %s view',
    async (view) => {
      if (view === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const user = userEvent.setup()
      const { onModelClick } = renderCatalog([conditionalModel], {
        selectedGroup: 'default',
        viewMode: view === 'card' ? 'card' : 'table',
      })
      await screen.findByText('98.5%')
      const toggle = screen.getByRole('button', {
        name: 'Pricing rules · example-model',
      })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      if (view === 'mobile') {
        expect(toggle).not.toHaveTextContent(/\S/)
      } else {
        expect(toggle).toHaveTextContent('Conditions')
      }
      toggle.focus()
      await user.keyboard('{Enter}')

      const details = screen.getByRole('region', {
        name: 'example-model · Pricing rules',
      })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(details.id).toBe(toggle.getAttribute('aria-controls'))
      expect(within(details).getByText('All requests')).toBeVisible()
      for (const price of ['$0.2', '$0.8', '$0.004']) {
        expect(within(details).getByText(price, { exact: true })).toBeVisible()
      }
      const rules = within(details).getAllByRole('listitem')
      expect(rules).toHaveLength(2)
      expect(rules[0]).toHaveTextContent('Mon–Fri 09:00–18:00 (Asia/Shanghai)')
      expect(rules[0]).toHaveTextContent('2x')
      expect(rules[1]).toHaveTextContent('00:00–24:00 (Asia/Shanghai)')
      expect(rules[1]).toHaveTextContent('1x')
      expect(
        within(details).getByText(
          'Base prices exclude conditional multipliers.'
        )
      ).toBeVisible()
      expect(within(details).queryByText('Matched')).not.toBeInTheDocument()
      expect(within(details).queryByText('Other cases')).not.toBeInTheDocument()
      expect(onModelClick).not.toHaveBeenCalled()

      await user.keyboard(' ')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    }
  )

  it('updates conditional base prices for group, recharge, and token-unit changes without applying request multipliers', async () => {
    const user = userEvent.setup()
    const { rerender } = renderCatalog([conditionalModel], {
      selectedGroup: 'default',
    })
    await screen.findByText('98.5%')
    await user.click(
      screen.getByRole('button', { name: 'Pricing rules · example-model' })
    )

    rerender(
      <QueryClientProvider client={client}>
        <PricingTable
          models={[conditionalModel]}
          selectedGroup='premium'
          tokenUnit='K'
          showRechargePrice
          priceRate={0.5}
          usdExchangeRate={1}
        />
      </QueryClientProvider>
    )
    const details = screen.getByRole('region')
    for (const price of ['$0.001', '$0.004', '$0.00002']) {
      expect(within(details).getByText(price, { exact: true })).toBeVisible()
    }
    expect(within(details).getByText('2x')).toBeVisible()
    expect(within(details).getByText('1x')).toBeVisible()
  })

  it('updates expanded conditional rules and their note when switching between Chinese locales', async () => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'zh',
      fallbackLng: false,
      resources: { zh, 'zh-TW': zhTW },
    })
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <PricingTable models={[conditionalModel]} selectedGroup='default' />
        </QueryClientProvider>
      </I18nextProvider>
    )
    await screen.findByText('98.5%')
    await user.click(
      screen.getByRole('button', {
        name: `${i18n.t('Pricing rules')} · example-model`,
      })
    )
    expect(
      within(screen.getByRole('region')).getByText('基础价格未包含条件乘数。')
    ).toBeVisible()

    await act(() => i18n.changeLanguage('zh-TW'))

    const details = screen.getByRole('region', {
      name: `example-model · ${i18n.t('Pricing rules')}`,
    })
    expect(within(details).getByText('基礎價格未包含條件乘數。')).toBeVisible()
    expect(within(details).getAllByRole('listitem')[0]).toHaveTextContent(
      '週一至週五 09:00至18:00（Asia/Shanghai）'
    )
    expect(within(details).getByText('$0.2')).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: `${i18n.t('Pricing rules')} · example-model`,
      })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it.each(['table', 'mobile'] as const)(
    'shows tiers and independent request multipliers together in the %s view without inventing match or fallback states',
    async (view) => {
      if (view === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const user = userEvent.setup()
      renderCatalog([
        {
          ...tieredModel,
          billing_expr: `(${tieredModel.billing_expr}) * (header("x-priority") == "high" ? 2 : 1) * (param("service_tier") == "batch" ? 0.5 : 1)`,
        },
      ])
      await screen.findByText('98.5%')
      const toggle = screen.getByRole('button', {
        name: 'Pricing rules · example-model',
      })
      if (view === 'table') expect(toggle).toHaveTextContent('Conditions')
      await user.click(toggle)

      const details = screen.getByRole('region')
      expect(within(details).getByText(/Full input length.*272/)).toBeVisible()
      expect(within(details).getByText('$2.5 (5m)')).toBeVisible()
      expect(within(details).getByText('$8 (1h)')).toBeVisible()
      const rules = within(details).getAllByRole('listitem')
      expect(rules).toHaveLength(2)
      expect(rules[0]).toHaveTextContent('Header x-priority = high')
      expect(rules[0]).toHaveTextContent('2x')
      expect(rules[1]).toHaveTextContent('Body param service_tier = batch')
      expect(rules[1]).toHaveTextContent('0.5x')
      expect(within(details).queryByText('1x')).not.toBeInTheDocument()
      expect(
        within(details).queryByText(/Matched|Current period price/)
      ).not.toBeInTheDocument()
    }
  )

  it.each([
    {
      name: 'request',
      expression: 'tier("request", fixed(0.05))',
      price: '$0.05/request',
    },
    {
      name: 'task',
      expression: 'tier("video", u("seconds") * 0.4)',
      schema: { seconds: { type: 'number' as const, unit: 'second' as const } },
      price: '$0.4/s',
    },
  ])(
    'expands single-tier $name prices with conditional multipliers using their own units',
    async ({ expression, schema, price }) => {
      const user = userEvent.setup()
      renderCatalog([
        {
          ...model,
          billing_mode: 'tiered_expr',
          billing_expr: `${expression} * (header("x-priority") == "high" ? 2 : 1)`,
          billing_usage_schema: schema,
        },
      ])
      await screen.findByText('98.5%')
      await user.click(
        screen.getByRole('button', { name: 'Pricing rules · example-model' })
      )
      const details = screen.getByRole('region')
      expect(within(details).getAllByText(price).length).toBeGreaterThan(0)
      expect(within(details).getByText('2x')).toBeVisible()
    }
  )

  it.each(['table', 'mobile', 'card'] as const)(
    'labels weekday time prices as time periods and expands all periods in the %s view',
    async (view) => {
      if (view === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const user = userEvent.setup()
      renderCatalog([timeModel], {
        viewMode: view === 'card' ? 'card' : 'table',
      })
      await screen.findByText('98.5%')
      const toggle = screen.getByRole('button', {
        name: 'Time-based pricing · example-model',
      })
      if (view === 'mobile') {
        expect(toggle).not.toHaveTextContent(/\S/)
      } else {
        expect(toggle).toHaveTextContent('Time periods')
      }
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      toggle.focus()
      await user.keyboard('{Enter}')

      const details = screen.getByRole('region', {
        name: 'example-model · Time-based price table',
      })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(details.id).toBe(toggle.getAttribute('aria-controls'))
      for (const price of ['$1', '$2', '$3', '$4', '$8', '$12', '$16']) {
        expect(
          within(details).getAllByText(price, { exact: true }).length
        ).toBeGreaterThan(0)
      }
      expect(details).toHaveTextContent(/Mon.*Fri.*08:00.*12:00/)
      expect(details).toHaveTextContent(/12:00.*18:00/)
      expect(details).toHaveTextContent(/18:00.*23:00/)
      if (view === 'table') {
        expect(
          within(details).getByRole('table', {
            name: 'Time-based price table',
          })
        ).toBeVisible()
      }
      await user.keyboard(' ')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    }
  )

  it.each([
    {
      name: 'time periods with token thresholds',
      expression: `hour("UTC") < 12 ? (${tieredModel.billing_expr}) : tier("night", p * 1 + c * 4)`,
    },
    {
      name: 'time periods with request multipliers',
      expression: `(${timeModel.billing_expr}) * (header("x-priority") == "high" ? 2 : 1)`,
    },
  ])('labels $name as conditions', async ({ expression }) => {
    const user = userEvent.setup()
    renderCatalog([{ ...timeModel, billing_expr: expression }])
    await screen.findByText('98.5%')
    const toggle = screen.getByRole('button', {
      name: 'Pricing rules · example-model',
    })
    expect(toggle).toHaveTextContent('Conditions')
    await user.click(toggle)
    expect(
      screen.getByRole('region', {
        name: 'example-model · Pricing rules',
      })
    ).toBeVisible()
  })

  it('updates time-period labels when switching between Chinese locales', async () => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'zh',
      fallbackLng: false,
      resources: { zh, 'zh-TW': zhTW },
    })
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <PricingTable models={[timeModel]} />
        </QueryClientProvider>
      </I18nextProvider>
    )
    await screen.findByText('98.5%')
    const toggle = screen.getByRole('button', {
      name: '时段定价 · example-model',
    })
    expect(toggle).toHaveTextContent('时段')
    await user.click(toggle)
    expect(
      screen.getByRole('region', { name: 'example-model · 时段价格表' })
    ).toBeVisible()

    await act(() => i18n.changeLanguage('zh-TW'))

    expect(
      screen.getByRole('button', { name: '時段定價 · example-model' })
    ).toHaveTextContent('時段')
    expect(
      screen.getByRole('region', { name: 'example-model · 時段價格表' })
    ).toBeVisible()
  })

  it.each(['table', 'mobile', 'card'] as const)(
    'expands and collapses tier prices with the keyboard in the %s view',
    async (view) => {
      if (view === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const user = userEvent.setup()
      const { onModelClick } = renderCatalog([tieredModel], {
        viewMode: view === 'card' ? 'card' : 'table',
      })
      await screen.findByText('98.5%')
      const toggle = screen.getByRole('button', {
        name: 'Tiered pricing · example-model',
      })
      if (view === 'mobile') {
        expect(toggle).not.toHaveTextContent(/\S/)
      } else {
        expect(toggle).toHaveTextContent('Tiered')
      }
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region')).not.toBeInTheDocument()

      toggle.focus()
      await user.keyboard('{Enter}')

      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const details = screen.getByRole('region', {
        name: 'example-model · Tiered price table',
      })
      expect(details.id).toBe(toggle.getAttribute('aria-controls'))
      expect(within(details).getByText(/Full input length.*272/)).toBeVisible()
      expect(within(details).getByText('Other cases')).toBeVisible()
      for (const price of [
        '$2',
        '$12',
        '$2.5 (5m)',
        '$4 (1h)',
        '$0',
        '$18',
        '$5 (5m)',
        '$8 (1h)',
        '—',
      ]) {
        expect(within(details).getByText(price, { exact: true })).toBeVisible()
      }
      expect(within(details).queryByText(/Starting at/)).not.toBeInTheDocument()
      expect(onModelClick).not.toHaveBeenCalled()
      await user.keyboard(' ')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    }
  )

  it('expands mobile tier prices by tapping the arrow and keeps copying independent', async () => {
    const original = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...original(query),
      matches: query === '(max-width: 767px)' || original(query).matches,
    }))
    const user = userEvent.setup()
    const { onModelClick } = renderCatalog([tieredModel])
    await screen.findByText('98.5%')
    const toggle = screen.getByRole('button', {
      name: 'Tiered pricing · example-model',
    })

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copy model name' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region')).toBeVisible()
    expect(onModelClick).not.toHaveBeenCalled()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('updates expanded tier prices when the selected group, recharge rate, and token unit change', async () => {
    const user = userEvent.setup()
    const { rerender } = renderCatalog([tieredModel])
    await screen.findByText('98.5%')
    await user.click(
      screen.getByRole('button', { name: 'Tiered pricing · example-model' })
    )
    rerender(
      <QueryClientProvider client={client}>
        <PricingTable
          models={[tieredModel]}
          selectedGroup='premium'
          tokenUnit='K'
          showRechargePrice
          priceRate={0.5}
          usdExchangeRate={1}
        />
      </QueryClientProvider>
    )
    const details = screen.getByRole('region')
    expect(within(details).getByText('$0.002')).toBeVisible()
    expect(within(details).getByText('$0.018')).toBeVisible()
    expect(within(details).getByText('$0.0025 (5m)')).toBeVisible()
    expect(within(details).getByText('$0.008 (1h)')).toBeVisible()
  })

  it('keeps expanded prices attached to the model when the model list changes', async () => {
    const user = userEvent.setup()
    const { rerender } = renderCatalog([
      tieredModel,
      { ...model, model_name: 'fixed' },
    ])
    await screen.findByText('98.5%')
    await user.click(
      screen.getByRole('button', { name: 'Tiered pricing · example-model' })
    )
    rerender(
      <QueryClientProvider client={client}>
        <PricingTable
          models={[{ ...model, model_name: 'fixed' }, tieredModel]}
        />
      </QueryClientProvider>
    )
    expect(
      screen.getByRole('button', { name: 'Tiered pricing · example-model' })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(
      screen.getByRole('region', { name: 'example-model · Tiered price table' })
    ).toBeVisible()
  })

  it('omits tier expansion for fixed prices, single tiers, and unrecognized expressions', () => {
    renderCatalog([
      model,
      {
        ...model,
        model_name: 'single-tier',
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("base", p * 2 + c * 12)',
      },
      {
        ...model,
        model_name: 'custom',
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("base", max(p * 2 + c * 8, 100))',
      },
    ])
    expect(
      screen.queryByRole('button', { name: /Tiered pricing/ })
    ).not.toBeInTheDocument()
  })

  it.each([
    {
      name: 'task tiers',
      expression:
        'u("mode") == "pro" ? tier("pro", u("seconds") * 0.8) : tier("std", u("seconds") * 0.4)',
      schema: {
        seconds: { type: 'number' as const, unit: 'second' as const },
        mode: { enum: ['std', 'pro'] },
      },
      price: '$0.8/s',
    },
    {
      name: 'mixed token and request tiers',
      expression:
        'len < 1000 ? tier("free", fixed(0)) : tier("tokens", p * 2 + c * 8)',
      price: '$0/request',
    },
  ])(
    'expands $name through the existing breakdown and preserves its billing unit',
    async ({ expression, schema, price }) => {
      const user = userEvent.setup()
      renderCatalog([
        {
          ...model,
          billing_mode: 'tiered_expr',
          billing_expr: expression,
          billing_usage_schema: schema,
        },
      ])
      await screen.findByText('98.5%')
      await user.click(
        screen.getByRole('button', { name: 'Tiered pricing · example-model' })
      )
      const details = screen.getByRole('region')
      expect(within(details).getAllByText(price).length).toBeGreaterThan(0)
    }
  )

  it('shows only model, four separate token prices, and real availability by default', async () => {
    renderCatalog()
    const table = screen.getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual([
      'Model',
      'Input price/1M tokens',
      'Output price/1M tokens',
      'Cache Creation/1M tokens',
      'Cache Read/1M tokens',
      'AvailabilityPast 24 hours',
    ])
    const cells = within(table).getAllByRole('row')[1].querySelectorAll('td')
    expect(cells[1]).toHaveTextContent('$2')
    expect(cells[2]).toHaveTextContent('$12')
    expect(cells[3]).toHaveTextContent('$0')
    expect(cells[4]).toHaveTextContent('$0.2')
    expect(await screen.findByText('98.5%')).toBeVisible()
    const bars = screen.getByRole('img', { name: 'Success rate' })
    expect(within(bars).getByTitle('100%')).toBeVisible()
    expect(within(bars).getByTitle('75%')).toBeVisible()
    expect(
      within(bars).getAllByTitle('No performance data available')
    ).toHaveLength(22)
    expect(api.get).toHaveBeenCalledWith(
      '/api/perf-metrics/summary',
      expect.objectContaining({
        params: { hours: 24, recent_model: undefined },
      })
    )
  })

  it('opens model details with the keyboard and copies without opening the details', async () => {
    const user = userEvent.setup()
    const { onModelClick } = renderCatalog()
    await user.click(screen.getByRole('button', { name: 'Copy model name' }))
    expect(onModelClick).not.toHaveBeenCalled()
    screen.getByRole('button', { name: 'example-model' }).focus()
    await user.keyboard('{Enter}')
    expect(onModelClick).toHaveBeenCalledWith('example-model')
  })

  it('shows starting prices for tiers, zero cache read, and unavailable cache creation separately', () => {
    renderCatalog([
      {
        ...model,
        billing_mode: 'tiered_expr',
        billing_expr:
          'len < 1000 ? tier("small", p * 2 + c * 12 + cr * 0) : tier("large", p * 4 + c * 24 + cr * 0)',
      },
    ])
    const cells = within(screen.getByRole('table'))
      .getAllByRole('row')[1]
      .querySelectorAll('td')
    expect(cells[1]).toHaveTextContent('Starting at $2')
    expect(cells[2]).toHaveTextContent('Starting at $12')
    expect(cells[3]).toHaveTextContent('—')
    expect(cells[4]).toHaveTextContent('$0')
  })

  it.each([
    ['zh', 'table'],
    ['zh', 'mobile'],
    ['zh-TW', 'table'],
    ['zh-TW', 'mobile'],
  ])(
    'places the starting-price label after the price in the %s %s view',
    async (language, view) => {
      if (view === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const i18n = createInstance()
      await i18n.init({
        lng: language,
        fallbackLng: false,
        resources: { zh, 'zh-TW': zhTW },
      })
      render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>
            <PricingTable
              models={[
                {
                  ...model,
                  billing_mode: 'tiered_expr',
                  billing_expr:
                    'len < 1000 ? tier("small", p * 2 + c * 12 + cc * 2.5 + cc1h * 4 + cr * 0) : tier("large", p * 4 + c * 24 + cc * 5 + cc1h * 8 + cr * 0)',
                },
              ]}
            />
          </QueryClientProvider>
        </I18nextProvider>
      )
      expect(screen.getByText('$2 起')).toBeVisible()
      expect(screen.getByText('$12 起')).toBeVisible()
      expect(screen.getByText('$2.5 起 (5m)')).toBeVisible()
      expect(screen.getByText('$4 起 (1h)')).toBeVisible()
      expect(screen.getByText('$0')).toBeVisible()
      expect(screen.queryByText(/^起\s/)).not.toBeInTheDocument()
    }
  )

  it('keeps per-request pricing and its unit outside the token price fields', () => {
    renderCatalog([{ ...model, quota_type: 1, model_price: 0.05 }])
    expect(screen.getByText('Per-request')).toBeVisible()
    expect(screen.getByText('USD / request')).toBeVisible()
    const cells = within(screen.getByRole('table'))
      .getAllByRole('row')[1]
      .querySelectorAll('td')
    for (const cell of [cells[2], cells[3], cells[4]]) {
      expect(cell).toHaveTextContent('—')
    }
  })

  it('automatically uses a compact card with four price fields and availability on mobile', async () => {
    const original = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...original(query),
      matches: query === '(max-width: 767px)' || original(query).matches,
    }))
    renderCatalog()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'example-model' })).toBeVisible()
    for (const label of [
      'Input price',
      'Output price',
      'Cache Creation',
      'Cache Read',
    ]) {
      expect(screen.getByText(`${label} /1M tokens`)).toBeVisible()
    }
    expect(await screen.findByText('98.5%')).toBeVisible()
  })

  it('preserves group, recharge, and token-unit selection in all four prices', () => {
    renderCatalog([model], {
      selectedGroup: 'premium',
      tokenUnit: 'K',
      showRechargePrice: true,
      priceRate: 0.5,
      usdExchangeRate: 1,
    })
    const cells = within(screen.getByRole('table'))
      .getAllByRole('row')[1]
      .querySelectorAll('td')
    expect(cells[1]).toHaveTextContent('$0.002')
    expect(cells[2]).toHaveTextContent('$0.012')
    expect(cells[3]).toHaveTextContent('$0')
    expect(cells[4]).toHaveTextContent('$0.0002')
  })

  it('updates existing rows when the selected group and token unit change', () => {
    const { rerender } = renderCatalog()
    rerender(
      <QueryClientProvider client={client}>
        <PricingTable models={[model]} tokenUnit='K' selectedGroup='premium' />
      </QueryClientProvider>
    )
    const cells = within(screen.getByRole('table'))
      .getAllByRole('row')[1]
      .querySelectorAll('td')
    expect(cells[1]).toHaveTextContent('$0.004')
    expect(cells[2]).toHaveTextContent('$0.024')
    expect(cells[4]).toHaveTextContent('$0.0004')
    expect(
      screen.getByRole('columnheader', { name: /Input price.*1K tokens/ })
    ).toBeVisible()
  })

  it('keeps zero-success measurements distinct from missing data', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          window_start: 86400,
          window_end: 169200,
          models: [
            {
              model_name: model.model_name,
              success_rate: 0,
              recent_success_series: [{ ts: 169200, success_rate: 0 }],
            },
          ],
        },
      },
    })
    renderCatalog()
    expect(await screen.findByText('0%')).toBeVisible()
    const bars = screen.getByRole('img', { name: 'Success rate' })
    expect(within(bars).getByTitle('0%')).toBeVisible()
    expect(
      within(bars).getAllByTitle('No performance data available')
    ).toHaveLength(23)
  })

  it.each(['empty', 'failure'])(
    'keeps prices available when metrics return %s',
    async (result) => {
      if (result === 'failure') {
        vi.mocked(api.get).mockRejectedValueOnce(
          new Error('Metrics unavailable')
        )
      } else {
        vi.mocked(api.get).mockResolvedValueOnce({
          data: { success: true, data: { models: [] } },
        })
      }
      renderCatalog()
      await waitFor(() => expect(client.isFetching()).toBe(0))
      expect(screen.getByText('$2')).toBeVisible()
      expect(
        screen.getByRole('img', { name: 'No performance data available' })
      ).toBeVisible()
      expect(screen.queryByText('100%')).not.toBeInTheDocument()
    }
  )

  it.each([
    {
      name: 'fixed expression',
      expression: 'tier("request", fixed(0.01))',
      expected: /0.01.*request/,
    },
    {
      name: 'task',
      expression: 'tier("video", u("seconds") * 0.4)',
      schema: { seconds: { type: 'number' as const, unit: 'second' as const } },
      expected: /0.4.*s/,
    },
    {
      name: 'special expression',
      expression: 'tier("custom", max(p * 2 + c * 8, 100))',
      expected: /Special billing expression/,
    },
  ])(
    'preserves $name billing without treating its price as tokens',
    ({ expression, schema, expected }) => {
      renderCatalog([
        {
          ...model,
          billing_mode: 'tiered_expr',
          billing_expr: expression,
          billing_usage_schema: schema,
        },
      ])
      const cells = within(screen.getByRole('table'))
        .getAllByRole('row')[1]
        .querySelectorAll('td')
      expect(cells[1]).toHaveTextContent(expected)
      for (const cell of [cells[2], cells[3], cells[4]]) {
        expect(cell).toHaveTextContent('—')
      }
    }
  )

  it('shows cache reads at the input price even when the expression summary hides equal prices', () => {
    renderCatalog([
      {
        ...model,
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("base", p * 2 + c * 12 + cr * 2)',
      },
    ])
    const cells = within(screen.getByRole('table'))
      .getAllByRole('row')[1]
      .querySelectorAll('td')
    expect(cells[1]).toHaveTextContent('$2')
    expect(cells[4]).toHaveTextContent('$2')
  })

  it.each(['table', 'mobile'])(
    'shows cache durations after their prices and omits the billing badge in the %s view',
    (view) => {
      if (view === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      renderCatalog([
        {
          ...model,
          billing_mode: 'tiered_expr',
          billing_expr: 'tier("base", p * 2 + c * 12 + cc * 2.5 + cc1h * 4)',
        },
      ])
      expect(screen.getByText('$2.5 (5m)')).toBeVisible()
      expect(screen.getByText('$4 (1h)')).toBeVisible()
      expect(screen.queryByText('Cache Write (5m)')).not.toBeInTheDocument()
      expect(screen.queryByText('Cache Write (1h)')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: model.model_name })
      ).toBeVisible()
      expect(screen.queryByText('Dynamic Pricing')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Copy model name' })
      ).toBeVisible()
    }
  )

  it('uses the current period for time-dependent prices instead of the cheapest period', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-20T10:00:00Z'))
    renderCatalog([
      {
        ...model,
        billing_mode: 'tiered_expr',
        billing_expr:
          'hour("UTC") >= 9 && hour("UTC") < 18 ? tier("peak", p * 6 + c * 24 + cr * 0.6) : tier("off_peak", p * 2 + c * 8 + cr * 0.2)',
      },
    ])
    const cells = within(screen.getByRole('table'))
      .getAllByRole('row')[1]
      .querySelectorAll('td')
    await waitFor(() => expect(cells[1]).toHaveTextContent('$6'))
    expect(cells[2]).toHaveTextContent('$24')
    expect(cells[4]).toHaveTextContent('$0.6')
    expect(cells[1]).toHaveTextContent('Current period price')
    expect(screen.queryByText(/Starting at/)).not.toBeInTheDocument()
  })
})
