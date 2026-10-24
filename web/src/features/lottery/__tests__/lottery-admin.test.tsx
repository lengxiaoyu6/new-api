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
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

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
  title: { en: activity.name, fr: 'Tirage' },
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

function renderLotteryAdmin(
  initialVersions: LotteryAdminVersion[],
  initialActivities: LotteryAdminActivity[] = [activity],
  currentUser: AuthUser = { id: 1, username: 'root', role: 100 }
) {
  useAuthStore.getState().auth.setUser(currentUser)
  let versions = initialVersions
  let activities = initialActivities
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/lottery/admin/activities') {
      return { data: { success: true, data: activities } } as never
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
    get,
    setVersions: (value: LotteryAdminVersion[]) => (versions = value),
    setActivities: (value: LotteryAdminActivity[]) => (activities = value),
  }
}

afterEach(async () => {
  await i18next.changeLanguage('en')
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('creates an active prize pool on the first configuration save without creating an activity', async () => {
  const { client, setVersions, setActivities } = renderLotteryAdmin([], [])
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/lottery/admin/settings') {
      setVersions([publishedVersion])
      setActivities([{ ...activity, status: 'active' }])
    }
    return { data: { success: true } } as never
  })
  const user = userEvent.setup()

  expect(await screen.findByLabelText('Lottery title')).toBeVisible()
  expect(screen.queryByText('Create activity')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Required spend')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save configuration' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/lottery/admin/settings',
      expect.objectContaining({ threshold_quota: 0 })
    )
  )
  await user.click(screen.getByRole('tab', { name: 'Current configuration' }))
  const select = await screen.findByRole('combobox', { name: 'Balance prize' })
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: /balance-2/ }))
  expect(select).toHaveTextContent('balance-2')

  client.clear()
})

it('keeps published prizes editable and preserves their identity and inventory when saving', async () => {
  const { client } = renderLotteryAdmin([publishedVersion])
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()

  const title = await screen.findByLabelText('Lottery title')
  await user.clear(title)
  await user.type(title, 'Payment rewards')
  expect(
    screen.getByLabelText('Prize code', { selector: '#lottery-prize-0-code' })
  ).toHaveAttribute('readonly')
  await user.click(screen.getByRole('button', { name: 'Save configuration' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/lottery/admin/settings',
      expect.objectContaining({
        title: { en: 'Payment rewards', fr: 'Tirage' },
        prizes: expect.arrayContaining([
          expect.objectContaining({ prize_id: 11, total_stock: 10 }),
        ]),
      })
    )
  )

  client.clear()
})

it('preserves the edited configuration after a failed save and allows retrying', async () => {
  const { client } = renderLotteryAdmin([publishedVersion])
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Unable to save lottery configuration' },
    })
    .mockResolvedValueOnce({ data: { success: true } })
  const user = userEvent.setup()
  const title = await screen.findByLabelText('Lottery title')
  await user.clear(title)
  await user.type(title, 'Payment rewards')

  const save = screen.getByRole('button', { name: 'Save configuration' })
  await user.click(save)
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(save).toBeEnabled())
  expect(title).toHaveValue('Payment rewards')
  await user.click(save)
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))

  client.clear()
})

it('allows a configured balance prize to be selected for stock adjustment', async () => {
  const { client } = renderLotteryAdmin([publishedVersion])
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('tab', { name: 'Current configuration' })
  )
  const select = await screen.findByRole('combobox', { name: 'Balance prize' })

  await user.click(select)
  await user.click(await screen.findByRole('option', { name: /balance-2/ }))

  expect(select).toHaveTextContent('balance-2')

  client.clear()
})

it('preserves unsaved prize fields when switching tabs with the keyboard', async () => {
  const { client } = renderLotteryAdmin([publishedVersion])
  const user = userEvent.setup()
  const title = await screen.findByLabelText('Lottery title')
  await user.clear(title)
  await user.type(title, 'Unsaved configuration')
  await user.click(screen.getByRole('button', { name: 'Add prize' }))
  await user.type(
    screen.getByLabelText('Prize title', {
      selector: '#lottery-prize-2-title',
    }),
    'New reward'
  )

  const configure = screen.getByRole('tab', { name: 'Configure prizes' })
  expect(configure).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('tab', { name: 'Current configuration' }))
  expect(title).not.toBeVisible()
  expect(
    screen.getByRole('tabpanel', { name: 'Current configuration' })
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Save configuration' })
  ).not.toBeInTheDocument()

  await user.keyboard('{ArrowLeft}')
  expect(configure).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(configure).toHaveAttribute('aria-selected', 'true')
  expect(title).toBeVisible()
  expect(title).toHaveValue('Unsaved configuration')
  expect(
    screen.getByLabelText('Prize title', {
      selector: '#lottery-prize-2-title',
    })
  ).toHaveValue('New reward')
  client.clear()
})

it('loads audit records only after opening the audit tab and keeps its pagination working', async () => {
  const { client, get } = renderLotteryAdmin([publishedVersion])
  const user = userEvent.setup()
  await screen.findByLabelText('Lottery title')
  expect(get.mock.calls.some(([url]) => String(url).endsWith('/audit'))).toBe(
    false
  )

  get.mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        items: [
          {
            draw_id: 91,
            user_id: 15,
            username: 'lottery-customer',
            business_date: '2026-10-24',
            attempt_no: 1,
            idempotency_key: 'draw-91',
            version_id: 3,
            raw_prize_id: 11,
            raw_prize_title: 'Balance reward',
            final_prize_id: 11,
            final_prize_title: 'Balance reward',
            random_value: 25,
            range_start: 0,
            range_end: 500_000,
            conversion_reason: '',
            status: 'completed',
            award_status: 'granted',
            created_at: 1,
          },
        ],
        total: 21,
        page: 1,
        page_size: 20,
      },
    },
  })
  await user.click(screen.getByRole('tab', { name: 'Audit Logs' }))
  expect(await screen.findByText('draw-91')).toBeVisible()
  expect(
    screen.queryByRole('combobox', { name: 'Balance prize' })
  ).not.toBeInTheDocument()
  const panel = screen.getByRole('tabpanel', { name: 'Audit Logs' })
  const auditRow = within(panel).getByRole('row', { name: /draw-91/ })
  expect(
    within(auditRow).getByRole('cell', { name: 'lottery-customer' })
  ).toBeVisible()
  expect(
    within(auditRow).getAllByRole('cell', { name: 'Balance reward' })
  ).toHaveLength(2)
  expect(
    within(auditRow).getByRole('cell', { name: 'Award granted' })
  ).toBeVisible()
  expect(
    within(auditRow).queryByRole('cell', { name: '15' })
  ).not.toBeInTheDocument()
  expect(
    within(auditRow).queryByRole('cell', { name: '11' })
  ).not.toBeInTheDocument()
  expect(within(panel).getByRole('table').parentElement).toHaveClass(
    'overflow-x-auto'
  )
  await user.click(within(panel).getByRole('button', { name: /next page/i }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      `/api/lottery/admin/activities/${activity.id}/audit`,
      { params: { page: 2, page_size: 20, language: 'en' } }
    )
  )
  expect(await screen.findByText('No audit records')).toBeVisible()
  client.clear()
})

it('shows inventory with the stock form and refreshes remaining stock after adding stock', async () => {
  const stockedVersion = {
    ...publishedVersion,
    prizes: publishedVersion.prizes.map((prize) =>
      prize.id === 11 ? { ...prize, issued_stock: 4 } : prize
    ),
  }
  const { client, setVersions } = renderLotteryAdmin([stockedVersion])
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    setVersions([
      {
        ...stockedVersion,
        prizes: stockedVersion.prizes.map((prize) =>
          prize.id === 11 ? { ...prize, total_stock: 15 } : prize
        ),
      },
    ])
    return { data: { success: true } }
  })
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('tab', { name: 'Current configuration' })
  )
  const panel = screen.getByRole('tabpanel', { name: 'Current configuration' })
  const row = await within(panel).findByRole('row', { name: /balance-2/ })
  expect(within(row).getByRole('cell', { name: '50%' })).toBeVisible()
  expect(within(row).getByRole('cell', { name: '10' })).toBeVisible()
  expect(within(row).getByRole('cell', { name: '6' })).toBeVisible()
  expect(within(row).getByRole('cell', { name: 'Unlimited' })).toBeVisible()
  const select = within(panel).getByRole('combobox', { name: 'Balance prize' })
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: /balance-2/ }))
  await user.clear(screen.getByLabelText('Stock amount'))
  await user.type(screen.getByLabelText('Stock amount'), '5')
  await user.type(screen.getByLabelText('Reason'), 'More rewards')
  await user.click(screen.getByRole('button', { name: 'Add lottery stock' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      `/api/lottery/admin/activities/${activity.id}/stock`,
      {
        prize_id: 11,
        delta: 5,
        request_id: expect.any(String),
        reason: 'More rewards',
      }
    )
  )
  expect(await within(row).findByRole('cell', { name: '15' })).toBeVisible()
  expect(within(row).getByRole('cell', { name: '11' })).toBeVisible()
  client.clear()
})

it('refreshes prize names and translates award statuses when switching to Chinese', async () => {
  const { client, get } = renderLotteryAdmin([publishedVersion])
  const user = userEvent.setup()
  await screen.findByLabelText('Lottery title')
  const items = [
    {
      draw_id: 91,
      username: 'lottery-customer',
      raw_prize_title: 'Original reward',
      final_prize_title: 'Original reward',
      attempt_no: 1,
      idempotency_key: 'audit-granted',
      random_value: 25,
      range_start: 0,
      range_end: 500_000,
      status: 'completed',
      award_status: 'granted',
      created_at: 1,
    },
    {
      draw_id: 92,
      username: 'lottery-customer',
      raw_prize_title: 'Thanks',
      final_prize_title: 'Thanks',
      attempt_no: 2,
      idempotency_key: 'audit-completed',
      random_value: 750_000,
      range_start: 500_000,
      range_end: 1_000_000,
      status: 'completed',
      award_status: '',
      created_at: 1,
    },
  ]
  get.mockResolvedValueOnce({
    data: { success: true, data: { items, total: 2, page: 1, page_size: 20 } },
  })
  await user.click(screen.getByRole('tab', { name: 'Audit Logs' }))
  expect(
    await screen.findByRole('cell', { name: 'Award granted' })
  ).toBeVisible()
  expect(screen.getByRole('cell', { name: 'Completed' })).toBeVisible()

  get.mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        items: items.map((item) => ({
          ...item,
          raw_prize_title: item.draw_id === 91 ? '原始余额奖励' : '谢谢参与',
          final_prize_title: item.draw_id === 91 ? '原始余额奖励' : '谢谢参与',
        })),
        total: 2,
        page: 1,
        page_size: 20,
      },
    },
  })
  i18next.addResourceBundle('zh', 'translation', zh.translation)
  await act(async () => {
    await i18next.changeLanguage('zh')
  })
  expect(await screen.findByRole('cell', { name: '发放成功' })).toBeVisible()
  expect(screen.getByRole('cell', { name: '已完成' })).toBeVisible()
  expect(
    await screen.findAllByRole('cell', { name: '原始余额奖励' })
  ).toHaveLength(2)
  expect(get).toHaveBeenLastCalledWith(
    `/api/lottery/admin/activities/${activity.id}/audit`,
    { params: { page: 1, page_size: 20, language: 'zh' } }
  )
  expect(screen.getByRole('columnheader', { name: '用户名' })).toBeVisible()
  expect(
    screen.queryByRole('cell', { name: 'granted' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('cell', { name: 'completed' })
  ).not.toBeInTheDocument()
  client.clear()
})

it('keeps audit loading and failures inside its tab and allows retrying', async () => {
  const { client, get } = renderLotteryAdmin([publishedVersion])
  const user = userEvent.setup()
  const title = await screen.findByLabelText('Lottery title')
  let rejectAudit!: (error: Error) => void
  get.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectAudit = reject
      })
  )

  await user.click(screen.getByRole('tab', { name: 'Audit Logs' }))
  const panel = screen.getByRole('tabpanel', { name: 'Audit Logs' })
  expect(within(panel).getByText('Loading...')).toBeVisible()
  rejectAudit(new Error('Unable to load lottery audit'))
  expect(
    await within(panel).findByText('Unable to load lottery audit')
  ).toBeVisible()
  get.mockRejectedValueOnce(new Error('Unable to load lottery audit'))

  await user.click(screen.getByRole('tab', { name: 'Configure prizes' }))
  expect(title).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Retry' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Audit Logs' }))
  await user.click(await within(panel).findByRole('button', { name: 'Retry' }))
  expect(await within(panel).findByText('No audit records')).toBeVisible()
  client.clear()
})

it('keeps pause and resume actions available above the tabs with the correct status', async () => {
  const { client, setActivities } = renderLotteryAdmin(
    [publishedVersion],
    [{ ...activity, status: 'active' }]
  )
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    setActivities([{ ...activity, status: 'paused' }])
    return { data: { success: true } }
  })
  const user = userEvent.setup()
  await screen.findByLabelText('Lottery title')
  await user.click(screen.getByRole('tab', { name: 'Current configuration' }))
  expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Pause' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      `/api/lottery/admin/activities/${activity.id}/status`,
      { status: 'paused' }
    )
  )
  expect(await screen.findByText('Paused')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
  client.clear()
})

it('starts read-only administrators on current configuration without edit controls', async () => {
  const { client } = renderLotteryAdmin([publishedVersion], [activity], {
    id: 2,
    username: 'reader',
    role: 10,
    permissions: { admin_permissions: { lottery: { read: true } } },
  })
  expect(
    await screen.findByRole('tab', { name: 'Current configuration' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(await screen.findByRole('row', { name: /balance-2/ })).toBeVisible()
  expect(
    screen.queryByRole('tab', { name: 'Configure prizes' })
  ).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Lottery title')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'Balance prize' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Pause' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Resume' })
  ).not.toBeInTheDocument()
  client.clear()
})

it('shows an empty configuration in its own tab before the first save', async () => {
  const { client } = renderLotteryAdmin([], [])
  const user = userEvent.setup()
  await screen.findByLabelText('Lottery title')
  await user.click(screen.getByRole('tab', { name: 'Current configuration' }))
  expect(screen.getByText('No configuration')).toBeVisible()
  expect(
    screen.queryByRole('combobox', { name: 'Balance prize' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Audit Logs' }))
  expect(screen.getByText('No audit records')).toBeVisible()
  client.clear()
})

it('wraps navigation and prize cards while containing the inventory table overflow', async () => {
  const { client } = renderLotteryAdmin([publishedVersion])
  const user = userEvent.setup()
  await screen.findByLabelText('Lottery title')
  expect(screen.getByRole('tablist')).toHaveClass(
    'flex-wrap',
    'group-data-horizontal/tabs:h-auto'
  )
  const prize = screen.getByRole('group', { name: 'Prize 1' })
  expect(prize).toHaveClass('min-w-0')
  expect(prize.parentElement).toHaveClass('grid', '2xl:grid-cols-2')
  await user.click(screen.getByRole('tab', { name: 'Current configuration' }))
  const panel = screen.getByRole('tabpanel', { name: 'Current configuration' })
  expect(within(panel).getByRole('table').parentElement).toHaveClass(
    'overflow-x-auto'
  )
  client.clear()
})
