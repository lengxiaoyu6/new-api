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
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { requestPayment } from '../api'
import { PaymentConfirmDialog } from '../components/dialogs/payment-confirm-dialog'
import { RechargeFormCard } from '../components/recharge-form-card'
import { usePayment } from '../hooks/use-payment'
import { getMinTopupAmount } from '../lib/payment'
import type { TopupInfo } from '../types'

afterEach(() => vi.restoreAllMocks())

const perPayInfo: TopupInfo = {
  enable_perpay_topup: true,
  enable_online_topup: false,
  enable_stripe_topup: false,
  min_topup: 5,
  stripe_min_topup: 1,
  amount_options: [5, 10],
  discount: {},
  pay_methods: [{ name: 'Alipay (PerPay)', type: 'perpay', min_topup: 5 }],
}

test('a PerPay selection creates a hosted checkout using the PerPay endpoint', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      message: 'success',
      data: { checkout_url: 'https://pay.example/checkout/token' },
    },
  })
  const result = await requestPayment({
    amount: 9.99,
    payment_method: 'perpay',
  })
  expect(post).toHaveBeenCalledWith(
    '/api/user/perpay/pay',
    { amount: 9.99, payment_method: 'perpay' },
    expect.any(Object)
  )
  expect(result.data?.checkout_url).toBe('https://pay.example/checkout/token')
})

test('PerPay reserves a new window before requesting checkout and keeps the wallet open', async () => {
  const popup = {
    opener: window,
    closed: false,
    location: { replace: vi.fn() },
    close: vi.fn(),
  }
  const open = vi
    .spyOn(window, 'open')
    .mockReturnValue(popup as unknown as Window)
  const walletURL = window.location.href
  vi.spyOn(api, 'post').mockImplementation(async () => {
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(popup.opener).toBeNull()
    return {
      data: {
        message: 'success',
        data: { checkout_url: 'https://pay.example/checkout/token' },
      },
    }
  })
  const { result } = renderHook(() => usePayment())

  await act(async () => {
    expect(await result.current.processPayment(9.99, 'perpay')).toBe(true)
  })

  expect(popup.location.replace).toHaveBeenCalledExactlyOnceWith(
    'https://pay.example/checkout/token'
  )
  expect(popup.close).not.toHaveBeenCalled()
  expect(window.location.href).toBe(walletURL)
  expect(result.current.processing).toBe(false)
})

test.each([
  'request failure',
  'business failure',
  'missing checkout',
  'closed window',
])('PerPay closes the reserved window after %s', async (failure) => {
  const popup = {
    opener: window,
    closed: false,
    location: { replace: vi.fn() },
    close: vi.fn(),
  }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  const post = vi.spyOn(api, 'post')
  if (failure === 'request failure') {
    post.mockRejectedValue(new Error('Network unavailable'))
  } else if (failure === 'business failure') {
    post.mockResolvedValue({
      data: { message: 'error', data: 'Failed to start payment' },
    })
  } else if (failure === 'closed window') {
    post.mockImplementation(async () => {
      popup.closed = true
      return {
        data: {
          message: 'success',
          data: { checkout_url: 'https://pay.example/checkout/token' },
        },
      }
    })
  } else {
    post.mockResolvedValue({ data: { message: 'success', data: {} } })
  }
  const { result } = renderHook(() => usePayment())

  await act(async () => {
    expect(await result.current.processPayment(9.99, 'perpay')).toBe(false)
  })

  expect(popup.close).toHaveBeenCalledOnce()
  expect(popup.location.replace).not.toHaveBeenCalled()
  expect(result.current.processing).toBe(false)
})

test('PerPay does not create an order when the browser blocks its new window', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null)
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      message: 'success',
      data: { checkout_url: 'https://pay.example/checkout/token' },
    },
  })
  const walletURL = window.location.href
  const { result } = renderHook(() => usePayment())

  await act(async () => {
    expect(await result.current.processPayment(9.99, 'perpay')).toBe(false)
  })

  expect(post).not.toHaveBeenCalled()
  expect(window.location.href).toBe(walletURL)
  expect(result.current.processing).toBe(false)
})

test('a PerPay-only configuration displays recharge amounts and its payment button', () => {
  expect(getMinTopupAmount(perPayInfo)).toBe(5)
  render(
    <RechargeFormCard
      topupInfo={perPayInfo}
      presetAmounts={[{ value: 5 }, { value: 10 }]}
      selectedPreset={5}
      topupAmount={5}
      paymentAmount={5}
      calculating={false}
      loading={false}
      paymentLoading={null}
      onSelectPreset={vi.fn()}
      onTopupAmountChange={vi.fn()}
      onPaymentMethodSelect={vi.fn()}
      redemptionCode=''
      onRedemptionCodeChange={vi.fn()}
      onRedeem={vi.fn()}
      redeeming={false}
    />
  )
  expect(
    screen.getByRole('button', { name: /Alipay \(PerPay\)/ })
  ).toBeEnabled()
})

test('a PerPay-only configuration enforces its configured minimum before enabling payment', () => {
  const info: TopupInfo = {
    ...perPayInfo,
    min_topup: 1,
    pay_methods: [{ name: 'Alipay', type: 'perpay', min_topup: 20 }],
  }
  expect(getMinTopupAmount(info)).toBe(20)
  const props = {
    topupInfo: info,
    presetAmounts: [],
    selectedPreset: null,
    topupAmount: 19.99,
    paymentAmount: 19.99,
    calculating: false,
    loading: false,
    paymentLoading: null,
    onSelectPreset: vi.fn(),
    onTopupAmountChange: vi.fn(),
    onPaymentMethodSelect: vi.fn(),
    redemptionCode: '',
    onRedemptionCodeChange: vi.fn(),
    onRedeem: vi.fn(),
    redeeming: false,
  }
  const view = render(<RechargeFormCard {...props} />)
  expect(
    screen.getAllByRole('button', { name: /Pay with Alipay/ })
  ).toHaveLength(1)
  expect(screen.getByRole('button', { name: /Pay with Alipay/ })).toBeDisabled()
  expect(screen.getByRole('spinbutton')).toHaveAttribute('min', '20')

  view.rerender(
    <RechargeFormCard {...props} topupAmount={20} paymentAmount={20} />
  )
  expect(screen.getByRole('button', { name: 'Pay with Alipay' })).toBeEnabled()
})

test.each([
  { globalMinimum: 1, perPayMinimum: 20, stripeMinimum: 1, expected: 1 },
  { globalMinimum: 10, perPayMinimum: 20, stripeMinimum: 1, expected: 1 },
  { globalMinimum: 1, perPayMinimum: 1, stripeMinimum: 10, expected: 1 },
])('PerPay and Stripe retain their own minimum amounts: %o', (minimums) => {
  const info: TopupInfo = {
    ...perPayInfo,
    enable_stripe_topup: true,
    min_topup: minimums.globalMinimum,
    stripe_min_topup: minimums.stripeMinimum,
    pay_methods: [
      {
        name: 'Alipay',
        type: 'perpay',
        min_topup: minimums.perPayMinimum,
      },
      {
        name: 'Stripe',
        type: 'stripe',
        min_topup: minimums.stripeMinimum,
      },
    ],
  }
  expect(getMinTopupAmount(info)).toBe(minimums.expected)
})

test('PerPay confirmation explains exact payment and preserves the displayed recharge amount', () => {
  render(
    <PaymentConfirmDialog
      open
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
      topupAmount={9.99}
      paymentAmount={9.99}
      paymentMethod={perPayInfo.pay_methods[0]}
      calculating={false}
      processing={false}
    />
  )
  expect(
    screen.getByText(
      'Pay the exact CNY amount shown at the PerPay checkout. The checkout may add a few cents to identify the payment; wallet credit follows the selected top-up amount.'
    )
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Confirm Payment' })).toBeEnabled()
})
