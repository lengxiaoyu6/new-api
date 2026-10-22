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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { Referral } from '..'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})
const clients: QueryClient[] = []
const initialConfig = useSystemConfigStore.getState().config

beforeEach(() => {
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === '/api/user/aff/summary') {
      return {
        data: {
          success: true,
          data: {
            aff_code: 'referral-code',
            aff_quota: 1000000,
            aff_withdrawable_quota: 500000,
            aff_history_quota: 2000000,
            aff_count: 11,
            inviter_reward: 0,
            invitee_reward: 0,
            topup_rebate_percent: 5,
            compliance_confirmed: true,
          },
        },
      }
    }
    const page = Number(config?.params?.p ?? 1)
    let items: unknown[] = []
    if (url === '/api/user/aff/invited') {
      items = [
        {
          id: page,
          username: `invitee-${page}`,
          status: 1,
          created_at: 1700000000,
        },
      ]
    } else if (url === '/api/user/aff/logs') {
      items = [
        {
          id: page,
          user_id: 1,
          created_at: 1700000000,
          type: 1,
          quota: 500000,
          other: JSON.stringify({ kind: page === 1 ? 'topup' : 'register' }),
        },
      ]
    } else if (url?.startsWith('/api/user/aff/withdrawals')) {
      items = [
        {
          id: page,
          user_id: 1,
          request_id: `request-${page}`,
          quota: 500000,
          amount_usd: '1',
          method: 'alipay',
          account_name: 'Recipient',
          account: `payout-${url.endsWith('/all') ? 'admin' : 'personal'}-${page}`,
          status: 'pending',
          review_note: '',
          reviewer_id: 0,
          created_at: 1700000000,
          reviewed_at: 0,
        },
      ]
    }
    return {
      data: { success: true, data: { items, total: 11, page, page_size: 10 } },
    }
  })
})

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState({ config: initialConfig })
  localStorage.clear()
})

function renderReferral(role = 1) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'member', role })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Referral />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return userEvent.setup()
}

it.each([1, 10])(
  'shows only invited users by default and exposes the appropriate tabs for role %s',
  async (role) => {
    renderReferral(role)
    expect(await screen.findByText('invitee-1')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Invited Users' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getAllByRole('tab')).toHaveLength(role >= 10 ? 4 : 3)
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(
      screen.queryByRole('tab', { name: 'Withdrawal review' }) !== null
    ).toBe(role >= 10)
    expect(
      screen.getByRole('textbox', { name: 'Your Referral Link' })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Transfer to Balance' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Request withdrawal' })
    ).toBeEnabled()
  }
)

it.each([
  { tab: 'Invited Users', next: 'Next page', second: 'invitee-2' },
  { tab: 'Earnings Detail', next: 'Next page', second: 'Registration Reward' },
  {
    tab: 'Withdrawal history',
    next: 'Go to next page',
    second: 'payout-personal-2',
  },
])(
  'keeps the selected page in $tab after switching to another table',
  async ({ tab, next, second }) => {
    const user = renderReferral()
    await screen.findByText('invitee-1')
    await user.click(screen.getByRole('tab', { name: tab }))
    const panel = within(screen.getByRole('tabpanel', { name: tab }))
    await user.click(await panel.findByRole('button', { name: next }))
    expect(await panel.findByText(second)).toBeVisible()
    await user.click(
      screen.getByRole('tab', {
        name: tab === 'Invited Users' ? 'Earnings Detail' : 'Invited Users',
      })
    )
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getAllByRole('table')).toHaveLength(1)
    await user.click(screen.getByRole('tab', { name: tab }))
    expect(
      within(screen.getByRole('tabpanel', { name: tab })).getByText(second)
    ).toBeVisible()
    expect(
      within(screen.getByRole('tabpanel', { name: tab })).getByText('2 / 2')
    ).toBeVisible()
  }
)

it('keeps administrator review separate from personal withdrawal history', async () => {
  const user = renderReferral(10)
  await screen.findByText('invitee-1')
  await user.click(screen.getByRole('tab', { name: 'Withdrawal review' }))
  const review = within(
    screen.getByRole('tabpanel', { name: 'Withdrawal review' })
  )
  expect(await review.findByText('payout-admin-1')).toBeVisible()
  expect(review.getByRole('button', { name: 'Mark as paid' })).toBeEnabled()
  await user.click(screen.getByRole('tab', { name: 'Withdrawal history' }))
  const history = within(
    screen.getByRole('tabpanel', { name: 'Withdrawal history' })
  )
  expect(await history.findByText('payout-personal-1')).toBeVisible()
  expect(
    history.queryByRole('button', { name: 'Mark as paid' })
  ).not.toBeInTheDocument()
  expect(screen.getAllByRole('table')).toHaveLength(1)
})

it('supports keyboard navigation between the data tabs', async () => {
  const user = renderReferral()
  await screen.findByText('invitee-1')
  screen.getByRole('tab', { name: 'Invited Users' }).focus()
  await user.keyboard('{ArrowRight}{Enter}')
  expect(screen.getByRole('tab', { name: 'Earnings Detail' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: 'Earnings Detail' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(
    screen.getByRole('tabpanel', { name: 'Earnings Detail' })
  ).toBeVisible()
  expect(screen.getAllByRole('table')).toHaveLength(1)
})

it('shows each empty table only in its selected tab', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: { items: [], total: 0, page: 1, page_size: 10 },
    },
  })
  const user = renderReferral()
  expect(await screen.findByText('No invited users yet')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Earnings Detail' }))
  expect(screen.getByText('No earnings records yet')).toBeVisible()
  expect(screen.queryByText('No invited users yet')).not.toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Withdrawal history' }))
  expect(screen.getByText('No withdrawal requests yet')).toBeVisible()
  expect(screen.queryByText('No earnings records yet')).not.toBeVisible()
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
})
