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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Lottery } from '../index'
import type { LotteryActivity, LotteryPrize } from '../types'

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
  rule_text: 'One draw after the required spend.',
  threshold_quota: 500_000,
  base_used: false,
  remaining_attempts: 1,
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

afterEach(() => {
  vi.restoreAllMocks()
})

it('shows an equal-segment prize wheel without exposing probability values', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [activity] },
  })
  const client = renderLottery()

  expect(await screen.findByTestId('lottery-wheel-disc')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Draw now' })).toBeEnabled()
  expect(screen.getAllByText('2 balance')).toHaveLength(1)
  expect(screen.queryByText('Available')).not.toBeInTheDocument()
  expect(screen.queryByText('Out of stock')).not.toBeInTheDocument()
  expect(screen.queryByText('Probability')).not.toBeInTheDocument()
  expect(screen.queryByText('25.00%')).not.toBeInTheDocument()
  expect(screen.queryByText('50.00%')).not.toBeInTheDocument()

  client.clear()
})

it('disables the wheel when the activity qualification is not satisfied', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        {
          ...activity,
          status: 'ineligible',
          remaining_attempts: 0,
          qualification: {
            ...activity.qualification,
            eligible: false,
            reason: 'threshold_not_met',
          },
        },
      ],
    },
  })
  const client = renderLottery()

  expect(await screen.findByTestId('lottery-wheel-disc')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Draw now' })).toBeDisabled()

  client.clear()
})

it('shows the server-selected prize after drawing with reduced motion', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [activity] },
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
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
      },
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
