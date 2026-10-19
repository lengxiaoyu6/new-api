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
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  PlanRecord,
  SelfSubscriptionData,
  UserSubscription,
} from '@/features/subscriptions/types'
import { Wallet } from '@/features/wallet'
import { toIntlLocale } from '@/i18n/languages'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { SubscriptionUsage } from '..'

const now = Math.floor(Date.now() / 1000)
const plan: PlanRecord = {
  plan: {
    id: 1,
    title: 'Professional',
    price_amount: 10,
    currency: 'USD',
    duration_unit: 'month',
    duration_value: 1,
    quota_reset_period: 'daily',
    enabled: true,
    sort_order: 0,
    allow_balance_pay: true,
    allow_wallet_overflow: true,
    max_purchase_per_user: 0,
    total_amount: 50_000_000,
  },
}

function subscription(overrides: Partial<UserSubscription> = {}) {
  return {
    subscription: {
      id: 1,
      user_id: 1,
      plan_id: 1,
      status: 'active',
      start_time: now - 100,
      end_time: now + 86_400,
      amount_total: 50_000_000,
      amount_used: 30_000_000,
      next_reset_time: now + 3600,
      ...overrides,
    },
  }
}

const i18n = createInstance()
let self: SelfSubscriptionData
let plans: PlanRecord[]
let walletQuota: number
let failSelf: boolean
let failPlans: boolean

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    nsSeparator: false,
    resources: { en, fr, ja, ru, vi: viLocale, zhCN: zh, zhTW },
    interpolation: { escapeValue: false },
  })
  self = {
    billing_preference: 'subscription_first',
    subscriptions: [subscription()],
    all_subscriptions: [subscription()],
  }
  plans = [plan]
  walletQuota = 20_000_000
  failSelf = false
  failPlans = false
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/subscription/self') {
      if (failSelf) throw new Error('Subscriptions unavailable')
      return { data: { success: true, data: self } }
    }
    if (url === '/api/subscription/plans') {
      if (failPlans) throw new Error('Plans unavailable')
      return { data: { success: true, data: plans } }
    }
    if (url === '/api/user/self') {
      return { data: { success: true, data: { quota: walletQuota } } }
    }
    if (url === '/api/user/topup/info') {
      return {
        data: {
          success: true,
          data: {
            enable_online_topup: false,
            enable_stripe_topup: false,
            pay_methods: [],
            min_topup: 1,
            stripe_min_topup: 1,
            amount_options: [],
            discount: {},
          },
        },
      }
    }
    if (url === '/api/status') return { data: { success: true, data: {} } }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, message: 'success', data: '1' },
  })
})

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

function renderPage(page = '/subscription-usage') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const root = createRootRoute()
  const routeTree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/subscription-usage',
      component: SubscriptionUsage,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/wallet',
      component: Wallet,
    }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [page] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { client, user: userEvent.setup() }
}

describe('subscription usage page', () => {
  it('shows separate current quotas and keeps expired and cancelled subscriptions collapsed', async () => {
    self.all_subscriptions = [
      subscription(),
      subscription({ id: 2, plan_id: 2, amount_total: 0 }),
      subscription({ id: 3, amount_used: 60_000_000 }),
      subscription({ id: 4, end_time: now - 1 }),
      subscription({ id: 5, status: 'cancelled' }),
    ]
    const { user } = renderPage()
    const current = await screen.findByRole('region', {
      name: 'Current Subscriptions',
    })
    const progress = within(current).getAllByRole('progressbar')
    expect(
      progress.map((element) => element.getAttribute('aria-valuenow'))
    ).toEqual(['60', '100'])
    expect(within(current).getByText('Quota exhausted')).toBeVisible()
    expect(within(current).getByText('Unlimited')).toBeVisible()
    expect(within(current).getByText('Plan Quota: Unlimited')).toBeVisible()
    expect(
      within(current).queryByText('Subscription #4')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Subscribe Now')).not.toBeInTheDocument()
    const history = screen.getByRole('button', { name: 'Subscription History' })
    expect(history).toHaveAttribute('aria-expanded', 'false')
    await user.click(history)
    expect(history).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Subscription #4')).toBeVisible()
    expect(screen.getByText('Cancelled')).toBeVisible()
  })

  it('supports opening plans from the page action and switching tabs with the keyboard', async () => {
    const { user } = renderPage()
    await screen.findByRole('region', { name: 'Current Subscriptions' })
    await user.click(screen.getByRole('button', { name: 'Browse Plans' }))
    expect(
      screen.getByRole('tab', { name: 'Subscription Plans' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      await screen.findByRole('button', { name: 'Subscribe Now' })
    ).toBeVisible()
    screen.getByRole('tab', { name: 'Subscription Plans' }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Usage Overview' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(
      screen.getByRole('region', { name: 'Current Subscriptions' })
    ).toBeVisible()
  })

  it('shows a plan entry when no subscription exists and an empty catalog when no plan is available', async () => {
    self.subscriptions = []
    self.all_subscriptions = []
    plans = []
    const { user } = renderPage()
    expect(await screen.findByText('No Active')).toBeVisible()
    const current = screen.getByRole('region', {
      name: 'Current Subscriptions',
    })
    await user.click(
      within(current).getByRole('button', { name: 'Browse Plans' })
    )
    expect(await screen.findByText('No plans available')).toBeVisible()
  })

  it('explains wallet fallback and disables subscription preferences when no active subscription exists', async () => {
    self = {
      billing_preference: 'subscription_only',
      subscriptions: [],
      all_subscriptions: [],
    }
    const { user } = renderPage()
    expect(
      await screen.findByText(
        'No active subscription covers requests. Wallet balance will be used.'
      )
    ).toBeVisible()
    await user.click(
      screen.getByRole('combobox', { name: 'Billing preference' })
    )
    expect(
      await screen.findByRole('option', { name: 'Subscription Only' })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('option', { name: 'Wallet Only' })
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('shows a loading state and disables refresh while the subscription request is pending', async () => {
    const originalGet = vi.mocked(api.get).getMockImplementation()
    let resolveRequest = (_value: unknown) => {}
    const pending = new Promise((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(api.get).mockImplementation(async (url, config) => {
      if (url === '/api/subscription/self') return pending
      return originalGet?.(url, config)
    })
    renderPage()
    expect(
      await screen.findByRole('status', { name: 'Loading...' })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    await act(async () => {
      resolveRequest({ data: { success: true, data: self } })
      await pending
    })
    expect(
      await screen.findByRole('region', { name: 'Current Subscriptions' })
    ).toBeVisible()
  })

  it('counts historical purchases when a plan has a purchase limit', async () => {
    plans = [{ plan: { ...plan.plan, max_purchase_per_user: 1 } }]
    self.all_subscriptions = [subscription({ end_time: now - 1 })]
    self.subscriptions = []
    const { user } = renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Browse Plans' })
    )
    expect(
      await screen.findByRole('button', { name: 'Limit Reached' })
    ).toBeDisabled()
  })

  it('uses the existing balance purchase dialog and refreshes subscriptions after a successful purchase', async () => {
    self.subscriptions = []
    self.all_subscriptions = []
    vi.mocked(api.post).mockImplementation(async (url) => {
      if (url !== '/api/subscription/balance/pay') {
        throw new Error(`Unexpected payment: ${url}`)
      }
      self = {
        ...self,
        subscriptions: [subscription()],
        all_subscriptions: [subscription()],
      }
      walletQuota -= 5_000_000
      return { data: { success: true } }
    })
    const { user } = renderPage()
    await screen.findByText('No Active')
    await user.click(screen.getAllByRole('button', { name: 'Browse Plans' })[0])
    await user.click(
      await screen.findByRole('button', { name: 'Subscribe Now' })
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Purchase Subscription',
    })
    await user.click(
      within(dialog).getByRole('button', { name: 'Pay with Balance' })
    )
    expect(
      await screen.findByRole('region', { name: 'Current Subscriptions' })
    ).toHaveTextContent('Professional')
    expect(screen.getByRole('tab', { name: 'Usage Overview' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await user.click(screen.getByRole('button', { name: 'Browse Plans' }))
    await user.click(
      await screen.findByRole('button', { name: 'Subscribe Now' })
    )
    const reopened = await screen.findByRole('dialog', {
      name: 'Purchase Subscription',
    })
    expect(reopened).toHaveTextContent('$30')
    expect(api.post).toHaveBeenCalledWith('/api/subscription/balance/pay', {
      plan_id: 1,
    })
  })

  it('keeps a saved billing preference when the server rejects a change', async () => {
    vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: 'Preference update unavailable' },
    })
    const { user } = renderPage()
    const preference = await screen.findByRole('combobox', {
      name: 'Billing preference',
    })
    await user.click(preference)
    await user.click(await screen.findByRole('option', { name: 'Wallet Only' }))
    await waitFor(() => expect(preference).toBeEnabled())
    expect(preference).toHaveTextContent('Subscription First')
  })

  it('uses the server-normalized preference after saving', async () => {
    vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: true, data: { billing_preference: 'wallet_first' } },
    })
    const { user } = renderPage()
    const preference = await screen.findByRole('combobox', {
      name: 'Billing preference',
    })
    await user.click(preference)
    await user.click(await screen.findByRole('option', { name: 'Wallet Only' }))
    await waitFor(() => expect(preference).toHaveTextContent('Wallet First'))
    expect(
      screen.getByText(
        'Wallet balance is used first, followed by subscription quota.'
      )
    ).toBeVisible()
  })

  it('shows a retryable error instead of an empty subscription state when loading fails', async () => {
    failSelf = true
    const { user } = renderPage()
    expect(
      await screen.findByText('Failed to load subscriptions')
    ).toBeVisible()
    expect(screen.queryByText('No Active')).not.toBeInTheDocument()
    failSelf = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('region', { name: 'Current Subscriptions' })
    ).toHaveTextContent('Professional')
  })

  it('keeps current quota visible when the catalog fails and lets the catalog retry', async () => {
    failPlans = true
    const { user } = renderPage()
    expect(
      await screen.findByRole('region', { name: 'Current Subscriptions' })
    ).toHaveTextContent('Subscription #1')
    await user.click(screen.getByRole('button', { name: 'Browse Plans' }))
    expect(
      await screen.findByText('Failed to load subscription plans')
    ).toBeVisible()
    failPlans = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('button', { name: 'Subscribe Now' })
    ).toBeEnabled()
  })

  it('updates copy and formats dates for all interface languages and an invalid language fallback', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Current Subscriptions' })
    for (const [language, title, locale] of [
      ['zhCN', '订阅用量', 'zh-CN'],
      ['zhTW', '訂閱用量', 'zh-TW'],
      ['en', 'Subscription Usage', 'en'],
      ['fr', 'Utilisation des abonnements', 'fr'],
      ['ja', 'サブスクリプション使用量', 'ja'],
      ['ru', 'Использование подписок', 'ru'],
      ['vi', 'Mức sử dụng gói đăng ký', 'vi'],
      ['invalid-language-!', 'Subscription Usage', 'en'],
    ]) {
      await act(() => i18n.changeLanguage(language))
      expect(screen.getByRole('heading', { name: title })).toBeVisible()
      expect(
        screen.getByText(
          new Date((now + 3600) * 1000).toLocaleString(toIntlLocale(locale)),
          { normalizer: (text) => text }
        )
      ).toBeVisible()
    }
  })

  it('keeps recharge in the wallet and opens subscription usage through its dedicated link', async () => {
    const { user } = renderPage('/wallet')
    const link = await screen.findByRole('link', {
      name: 'View subscription usage',
    })
    expect(link).toHaveAttribute('href', '/subscription-usage')
    expect(
      screen.queryByRole('tab', { name: 'Usage Overview' })
    ).not.toBeInTheDocument()
    await user.click(link)
    expect(
      await screen.findByRole('region', { name: 'Current Subscriptions' })
    ).toHaveTextContent('Professional')
  })
})
