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
import { readFileSync } from 'node:fs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { assert, describe, expect, it, vi } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { Pricing } from '..'
import { EmptyState } from '../components/empty-state'
import { ModelPerfBadge } from '../components/model-perf-badge'
import { PricingHeader } from '../components/pricing-header'
import { SearchBar } from '../components/search-bar'
import type { PricingData, PricingModel, PricingVendor } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

function SearchExample() {
  const [value, setValue] = useState('')
  return (
    <SearchBar value={value} onChange={setValue} onClear={() => setValue('')} />
  )
}

function renderPricingPage(
  initialUrl = '/pricing/',
  models: PricingModel[] = [],
  usableGroup: PricingData['usable_group'] = {},
  vendors: PricingVendor[] = [],
  i18n?: ReturnType<typeof createInstance>
) {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false, gcTime: 0 } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {})
  client.setQueryData(['pricing'], {
    data: models,
    vendors,
    usable_group: usableGroup,
    group_ratio: Object.fromEntries(
      Object.entries(usableGroup).map(([group, value]) => [
        group,
        typeof value === 'string' ? 1 : value.ratio,
      ])
    ),
  })
  client.setQueryData(['perf-metrics-summary', 24], {
    success: true,
    data: { models: [] },
  })
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/pricing/',
    component: Pricing,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  })
  const page = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const result = render(
    i18n ? <I18nextProvider i18n={i18n}>{page}</I18nextProvider> : page
  )
  return { ...result, client }
}

describe('catalog presentation', () => {
  it('opens model pricing for the current group after changing the catalog selection', async () => {
    const user = userEvent.setup()
    const { unmount, client } = renderPricingPage(
      '/pricing/',
      [
        {
          id: 1,
          model_name: 'group-details-model',
          quota_type: 0,
          model_ratio: 1,
          completion_ratio: 2,
          enable_groups: ['az-gpt', 'premium'],
        },
      ],
      {
        'az-gpt': { desc: 'AZ', ratio: 1 },
        premium: { desc: 'Premium', ratio: 2 },
      }
    )

    try {
      await user.click(
        await screen.findByRole('button', { name: 'group-details-model' })
      )
      const firstDrawer = await screen.findByRole('dialog')
      const firstPrices = within(firstDrawer)
        .getByText('Pricing by Group')
        .closest('section')
      assert.isNotNull(firstPrices)
      expect(within(firstPrices).getByText('az-gpt')).toBeVisible()
      expect(within(firstPrices).queryByText('premium')).not.toBeInTheDocument()

      await user.click(
        within(firstDrawer).getByRole('button', { name: 'Close' })
      )
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
      await user.click(screen.getByTitle('premium'))
      await user.click(
        screen.getByRole('button', { name: 'group-details-model' })
      )
      const secondDrawer = await screen.findByRole('dialog')
      const secondPrices = within(secondDrawer)
        .getByText('Pricing by Group')
        .closest('section')
      assert.isNotNull(secondPrices)
      expect(within(secondPrices).getByText('premium')).toBeVisible()
      expect(within(secondPrices).queryByText('az-gpt')).not.toBeInTheDocument()
    } finally {
      unmount()
      client.clear()
    }
  })

  it.each(['desktop', 'mobile'])(
    'shows the selected group description between search and model results in the %s layout',
    async (viewport) => {
      if (viewport === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const style = document.createElement('style')
      style.textContent = readFileSync('src/styles/gateway-catalog.css', 'utf8')
      document.head.append(style)
      const description =
        'Standard {{custom}} access with long-provider-specific-options-without-spaces'
      const { unmount, client } = renderPricingPage(
        '/pricing/',
        [
          {
            id: 1,
            model_name: 'group-description-model',
            quota_type: 0,
            model_ratio: 1,
            completion_ratio: 4,
            enable_groups: ['az-gpt', 'premium'],
          },
        ],
        {
          'az-gpt': description,
          premium: { desc: 'Priority model access', ratio: 2 },
        }
      )
      const user = userEvent.setup()

      try {
        const results = await screen.findByRole('region', { name: 'Models' })
        const notice = within(results).getByRole('status', {
          name: 'Group description',
        })
        const copy = within(notice).getByText(description)
        expect(copy).toBeVisible()
        expect(getComputedStyle(copy).whiteSpace).toBe('pre-line')
        expect(getComputedStyle(copy).overflowWrap).toBe('anywhere')
        const search = within(results).getByRole('textbox', {
          name: 'Search models',
        })
        const model = within(results).getByRole('button', {
          name: 'group-description-model',
        })
        expect(
          search.compareDocumentPosition(notice) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
        expect(
          notice.compareDocumentPosition(model) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
        expect(
          within(
            screen.getByRole('complementary', { hidden: true })
          ).queryByText(description)
        ).not.toBeInTheDocument()
        if (viewport === 'mobile') {
          await user.click(screen.getByRole('combobox', { name: 'Group' }))
          const options = await screen.findByRole('listbox')
          await user.click(
            within(options).getByRole('option', { name: 'premium' })
          )
        } else {
          screen.getByTitle('premium').focus()
          await user.keyboard('{Enter}')
        }
        expect(within(notice).getByText('Priority model access')).toBeVisible()
        expect(within(notice).queryByText(description)).not.toBeInTheDocument()
      } finally {
        unmount()
        client.clear()
        style.remove()
      }
    }
  )

  it.each([
    ['/pricing/?group=all', { premium: 'Priority access' }],
    ['/pricing/?group=missing', { premium: 'Priority access' }],
    ['/pricing/', { premium: '' }],
    ['/pricing/', { premium: '   \n ' }],
  ])(
    'omits the group notice when %s has no selected description',
    async (url, groups) => {
      const { unmount, client } = renderPricingPage(url, [], groups)
      try {
        await screen.findByRole('main')
        expect(
          screen.queryByRole('status', { name: 'Group description' })
        ).not.toBeInTheDocument()
      } finally {
        unmount()
        client.clear()
      }
    }
  )

  it('updates built-in group descriptions on language changes and preserves administrator text', async () => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { translation: { 'User group': 'User group' } },
        fr: { translation: { 'User group': 'Groupe utilisateur' } },
      },
    })
    const custom = 'Custom {{provider}} access'
    const { unmount, client } = renderPricingPage(
      '/pricing/',
      [],
      { 'az-gpt': 'User group', premium: custom },
      [],
      i18n
    )

    try {
      expect(await screen.findByText('User group')).toBeVisible()
      await act(() => i18n.changeLanguage('fr'))
      expect(screen.getByText('Groupe utilisateur')).toBeVisible()
      await userEvent.click(screen.getByTitle('premium'))
      expect(screen.getByText(custom)).toBeVisible()
    } finally {
      unmount()
      client.clear()
    }
  })

  it('counts all published models across groups and listed providers regardless of the active filters', async () => {
    const base: PricingModel = {
      id: 1,
      model_name: 'alpha-chat',
      vendor_id: 1,
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 4,
      enable_groups: ['az-gpt', 'premium'],
    }
    const user = userEvent.setup()
    const { unmount, client } = renderPricingPage(
      '/pricing/',
      [
        base,
        { ...base, id: 2, model_name: 'alpha-code' },
        {
          ...base,
          id: 3,
          model_name: 'beta-chat',
          vendor_id: 2,
          enable_groups: ['az-gpt'],
        },
        {
          ...base,
          id: 4,
          model_name: 'premium-chat',
          vendor_id: 3,
          enable_groups: ['premium'],
        },
        {
          ...base,
          id: 5,
          model_name: 'unassigned-model',
          vendor_id: undefined,
          enable_groups: ['premium'],
        },
        {
          ...base,
          id: 6,
          model_name: 'unknown-provider-model',
          vendor_id: 999,
          enable_groups: ['premium'],
        },
        {
          ...base,
          id: 7,
          model_name: 'default-model',
          vendor_id: 4,
          enable_groups: ['default'],
        },
      ],
      {
        'az-gpt': { desc: 'AZ', ratio: 1 },
        premium: { desc: 'Premium', ratio: 2 },
      },
      [
        { id: 1, name: 'Alpha' },
        { id: 2, name: 'Beta' },
        { id: 3, name: 'Premium' },
        { id: 4, name: 'Default' },
        { id: 5, name: 'Unused' },
      ]
    )

    try {
      const heading = await screen.findByRole('heading', {
        name: 'Model Square',
      })
      const header = heading.closest('header')
      assert(header)
      expect(
        within(header)
          .getAllByRole('definition')
          .map((count) => count.textContent)
      ).toEqual(['7', '4'])
      expect(screen.queryByTitle('Unused')).not.toBeInTheDocument()
      for (const name of ['Alpha', 'Beta', 'Premium', 'Default']) {
        expect(screen.getByTitle(name)).toBeVisible()
      }
      expect(
        screen.queryByRole('button', { name: 'premium-chat' })
      ).not.toBeInTheDocument()

      await user.click(screen.getByTitle('premium'))
      expect(
        within(header)
          .getAllByRole('definition')
          .map((count) => count.textContent)
      ).toEqual(['7', '4'])
      expect(screen.getByRole('button', { name: 'premium-chat' })).toBeVisible()

      await user.click(screen.getByTitle('Alpha'))
      expect(
        within(header)
          .getAllByRole('definition')
          .map((count) => count.textContent)
      ).toEqual(['7', '4'])
      expect(
        screen.queryByRole('button', { name: 'premium-chat' })
      ).not.toBeInTheDocument()

      const search = screen.getByRole('textbox', { name: 'Search models' })
      await user.type(search, 'code')
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'alpha-chat' })
        ).not.toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: 'alpha-code' })).toBeVisible()
      expect(
        within(header)
          .getAllByRole('definition')
          .map((count) => count.textContent)
      ).toEqual(['7', '4'])
      await user.clear(search)
      await user.type(search, 'no-match')
      expect(await screen.findByText('No models found')).toBeVisible()
      expect(
        within(header)
          .getAllByRole('definition')
          .map((count) => count.textContent)
      ).toEqual(['7', '4'])
    } finally {
      unmount()
      client.clear()
    }
  })

  it('shows zero totals for an empty catalog and updates both totals when published data arrives', async () => {
    const vendors = [
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Unused' },
    ]
    const { unmount, client } = renderPricingPage('/pricing/', [], {}, vendors)

    try {
      const heading = await screen.findByRole('heading', {
        name: 'Model Square',
      })
      const header = heading.closest('header')
      assert(header)
      expect(
        within(header)
          .getAllByRole('definition')
          .map((count) => count.textContent)
      ).toEqual(['0', '0'])
      act(() =>
        client.setQueryData(['pricing'], {
          vendors,
          data: [
            {
              id: 1,
              model_name: 'alpha-model',
              vendor_id: 1,
              quota_type: 0,
              model_ratio: 1,
              completion_ratio: 4,
              enable_groups: ['default'],
            },
          ],
        })
      )
      expect(
        await screen.findByRole('button', { name: 'alpha-model' })
      ).toBeVisible()
      expect(
        within(header)
          .getAllByRole('definition')
          .map((count) => count.textContent)
      ).toEqual(['1', '1'])
      expect(screen.queryByTitle('Unused')).not.toBeInTheDocument()
    } finally {
      unmount()
      client.clear()
    }
  })

  it.each(['gateway-catalog-pricing-table', 'gateway-catalog-mobile-list'])(
    'reserves consistent chart and percentage columns for different success rates and missing data in %s',
    (layoutClass) => {
      const style = document.createElement('style')
      style.textContent = readFileSync('src/styles/gateway-catalog.css', 'utf8')
      document.head.append(style)
      const { unmount } = render(
        <div className={layoutClass}>
          {[100, 99.82, undefined].map((rate) => (
            <ModelPerfBadge
              key={rate ?? 'missing'}
              variant='availability'
              perf={
                rate == null
                  ? undefined
                  : {
                      avg_latency_ms: 0,
                      avg_tps: 0,
                      success_rate: rate,
                      window_end: 1792468800,
                      recent_success_series: [
                        { ts: 1792468800, success_rate: rate },
                      ],
                    }
              }
            />
          ))}
        </div>
      )

      try {
        const badges = screen.getAllByLabelText(
          'Performance metrics for the last 24 hours'
        )
        expect(badges).toHaveLength(3)
        for (const badge of badges) {
          const badgeStyle = getComputedStyle(badge)
          expect(badgeStyle.display).toBe('grid')
          expect(badgeStyle.gridTemplateColumns).toBe('minmax(0, 1fr) 4rem')
          const bars = within(badge).getByRole('img')
          expect(getComputedStyle(bars).width).toBe('100%')
          const rate = badge.querySelector('.gateway-catalog-status-rate')
          assert(rate)
          const rateStyle = getComputedStyle(rate)
          expect(rateStyle.width).toBe('4rem')
          expect(rateStyle.gridTemplateColumns).toBe('0.375rem minmax(0, 1fr)')
          expect(rateStyle.textAlign).toBe('right')
          expect(rateStyle.whiteSpace).toBe('nowrap')
        }
        expect(screen.getByText('100%')).toBeVisible()
        expect(screen.getByText('99.82%')).toBeVisible()
        expect(screen.getByText('—')).toBeVisible()
      } finally {
        unmount()
        style.remove()
      }
    }
  )

  it('keeps the background surface at full page width while constraining the content width', async () => {
    const style = document.createElement('style')
    style.textContent =
      readFileSync('src/styles/gateway-home.css', 'utf8') +
      readFileSync('src/styles/gateway-catalog.css', 'utf8')
    document.head.append(style)
    const { unmount, client } = renderPricingPage()

    try {
      const content = await screen.findByRole('main')
      const surface = content.parentElement
      assert(surface)
      expect(getComputedStyle(surface).width).toBe('100%')
      expect(getComputedStyle(content).maxWidth).toBe('1440px')
    } finally {
      unmount()
      client.clear()
      style.remove()
    }
  })

  it.each(['desktop', 'mobile'])(
    'defaults to the %s layout without display controls',
    async (viewport) => {
      if (viewport === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const { unmount, client } = renderPricingPage('/pricing/', [
        {
          id: 1,
          model_name: 'catalog-model',
          quota_type: 0,
          model_ratio: 1,
          completion_ratio: 6,
          enable_groups: ['default'],
        },
      ])
      try {
        expect(
          await screen.findByRole('button', { name: 'catalog-model' })
        ).toBeVisible()
        if (viewport === 'mobile') {
          expect(screen.queryByRole('table')).not.toBeInTheDocument()
          expect(screen.getByText('Input price /1M tokens')).toBeVisible()
        } else {
          expect(screen.getByRole('table')).toBeVisible()
        }
        for (const name of [
          'Standard',
          'Recharge',
          '/1M',
          '/1K',
          'Name',
          'Card view',
          'Table view',
        ]) {
          expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
        }
      } finally {
        unmount()
        client.clear()
      }
    }
  )

  it.each(['desktop', 'mobile'])(
    'keeps search and the price switch above model results and shows base prices in the %s layout',
    async (viewport) => {
      if (viewport === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 767px)' || original(query).matches,
        }))
      }
      const user = userEvent.setup()
      const { unmount, client } = renderPricingPage(
        '/pricing/',
        [
          {
            id: 1,
            model_name: 'base-price-model',
            quota_type: 0,
            model_ratio: 1.5,
            completion_ratio: 4,
            cache_ratio: 0.1,
            create_cache_ratio: 1.25,
            enable_groups: ['az-gpt', 'premium'],
          },
        ],
        {
          'az-gpt': { desc: 'AZ', ratio: 0.6 },
          premium: { desc: 'Premium', ratio: 2 },
        }
      )

      try {
        const results = await screen.findByRole('region', { name: 'Models' })
        const search = within(results).getByRole('textbox', {
          name: 'Search models',
        })
        expect(search).toBeVisible()
        expect(
          within(results).getByRole('group', { name: 'Price display mode' })
        ).toBeVisible()
        const site = screen.getByRole('button', { name: 'Site price' })
        const official = screen.getByRole('button', { name: 'Official price' })
        expect(site).toHaveAttribute('aria-pressed', 'true')
        for (const value of ['$1.8', '$7.2', '$2.25', '$0.18']) {
          expect(
            within(results).getByText(value, { exact: true })
          ).toBeVisible()
        }

        official.focus()
        await user.keyboard('{Enter}')
        expect(official).toHaveAttribute('aria-pressed', 'true')
        for (const value of ['$3', '$12', '$3.75', '$0.3']) {
          expect(
            within(results).getByText(value, { exact: true })
          ).toBeVisible()
        }
        await user.click(official)
        expect(official).toHaveAttribute('aria-pressed', 'true')
        await user.click(site)
        expect(within(results).getByText('$1.8', { exact: true })).toBeVisible()
        expect(screen.getByTitle('az-gpt')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        await user.type(search, 'missing')
        expect(
          await within(results).findByText('No models found')
        ).toBeVisible()
        expect(official).toBeVisible()
        await user.click(screen.getByRole('button', { name: 'Clear search' }))
        expect(
          await within(results).findByRole('button', {
            name: 'base-price-model',
          })
        ).toBeVisible()
      } finally {
        unmount()
        client.clear()
      }
    }
  )

  it('omits recharge conversion from official prices and preserves the selected group when switching back', async () => {
    const user = userEvent.setup()
    const { unmount, client } = renderPricingPage(
      '/pricing/?rechargePrice=true',
      [
        {
          id: 1,
          model_name: 'recharge-price-model',
          quota_type: 0,
          model_ratio: 1.5,
          completion_ratio: 4,
          enable_groups: ['az-gpt', 'premium'],
        },
      ],
      {
        'az-gpt': { desc: 'AZ', ratio: 0.6 },
        premium: { desc: 'Premium', ratio: 2 },
      }
    )
    try {
      await screen.findByRole('button', { name: 'recharge-price-model' })
      act(() => {
        client.setQueryData(STATUS_QUERY_KEY, {
          price: 0.5,
          usd_exchange_rate: 1,
        })
      })
      expect(await screen.findByRole('cell', { name: '$0.9' })).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Official price' }))
      expect(screen.getByRole('cell', { name: '$3' })).toBeVisible()
      await user.click(screen.getByTitle('premium'))
      expect(screen.getByRole('cell', { name: '$3' })).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Site price' }))
      expect(screen.getByRole('cell', { name: '$3' })).toBeVisible()
      expect(screen.getByTitle('premium')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await user.click(screen.getByTitle('az-gpt'))
      expect(screen.getByRole('cell', { name: '$0.9' })).toBeVisible()
    } finally {
      unmount()
      client.clear()
    }
  })

  it.each([
    ['/pricing/', 'az-gpt', 'az-model', 'premium-model'],
    ['/pricing/?group=premium', 'premium', 'premium-model', 'az-model'],
  ])(
    'selects the first visible group unless %s specifies a group',
    async (url, selectedGroup, shownModel, hiddenModel) => {
      const base: PricingModel = {
        id: 1,
        model_name: 'az-model',
        quota_type: 0,
        model_ratio: 1,
        completion_ratio: 4,
        enable_groups: ['az-gpt'],
      }
      const user = userEvent.setup()
      const { unmount, client } = renderPricingPage(
        url,
        [
          base,
          {
            ...base,
            id: 2,
            model_name: 'premium-model',
            enable_groups: ['premium'],
          },
        ],
        {
          premium: { desc: 'Premium', ratio: 2 },
          default: { desc: 'Default', ratio: 1 },
          GLM: { desc: 'GLM', ratio: 0.5 },
          'az-gpt': { desc: 'AZ', ratio: 0.6 },
          auto: { desc: 'Auto', ratio: 1 },
        }
      )

      try {
        expect(
          await screen.findByRole('button', { name: shownModel })
        ).toBeVisible()
        expect(screen.getByTitle(selectedGroup)).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        expect(
          screen.queryByRole('button', { name: hiddenModel })
        ).not.toBeInTheDocument()
        if (selectedGroup === 'az-gpt') {
          expect(screen.getByRole('cell', { name: '$1.2' })).toBeVisible()
        }
        await user.click(screen.getByTitle(selectedGroup))
        expect(
          await screen.findByRole('button', { name: hiddenModel })
        ).toBeVisible()
        expect(screen.getByTitle(selectedGroup)).toHaveAttribute(
          'aria-pressed',
          'false'
        )
      } finally {
        unmount()
        client.clear()
      }
    }
  )

  it('selects the first group when catalog data arrives and preserves a later manual selection on refresh', async () => {
    const user = userEvent.setup()
    const { unmount, client } = renderPricingPage()
    const model: PricingModel = {
      id: 1,
      model_name: 'async-group-model',
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 4,
      enable_groups: ['premium', 'az-gpt'],
    }
    const pricing = {
      data: [model],
      vendors: [],
      usable_group: {
        premium: { desc: 'Premium', ratio: 2 },
        'az-gpt': { desc: 'AZ', ratio: 0.6 },
      },
    }

    try {
      await screen.findByRole('main')
      act(() => client.setQueryData(['pricing'], pricing))
      expect(
        await screen.findByRole('button', { name: /^az-gpt/ })
      ).toHaveAttribute('aria-pressed', 'true')
      await user.click(screen.getByRole('button', { name: /^premium/ }))
      act(() =>
        client.setQueryData(['pricing'], {
          ...pricing,
          usable_group: {
            ...pricing.usable_group,
            'aa-group': { desc: 'AA', ratio: 1 },
          },
        })
      )
      expect(
        await screen.findByRole('button', { name: /^aa-group/ })
      ).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('button', { name: /^premium/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    } finally {
      unmount()
      client.clear()
    }
  })

  it.each(['desktop', 'mobile'])(
    'searches across groups, lists matching groups, and selects their first group in the %s layout',
    async (viewport) => {
      if (viewport === 'mobile') {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches:
            query === '(max-width: 767px)' ||
            query === '(max-width: 640px)' ||
            original(query).matches,
        }))
      }
      const base: PricingModel = {
        id: 1,
        model_name: 'az-model',
        quota_type: 0,
        model_ratio: 1,
        completion_ratio: 4,
        enable_groups: ['az-gpt'],
      }
      const user = userEvent.setup()
      const { unmount, client } = renderPricingPage(
        '/pricing/?group=gamma',
        [
          base,
          {
            ...base,
            id: 2,
            model_name: 'needle-basic',
            enable_groups: ['beta'],
          },
          {
            ...base,
            id: 3,
            model_name: 'needle-pro',
            enable_groups: ['gamma', 'beta', 'private', 'default', 'auto'],
          },
        ],
        {
          gamma: { desc: 'Gamma access', ratio: 3 },
          default: { desc: 'Default', ratio: 1 },
          beta: { desc: 'Beta access', ratio: 2 },
          'az-gpt': { desc: 'AZ access', ratio: 1 },
          auto: { desc: 'Auto', ratio: 1 },
        }
      )

      try {
        await screen.findByRole('button', { name: 'needle-pro' })
        const sidebar = within(
          screen.getByRole('complementary', { hidden: true })
        )
        const search = screen.getByRole('textbox', { name: 'Search models' })
        await user.type(search, 'needle')

        expect(
          await screen.findByRole('button', { name: 'needle-basic' })
        ).toBeVisible()
        expect(sidebar.queryByTitle('az-gpt')).not.toBeInTheDocument()
        expect(sidebar.getByTitle('beta')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        expect(sidebar.getByTitle('gamma')).toHaveAttribute(
          'aria-pressed',
          'false'
        )
        for (const group of ['private', 'default', 'auto']) {
          expect(sidebar.queryByTitle(group)).not.toBeInTheDocument()
        }
        expect(
          screen.getByRole('status', { name: 'Group description' })
        ).toHaveTextContent('Beta access')

        if (viewport === 'mobile') {
          const selector = screen.getByRole('combobox', { name: 'Group' })
          expect(selector).toHaveTextContent('beta')
          await user.click(selector)
          const options = await screen.findByRole('listbox')
          expect(
            within(options)
              .getAllByRole('option')
              .map((option) => option.textContent)
          ).toEqual(['beta', 'gamma'])
          await user.click(
            within(options).getByRole('option', { name: 'gamma' })
          )
        } else {
          await user.click(sidebar.getByTitle('gamma'))
        }
        expect(sidebar.getByTitle('gamma')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        expect(
          screen.queryByRole('button', { name: 'needle-basic' })
        ).not.toBeInTheDocument()
        expect(
          screen.getByRole('status', { name: 'Group description' })
        ).toHaveTextContent('Gamma access')

        await user.type(search, '-pro')
        await waitFor(() => {
          expect(sidebar.getByTitle('beta')).toHaveAttribute(
            'aria-pressed',
            'true'
          )
          expect(
            screen.queryByRole('button', { name: 'needle-basic' })
          ).not.toBeInTheDocument()
        })
        expect(screen.getByRole('button', { name: 'needle-pro' })).toBeVisible()

        await user.click(screen.getByRole('button', { name: 'Clear search' }))
        expect(
          await screen.findByRole('button', { name: 'az-model' })
        ).toBeVisible()
        expect(sidebar.getByTitle('az-gpt')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        expect(sidebar.getByTitle('beta')).toBeInTheDocument()
        expect(sidebar.getByTitle('gamma')).toBeInTheDocument()
      } finally {
        unmount()
        client.clear()
      }
    }
  )

  it('finds models outside the initial group and hides groups and their notice when no public model matches', async () => {
    const base: PricingModel = {
      id: 1,
      model_name: 'az-model',
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 4,
      enable_groups: ['az-gpt'],
    }
    const user = userEvent.setup()
    const { unmount, client } = renderPricingPage(
      '/pricing/',
      [
        base,
        {
          ...base,
          id: 2,
          model_name: 'remote-model',
          enable_groups: ['premium'],
        },
        {
          ...base,
          id: 3,
          model_name: 'private-model',
          enable_groups: ['default', 'private'],
        },
      ],
      { 'az-gpt': 'AZ access', premium: 'Premium access' }
    )

    try {
      await screen.findByRole('button', { name: 'az-model' })
      const search = screen.getByRole('textbox', { name: 'Search models' })
      await user.type(search, 'remote')
      expect(
        await screen.findByRole('button', { name: 'remote-model' })
      ).toBeVisible()
      expect(screen.queryByTitle('az-gpt')).not.toBeInTheDocument()
      expect(screen.getByTitle('premium')).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      await user.clear(search)
      await user.type(search, 'private')
      expect(await screen.findByText('No models found')).toBeVisible()
      const sidebar = within(
        screen.getByRole('complementary', { hidden: true })
      )
      expect(sidebar.queryByRole('button', { name: 'Groups' })).toBeNull()
      expect(screen.queryByRole('combobox', { name: 'Group' })).toBeNull()
      expect(
        screen.queryByRole('status', { name: 'Group description' })
      ).toBeNull()
      expect(
        screen.queryByRole('button', { name: 'private-model' })
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear search' }))
      expect(
        await screen.findByRole('button', { name: 'az-model' })
      ).toBeVisible()
      expect(screen.getByTitle('az-gpt')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByTitle('premium')).toBeInTheDocument()
    } finally {
      unmount()
      client.clear()
    }
  })

  it('wraps long model names without clipping their text or hiding the pricing and copy actions', async () => {
    const modelName =
      'provider/very-long-model-name-with-detailed-reasoning-preview-version-20261020'
    const style = document.createElement('style')
    style.textContent = readFileSync('src/styles/gateway-catalog.css', 'utf8')
    document.head.append(style)
    const { unmount, client } = renderPricingPage('/pricing/', [
      {
        id: 1,
        model_name: modelName,
        icon: 'OpenAI',
        quota_type: 0,
        model_ratio: 1,
        completion_ratio: 4,
        enable_groups: ['default'],
        billing_mode: 'tiered_expr',
        billing_expr:
          'len < 1000 ? tier("short", p * 2 + c * 8) : tier("long", p * 4 + c * 12)',
      },
    ])

    try {
      const name = await screen.findByRole('button', { name: modelName })
      const text = name.querySelector('span:last-child')
      assert(text)
      const textStyle = getComputedStyle(text)
      expect(textStyle.whiteSpace).toBe('normal')
      expect(textStyle.overflow).toBe('visible')
      expect(textStyle.maxWidth).toBe('none')
      expect(textStyle.overflowWrap).toBe('anywhere')
      assert(name.parentElement)
      expect(
        Number.parseFloat(getComputedStyle(name.parentElement).minWidth)
      ).toBeGreaterThanOrEqual(320)
      expect(name).toHaveTextContent(modelName)
      expect(
        screen.getByRole('button', { name: `Tiered pricing · ${modelName}` })
      ).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Copy model name' })
      ).toBeVisible()
    } finally {
      unmount()
      client.clear()
      style.remove()
    }
  })

  it('keeps the heading visible during loading and replaces pending counts with catalog totals', () => {
    const { container, rerender } = render(
      <PricingHeader modelCount={0} vendorCount={0} loading />
    )
    expect(
      screen.getByRole('heading', { name: 'Model Square', level: 1 })
    ).toBeVisible()
    expect(container.querySelector('dl')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('0')).not.toBeInTheDocument()

    rerender(<PricingHeader modelCount={42} vendorCount={6} loading={false} />)
    expect(container.querySelector('dl')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByText('42')).toBeVisible()
    expect(screen.getByText('6')).toBeVisible()
  })

  it.each([
    ['en', '12,345'],
    ['zhCN', '12,345'],
    ['zhTW', '12,345'],
    ['fr', '12\u202f345'],
    ['ja', '12,345'],
    ['ru', '12\u00a0345'],
    ['vi', '12.345'],
    ['invalid_locale', Intl.NumberFormat().format(12345)],
  ])(
    'formats catalog counts for %s without invalid Intl language tags',
    async (language, expected) => {
      const i18n = createInstance()
      await i18n.use(initReactI18next).init({
        lng: language,
        fallbackLng: false,
        resources: {
          [language]: {
            translation: { Models: 'Models', Providers: 'Providers' },
          },
        },
      })
      render(
        <I18nextProvider i18n={i18n}>
          <PricingHeader modelCount={12345} vendorCount={6} loading={false} />
        </I18nextProvider>
      )
      expect(
        screen.getByText(expected, { normalizer: (content) => content })
      ).toBeVisible()
    }
  )

  it('updates number formatting when the interface language changes', async () => {
    const i18n = createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: {
        en: { translation: { Models: 'Models', Providers: 'Providers' } },
        fr: { translation: { Models: 'Modèles', Providers: 'Fournisseurs' } },
      },
    })
    render(
      <I18nextProvider i18n={i18n}>
        <PricingHeader modelCount={12345} vendorCount={6} loading={false} />
      </I18nextProvider>
    )
    expect(screen.getByText('12,345')).toBeVisible()
    await act(() => i18n.changeLanguage('fr'))
    expect(
      screen.getByText('12\u202f345', { normalizer: (content) => content })
    ).toBeVisible()
    expect(screen.getByText('Modèles')).toBeVisible()
  })

  it('supports keyboard search focus, full model names, clearing, and Escape', async () => {
    const user = userEvent.setup()
    render(<SearchExample />)
    const input = screen.getByRole('textbox', { name: 'Search models' })
    await user.keyboard('{Control>}k{/Control}')
    expect(input).toHaveFocus()
    await user.paste('provider/model-with-a-long-version-name-20261020')
    expect(input).toHaveValue(
      'provider/model-with-a-long-version-name-20261020'
    )
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(input).toHaveValue('')
    await user.keyboard('{Meta>}k{/Meta}')
    expect(input).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(input).not.toHaveFocus()
  })

  it('offers a reset for an unmatched search and removes it for an empty catalog', async () => {
    const user = userEvent.setup()
    const onClearFilters = vi.fn()
    const { rerender } = render(
      <EmptyState
        searchQuery='missing-model'
        hasActiveFilters={false}
        onClearFilters={onClearFilters}
      />
    )
    expect(screen.getByText(/missing-model/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }))
    expect(onClearFilters).toHaveBeenCalledOnce()
    rerender(
      <EmptyState hasActiveFilters={false} onClearFilters={onClearFilters} />
    )
    expect(screen.getByText('No models found')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
