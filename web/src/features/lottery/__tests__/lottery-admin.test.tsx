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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { LotteryAdmin } from '../admin'
import type { LotteryAdminActivity, LotteryAdminVersion } from '../types'

const activity: LotteryAdminActivity = {
  id: 7,
  name: 'Evening lottery',
  start_at: 1,
  end_at: 4_102_444_800,
  consume_start_at: 1,
  consume_end_at: 4_102_444_800,
  status: 'draft',
  max_attempts: 2,
}

const publishedVersion: LotteryAdminVersion = {
  id: 3,
  activity_id: activity.id,
  revision: 1,
  status: 'published',
  threshold_quota: 0,
  quota_per_unit: 500_000,
  title: { en: activity.name },
  rule_text: { en: 'Spend and draw.' },
  published_at: 1,
  prizes: [
    {
      id: 11,
      code: 'balance-2',
      type: 'balance',
      balance_amount: 2,
      balance_quota: 1_000_000,
      total_stock: 10,
      issued_stock: 0,
      title: { en: '2 balance' },
      description: {},
      weight: 500_000,
      daily_limit: 0,
      sort_order: 0,
      enabled: true,
    },
    {
      id: 12,
      code: 'thanks',
      type: 'thanks',
      balance_amount: 0,
      balance_quota: 0,
      total_stock: 0,
      issued_stock: 0,
      title: { en: 'Thanks' },
      description: {},
      weight: 500_000,
      daily_limit: 0,
      sort_order: 1,
      enabled: true,
    },
  ],
}

function renderLotteryAdmin(initialVersions: LotteryAdminVersion[]) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  let versions = initialVersions
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/lottery/admin/activities') {
      return { data: { success: true, data: [activity] } } as never
    }
    if (url === `/api/lottery/admin/activities/${activity.id}/versions`) {
      return { data: { success: true, data: versions } } as never
    }
    return {
      data: {
        success: true,
        data: { items: [], total: 0, page: 1, page_size: 20 },
      },
    } as never
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <LotteryAdmin />
    </QueryClientProvider>
  )
  return {
    client,
    setVersions: (value: LotteryAdminVersion[]) => (versions = value),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('keeps the initial prize configuration available after the activity start time', async () => {
  const { client, setVersions } = renderLotteryAdmin([])
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === `/api/lottery/admin/activities/${activity.id}/versions`) {
      setVersions([{ ...publishedVersion, id: 4, status: 'draft' }])
    }
    return { data: { success: true } } as never
  })
  const user = userEvent.setup()

  expect(await screen.findByText('Configure prizes')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save configuration' }))
  await waitFor(() => expect(post).toHaveBeenCalled())
  const select = await screen.findByRole('combobox', { name: 'Balance prize' })
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: /balance-2/ }))
  expect(select).toHaveTextContent('balance-2')

  client.clear()
})

it('allows a configured balance prize to be selected for stock adjustment', async () => {
  const { client } = renderLotteryAdmin([publishedVersion])
  const user = userEvent.setup()
  const select = await screen.findByRole('combobox', { name: 'Balance prize' })

  await user.click(select)
  await user.click(await screen.findByRole('option', { name: /balance-2/ }))

  expect(select).toHaveTextContent('balance-2')

  client.clear()
})
