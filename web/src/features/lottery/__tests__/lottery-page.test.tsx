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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Lottery } from '../index'
import type {
  LotteryActivity,
  LotteryDraw,
  LotteryDrawResult,
  LotteryPrize,
} from '../types'

const prizes = [
  {
    id: 11,
    code: 'balance-2',
    type: 'balance',
    balance_amount: 2,
    balance_quota: 1_000_000,
    title: '2 balance',
    description: 'Added to the account balance',
    available: true,
    probability_percent: 25,
    effective_probability_percent: 25,
  } as LotteryPrize,
  {
    id: 12,
    code: 'again',
    type: 'again',
    balance_amount: 0,
    balance_quota: 0,
    title: 'One more draw',
    description: 'Adds another draw today',
    available: true,
    probability_percent: 25,
    effective_probability_percent: 25,
  } as LotteryPrize,
  {
    id: 13,
    code: 'thanks',
    type: 'thanks',
    balance_amount: 0,
    balance_quota: 0,
    title: 'Thank you for participating',
    description: 'No balance prize this time',
    available: true,
    probability_percent: 50,
    effective_probability_percent: 50,
  } as LotteryPrize,
]

const activity: LotteryActivity = {
  id: 7,
  name: 'evening-lottery',
  start_at: 1,
  end_at: 4_102_444_800,
  consume_start_at: 1,
  consume_end_at: 4_102_444_800,
  business_date: '2026-09-23',
  version_id: 3,
  status: 'eligible',
  title: 'Evening lottery',
  rule_text:
    'Each successful online payment grants one draw. Unused draws carry over.',
  threshold_quota: 500_000,
  base_used: false,
  remaining_attempts: 3,
  extra_granted: false,
  extra_available: false,
  eligibility_reason: 'eligible',
  qualification: {
    eligible: true,
    threshold_quota: 500_000,
    reason: 'eligible',
    checked_at: 1,
  },
  prizes,
}

const drawResult: LotteryDrawResult = {
  draw_id: 21,
  version_id: 3,
  attempt_no: 1,
  reused: false,
  prize_id: 11,
  prize_type: 'balance',
  prize_title: '2 balance',
  prize_description: 'Added to the account balance',
  balance_amount: 2,
  balance_quota: 1_000_000,
  award_id: 31,
  award_status: 'granted',
  draw_status: 'completed',
}

function renderLottery() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Lottery />
    </QueryClientProvider>
  )
  return client
}

function mockLotteryGet(
  activities: LotteryActivity[],
  history: LotteryDraw[] = []
) {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/lottery/activities') {
      return { data: { success: true, data: activities } } as never
    }
    return {
      data: {
        success: true,
        data: { items: history, total: history.length, page: 1, page_size: 20 },
      },
    } as never
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

it('shows an equal-segment prize wheel without exposing probability values', async () => {
  const get = mockLotteryGet([activity])
  const client = renderLottery()

  expect(await screen.findByTestId('lottery-wheel-disc')).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Lottery' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByRole('tab', { name: 'Draw history' })).toHaveAttribute(
    'aria-selected',
    'false'
  )
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(get).not.toHaveBeenCalledWith(
    '/api/lottery/history',
    expect.anything()
  )
  expect(get).not.toHaveBeenCalledWith(
    '/api/lottery/attempts/history',
    expect.anything()
  )
  expect(screen.getByRole('button', { name: 'Draw now' })).toBeEnabled()
  expect(screen.getAllByText('2 balance')).toHaveLength(1)
  expect(screen.queryByText('Available')).not.toBeInTheDocument()
  expect(screen.queryByText('Out of stock')).not.toBeInTheDocument()
  expect(screen.queryByText('Probability')).not.toBeInTheDocument()
  expect(screen.queryByText('25.00%')).not.toBeInTheDocument()
  expect(screen.queryByText('50.00%')).not.toBeInTheDocument()
  expect(screen.getByText('Remaining: 3')).toBeVisible()
  expect(
    screen.getByText(
      'Each successful online payment grants one draw. Unused draws carry over.'
    )
  ).toBeVisible()
  expect(screen.queryByText('Required spend')).not.toBeInTheDocument()

  client.clear()
})

it('disables the wheel when the activity qualification is not satisfied', async () => {
  mockLotteryGet([
    {
      ...activity,
      status: 'ineligible',
      remaining_attempts: 0,
      qualification: {
        ...activity.qualification,
        eligible: false,
        reason: 'payment_required',
      },
    },
  ])
  const client = renderLottery()

  expect(await screen.findByTestId('lottery-wheel-disc')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled()
  expect(
    screen.queryByText('Complete an online payment to receive a draw.')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      'Only payments completed after the prize pool is enabled count.'
    )
  ).not.toBeInTheDocument()

  client.clear()
})

it('allows the three tabs to wrap with automatic height on narrow screens', async () => {
  mockLotteryGet([activity])
  const client = renderLottery()
  await screen.findByRole('button', { name: 'Draw now' })
  expect(screen.getByRole('tablist', { name: 'Lottery' })).toHaveClass(
    'flex-wrap',
    'group-data-horizontal/tabs:h-auto'
  )
  client.clear()
})

it('shows the server-selected prize after drawing with reduced motion', async () => {
  mockLotteryGet([activity])
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: drawResult,
    },
  })
  const client = renderLottery()

  await userEvent.click(await screen.findByRole('button', { name: 'Draw now' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('2 balance')).toBeVisible()
  expect(within(dialog).getByText('Added to the account balance')).toBeVisible()
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/lottery/activities/7/draw',
      {},
      {
        headers: {
          'Idempotency-Key': expect.any(String),
        },
      }
    )
  )

  client.clear()
})

it('keeps draw history available when there are no active activities', async () => {
  const get = mockLotteryGet(
    [],
    [
      {
        id: 21,
        activity_id: 7,
        business_date: '2026-09-22',
        version_id: 2,
        attempt_no: 1,
        prize_id: 11,
        prize_type: 'balance',
        prize_title: '2 balance',
        prize_description: 'Added to the account balance',
        balance_amount: 2,
        balance_quota: 1_000_000,
        created_at: 1,
      },
    ]
  )
  const client = renderLottery()

  expect(
    await screen.findByText('No lottery prize pool configured')
  ).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Draw history' }))
  const history = within(screen.getByRole('tabpanel', { name: 'Draw history' }))
  expect(await history.findByText('2 balance')).toBeVisible()
  expect(screen.getByText('No lottery prize pool configured')).not.toBeVisible()
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  expect(get).toHaveBeenCalledWith('/api/lottery/history', {
    params: { page: 1, page_size: 20 },
  })

  client.clear()
})

it('switches between drawing and empty history with the keyboard', async () => {
  mockLotteryGet([activity])
  const client = renderLottery()
  const user = userEvent.setup()
  const wheel = await screen.findByTestId('lottery-wheel-disc')

  screen.getByRole('tab', { name: 'Lottery' }).focus()
  await user.keyboard('{ArrowRight}{Enter}')

  expect(screen.getByRole('tab', { name: 'Draw history' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: 'Draw history' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(await screen.findByText('No draw history')).toBeVisible()
  expect(wheel).not.toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Draw now' })
  ).not.toBeInTheDocument()

  await user.keyboard('{ArrowLeft}{Enter}')

  expect(screen.getByRole('tab', { name: 'Lottery' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: 'Lottery' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(wheel).toBeVisible()
  expect(screen.getByText('No draw history')).not.toBeVisible()
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)

  client.clear()
})

it('keeps history loading and errors inside the history tab', async () => {
  const response = Promise.withResolvers<void>()
  mockLotteryGet([activity]).mockImplementation(async (url) => {
    if (url === '/api/lottery/activities') {
      return { data: { success: true, data: [activity] } } as never
    }
    await response.promise
    return { data: { success: false, message: 'History unavailable' } } as never
  })
  const client = renderLottery()

  await screen.findByRole('button', { name: 'Draw now' })
  await userEvent.click(screen.getByRole('tab', { name: 'Draw history' }))
  expect(
    within(screen.getByRole('tabpanel', { name: 'Draw history' })).getByText(
      'Loading...'
    )
  ).toBeVisible()

  await act(async () => response.resolve())
  expect(await screen.findByText('Unable to load draw history')).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Lottery' }))
  expect(screen.getByText('Unable to load draw history')).not.toBeVisible()
  expect(screen.getByRole('button', { name: 'Draw now' })).toBeEnabled()

  client.clear()
})

it('preserves a pending draw result when switching to history before the response', async () => {
  const response = Promise.withResolvers<void>()
  mockLotteryGet([activity])
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    await response.promise
    return { data: { success: true, data: drawResult } } as never
  })
  const client = renderLottery()
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'Draw now' }))
  await user.click(screen.getByRole('tab', { name: 'Draw history' }))
  await screen.findByText('No draw history')
  await act(async () => response.resolve())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await user.click(screen.getByRole('tab', { name: 'Lottery' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('2 balance')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(await screen.findByRole('button', { name: 'Draw now' })).toBeEnabled()
  expect(post).toHaveBeenCalledTimes(1)

  client.clear()
})

it('retains the prize when switching to history interrupts the wheel animation', async () => {
  const matchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches: false,
  }))
  mockLotteryGet([activity])
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: drawResult },
  })
  const client = renderLottery()
  const user = userEvent.setup()

  const wheel = await screen.findByTestId('lottery-wheel-disc')
  await user.click(screen.getByRole('button', { name: 'Draw now' }))
  await waitFor(() =>
    expect(wheel.parentElement).not.toHaveStyle({ transform: 'rotate(0deg)' })
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await user.click(screen.getByRole('tab', { name: 'Draw history' }))
  expect(await screen.findByText('No draw history')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Lottery' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('2 balance')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(await screen.findByRole('button', { name: 'Draw now' })).toBeEnabled()

  client.clear()
})

it('shows payment and administrator acquisitions with paginated attempt history', async () => {
  const reason = 'Member appreciation gift '.repeat(20)
  const get = mockLotteryGet([activity]).mockImplementation(
    async (url, config) => {
      if (url === '/api/lottery/activities') {
        return { data: { success: true, data: [activity] } } as never
      }
      const page = config?.params?.page ?? 1
      const items =
        page === 1
          ? [
              {
                id: 1,
                source: 'admin_grant',
                count: 2,
                reason,
                created_at: 1_792_800_000,
              },
              {
                id: 1,
                source: 'payment',
                count: 1,
                reason: '',
                created_at: 1_792_700_000,
              },
            ]
          : [
              {
                id: 2,
                source: 'admin_grant',
                count: 1,
                reason: 'Earlier gift',
                created_at: 1_792_600_000,
              },
            ]
      return {
        data: {
          success: true,
          data: { items, total: 21, page, page_size: 20 },
        },
      } as never
    }
  )
  const client = renderLottery()
  const user = userEvent.setup()

  await screen.findByRole('button', { name: 'Draw now' })
  await user.click(screen.getByRole('tab', { name: 'Attempt history' }))
  const panel = within(
    screen.getByRole('tabpanel', { name: 'Attempt history' })
  )
  expect(await panel.findByText('Administrator gift')).toBeVisible()
  expect(panel.getByText('Online payment')).toBeVisible()
  expect(panel.getByText('+2')).toBeVisible()
  expect(panel.getByText('+1')).toBeVisible()
  expect(panel.getByText(reason.trim())).toBeVisible()
  expect(
    panel.getByRole('button', { name: 'Go to previous page' })
  ).toBeDisabled()
  expect(panel.getByText('1 / 2')).toBeVisible()

  await user.click(panel.getByRole('button', { name: 'Go to next page' }))
  expect(await panel.findByText('Earlier gift')).toBeVisible()
  expect(panel.getByText('2 / 2')).toBeVisible()
  expect(panel.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
  expect(get).toHaveBeenCalledWith('/api/lottery/attempts/history', {
    params: { page: 2, page_size: 20 },
  })

  await user.click(screen.getByRole('tab', { name: 'Lottery' }))
  expect(screen.getByRole('button', { name: 'Draw now' })).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Attempt history' }))
  expect(await panel.findByText('Earlier gift')).toBeVisible()
  client.clear()
})

it('opens empty attempt history with the keyboard when the prize pool is missing', async () => {
  mockLotteryGet([])
  const client = renderLottery()
  const user = userEvent.setup()
  await screen.findByText('No lottery prize pool configured')

  screen.getByRole('tab', { name: 'Lottery' }).focus()
  await user.keyboard('{End}{Enter}')

  expect(screen.getByRole('tab', { name: 'Attempt history' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: 'Attempt history' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(await screen.findByText('No attempt history')).toBeVisible()
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  expect(
    screen.queryByRole('navigation', { name: 'Page' })
  ).not.toBeInTheDocument()
  client.clear()
})

it('keeps attempt history available when activity loading fails', async () => {
  mockLotteryGet([]).mockImplementation(async (url) => {
    if (url === '/api/lottery/activities') {
      throw new Error('Pool unavailable')
    }
    return {
      data: {
        success: true,
        data: {
          items: [
            {
              id: 1,
              source: 'admin_grant',
              count: 1,
              reason: 'Member gift',
              created_at: 1,
            },
          ],
          total: 1,
          page: 1,
          page_size: 20,
        },
      },
    } as never
  })
  const client = renderLottery()
  await screen.findByText('Unable to load lottery activities')
  await userEvent.click(screen.getByRole('tab', { name: 'Attempt history' }))
  expect(await screen.findByText('Member gift')).toBeVisible()
  expect(
    screen.getByText('Unable to load lottery activities')
  ).not.toBeVisible()
  client.clear()
})

it('shows attempt loading and a retryable error within the attempts tab', async () => {
  const response = Promise.withResolvers<void>()
  let failed = true
  mockLotteryGet([activity]).mockImplementation(async (url) => {
    if (url === '/api/lottery/activities') {
      return { data: { success: true, data: [activity] } } as never
    }
    await response.promise
    if (failed) {
      return {
        data: { success: false, message: 'History unavailable' },
      } as never
    }
    return {
      data: {
        success: true,
        data: { items: [], total: 0, page: 1, page_size: 20 },
      },
    } as never
  })
  const client = renderLottery()
  await screen.findByRole('button', { name: 'Draw now' })
  await userEvent.click(screen.getByRole('tab', { name: 'Attempt history' }))
  const panel = within(
    screen.getByRole('tabpanel', { name: 'Attempt history' })
  )
  expect(panel.getByText('Loading...')).toBeVisible()
  await act(async () => response.resolve())
  expect(await panel.findByText('Unable to load attempt history')).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Lottery' }))
  expect(screen.getByText('Unable to load attempt history')).not.toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Attempt history' }))
  failed = false
  await userEvent.click(await panel.findByRole('button', { name: 'Retry' }))
  expect(await panel.findByText('No attempt history')).toBeVisible()
  client.clear()
})
