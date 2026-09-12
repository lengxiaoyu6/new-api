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

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { TransferDialog } from '../transfer-dialog'
import { WithdrawalDialog } from '../withdrawal-dialog'
import { WithdrawalsCard } from '../withdrawals-card'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})
const clients: QueryClient[] = []

function renderReferral(component: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{component}</QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(() => {
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})
afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  vi.restoreAllMocks()
  localStorage.clear()
})

it('warns when a transfer consumes rebates and disables amounts beyond the reward balance', async () => {
  const user = userEvent.setup()
  const confirm = vi.fn().mockResolvedValue(true)
  renderReferral(
    <TransferDialog
      open
      onOpenChange={() => undefined}
      availableQuota={1000000}
      withdrawableQuota={500000}
      transferring={false}
      onConfirm={confirm}
    />
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'This transfer removes withdrawal eligibility'
  )
  const amount = screen.getByRole('spinbutton', { name: 'Transfer Amount' })
  await user.clear(amount)
  await user.type(amount, '1')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'Transfer' })
  )
  expect(confirm).toHaveBeenCalledWith(500000)
  await user.clear(amount)
  await user.type(amount, '3')
  expect(
    screen.getByRole('button', { name: 'Transfer' })
  ).toBeDisabled()
})

it('requires a payout account and an amount within withdrawable rebates', async () => {
  const user = userEvent.setup()
  renderReferral(
    <WithdrawalDialog availableQuota={500000} onOpenChange={() => undefined} />
  )
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled()
  await user.type(
    screen.getByRole('textbox', { name: 'Payout method' }),
    'bank'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Account holder' }),
    'Test'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Payout account' }),
    '123'
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled()
  )
  const amount = screen.getByRole('spinbutton')
  await user.clear(amount)
  await user.type(amount, '2')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Enter an amount within the withdrawable balance.'
  )
  expect(amount).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled()
})

it.each([true, false])(
  'submits verified withdrawal details and closes the form only when success is %s',
  async (success) => {
    const user = userEvent.setup()
    const close = vi.fn()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          scope: 'affiliate.withdraw',
          methods: [{ method: 'password', available: true }],
          oauth_providers: [],
          password_encryption_enabled: false,
        },
      },
    })
    const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
      if (url === '/api/verify') {
        return {
          data: {
            success: true,
            data: {
              proof_token: 'withdraw-proof',
              scope: 'affiliate.withdraw',
              method: 'password',
              expires_at: Math.floor(Date.now() / 1000) + 300,
            },
          },
        }
      }
      return {
        data: {
          success,
          message: success ? '' : 'Insufficient withdrawable top-up rebates.',
          data: {},
        },
      }
    })
    renderReferral(
      <WithdrawalDialog availableQuota={500000} onOpenChange={close} />
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Payout method' }),
      'bank'
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Account holder' }),
      'Test'
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Payout account' }),
      '123'
    )
    await user.click(screen.getByRole('button', { name: 'Submit request' }))
    const verification = await screen.findByRole('dialog', {
      name: 'Confirm withdrawal',
    })
    await user.type(
      within(verification).getByLabelText('Password', {
        selector: 'input',
      }),
      'password-test'
    )
    await user.click(
      within(verification).getByRole('button', { name: 'Verify' })
    )
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/user/aff/withdrawals',
        expect.objectContaining({
          quota: 500000,
          method: 'bank',
          account_name: 'Test',
          account: '123',
        }),
        expect.objectContaining({
          headers: { 'X-Security-Proof': 'withdraw-proof' },
        })
      )
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Submit request' })
      ).toBeEnabled()
    )
    if (success) expect(close).toHaveBeenCalledWith(false)
    else expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Payout account' })).toHaveValue(
      '123'
    )
  }
)

const pendingWithdrawal = {
  id: 5,
  user_id: 12,
  request_id: 'request-id',
  quota: 500000,
  amount_usd: '1',
  method: 'bank',
  account_name: 'Test',
  account: '123',
  status: 'pending',
  review_note: '',
  reviewer_id: 0,
  created_at: 1700000000,
  reviewed_at: 0,
}

it('shows withdrawal status without administrator actions in personal history', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { items: [pendingWithdrawal], total: 1, page: 1, page_size: 10 },
    },
  })
  renderReferral(<WithdrawalsCard />)
  expect(await screen.findByText('Pending review')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Mark as paid' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Reject' })
  ).not.toBeInTheDocument()
})

it('requires a payment reference before an administrator confirms a payout', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          pendingWithdrawal,
          { ...pendingWithdrawal, id: 6, status: 'paid' },
        ],
        total: 2,
        page: 1,
        page_size: 10,
      },
    },
  })
  renderReferral(<WithdrawalsCard admin />)
  await user.click(await screen.findByRole('button', { name: 'Mark as paid' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Mark as paid' })
  expect(
    within(dialog).getByRole('button', { name: 'Confirm' })
  ).toBeDisabled()
  await user.type(
    within(dialog).getByRole('textbox', {
      name: 'Payment reference or rejection reason',
    }),
    'bank-reference'
  )
  expect(
    within(dialog).getByRole('button', { name: 'Confirm' })
  ).toBeEnabled()
})

it('shows a retry action when withdrawal history fails to load', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new Error('network unavailable'))
  renderReferral(<WithdrawalsCard />)
  expect(
    await screen.findByRole('button', { name: 'Retry' })
  ).toBeInTheDocument()
  expect(
    screen.queryByText('No withdrawal requests yet')
  ).not.toBeInTheDocument()
})
