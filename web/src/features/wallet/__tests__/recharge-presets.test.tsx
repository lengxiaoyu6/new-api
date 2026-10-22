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
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { RechargeFormCard } from '../components/recharge-form-card'
import { usePayment } from '../hooks/use-payment'
import { useTopupInfo } from '../hooks/use-topup-info'
import { useWaffoPancakePayment } from '../hooks/use-waffo-pancake-payment'
import { useWaffoPayment } from '../hooks/use-waffo-payment'
import type { TopupInfo } from '../types'

function RechargeFixture() {
  const { topupInfo, presetAmounts, loading } = useTopupInfo()
  const [amount, setAmount] = useState(0)
  return (
    <RechargeFormCard
      topupInfo={topupInfo}
      presetAmounts={presetAmounts}
      loading={loading}
      selectedPreset={amount}
      topupAmount={amount}
      paymentAmount={amount}
      calculating={false}
      paymentLoading={null}
      redemptionCode=''
      redeeming={false}
      onSelectPreset={(preset) => setAmount(preset.value)}
      onTopupAmountChange={setAmount}
      onPaymentMethodSelect={vi.fn()}
      onRedemptionCodeChange={vi.fn()}
      onRedeem={vi.fn()}
    />
  )
}

test('keeps fractional preset and custom amounts when selecting and editing', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enable_online_topup: true,
        enable_stripe_topup: false,
        pay_methods: [],
        min_topup: 1,
        stripe_min_topup: 1,
        amount_options: [9.99, 19.99, 29.99, 49.99, 99.99],
        discount: {},
      },
    },
  })
  const user = userEvent.setup()
  render(<RechargeFixture />)
  await user.click(await screen.findByRole('button', { name: '$9.99' }))
  expect(screen.getByRole('button', { name: '$9.99' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Custom Amount' }))
  const input = screen.getByRole('spinbutton', { name: 'Custom Amount' })
  expect(input).toHaveValue(9.99)
  await user.clear(input)
  await user.type(input, '19.99')
  expect(screen.getByText('￥19.99', { selector: 'span' })).toBeVisible()
})

const onlineTopupInfo: TopupInfo = {
  enable_online_topup: true,
  enable_stripe_topup: false,
  enable_redemption: true,
  pay_methods: [{ name: 'Alipay', type: 'alipay' }],
  min_topup: 1,
  stripe_min_topup: 1,
  amount_options: [9.99, 19.99, 29.99, 49.99, 99.99],
  discount: {},
}

function RechargeLayoutFixture(
  props: Partial<ComponentProps<typeof RechargeFormCard>>
) {
  const [amount, setAmount] = useState(9.99)
  const [selectedPreset, setSelectedPreset] = useState<number | null>(9.99)
  const [code, setCode] = useState('')
  return (
    <RechargeFormCard
      topupInfo={onlineTopupInfo}
      presetAmounts={onlineTopupInfo.amount_options.map((value) => ({ value }))}
      selectedPreset={selectedPreset}
      topupAmount={amount}
      paymentAmount={amount}
      calculating={false}
      paymentLoading={null}
      redemptionCode={code}
      redeeming={false}
      onSelectPreset={(preset) => {
        setAmount(preset.value)
        setSelectedPreset(preset.value)
      }}
      onTopupAmountChange={(value) => {
        setAmount(value)
        setSelectedPreset(null)
      }}
      onPaymentMethodSelect={vi.fn()}
      onRedemptionCodeChange={setCode}
      onRedeem={vi.fn()}
      {...props}
    />
  )
}

test('opens online top-up by default and preserves both forms when switching tabs', async () => {
  const onRedeem = vi.fn()
  const user = userEvent.setup()
  render(<RechargeLayoutFixture onRedeem={onRedeem} />)
  expect(screen.getByRole('tab', { name: 'Online Top-up' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Custom Amount' }))
  const amount = screen.getByRole('spinbutton', { name: 'Custom Amount' })
  await user.clear(amount)
  await user.type(amount, '12.34')

  await user.click(screen.getByRole('tab', { name: 'Redemption Code' }))
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  const code = screen.getByRole('textbox', { name: 'Redemption Code' })
  expect(
    screen.queryByRole('link', { name: 'Buy a redemption code' })
  ).not.toBeInTheDocument()
  const redeem = screen.getByRole('button', { name: 'Redeem' })
  expect(redeem).toBeDisabled()
  await user.type(code, 'wallet-code')
  expect(redeem).toBeEnabled()
  await user.keyboard('{Enter}')
  expect(onRedeem).toHaveBeenCalledOnce()

  await user.click(screen.getByRole('tab', { name: 'Online Top-up' }))
  expect(screen.getByRole('spinbutton')).toHaveValue(12.34)
  expect(screen.getByRole('button', { name: 'Custom Amount' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await user.click(screen.getByRole('button', { name: '$19.99' }))
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '$19.99' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await user.click(screen.getByRole('tab', { name: 'Redemption Code' }))
  expect(screen.getByRole('textbox')).toHaveValue('wallet-code')
})

test('supports arrow-key tab navigation and keeps order history available in either tab', async () => {
  const onOpenBilling = vi.fn()
  const user = userEvent.setup()
  render(<RechargeLayoutFixture onOpenBilling={onOpenBilling} />)
  screen.getByRole('tab', { name: 'Online Top-up' }).focus()
  await user.keyboard('{ArrowRight}')
  const redemption = screen.getByRole('tab', { name: 'Redemption Code' })
  expect(redemption).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(redemption).toHaveAttribute('aria-selected', 'true')
  await user.click(screen.getByRole('button', { name: 'Order History' }))
  expect(onOpenBilling).toHaveBeenCalledOnce()
})

test('opens redemption when online top-up is unavailable and shows its purchase link', () => {
  render(
    <RechargeLayoutFixture
      topupInfo={{ ...onlineTopupInfo, enable_online_topup: false }}
      topupLink='https://example.com/codes'
    />
  )
  expect(screen.getByRole('tab', { name: 'Redemption Code' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByRole('textbox', { name: 'Redemption Code' })).toBeVisible()
  const purchaseLink = screen.getByRole('link', {
    name: 'Buy a redemption code',
  })
  expect(purchaseLink).toHaveAttribute('href', 'https://example.com/codes')
  expect(purchaseLink).toHaveAttribute('target', '_blank')
  expect(purchaseLink).toHaveAttribute('rel', 'noopener noreferrer')
})

test('shows the disabled redemption explanation without accepting a code', async () => {
  render(
    <RechargeLayoutFixture
      topupInfo={{ ...onlineTopupInfo, enable_redemption: false }}
      topupLink='https://example.com/codes'
    />
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Redemption Code' }))
  expect(
    screen.getByText(
      'Redemption codes are disabled until the administrator confirms compliance terms.'
    )
  ).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Buy a redemption code' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Redeem' })
  ).not.toBeInTheDocument()
})

test('shows custom input without presets and keeps the minimum payment limit', () => {
  render(
    <RechargeLayoutFixture
      presetAmounts={[]}
      selectedPreset={null}
      topupInfo={{
        ...onlineTopupInfo,
        pay_methods: [{ name: 'Alipay', type: 'alipay', min_topup: 20 }],
      }}
    />
  )
  expect(screen.getByRole('spinbutton')).toHaveValue(9.99)
  expect(
    screen.getByRole('button', {
      name: /Pay with Alipay. Minimum topup amount: 20/,
    })
  ).toBeDisabled()
})

test('passes the selected payment method to confirmation and blocks duplicate submissions while loading', async () => {
  const onPaymentMethodSelect = vi.fn()
  const view = render(
    <RechargeLayoutFixture onPaymentMethodSelect={onPaymentMethodSelect} />
  )
  await userEvent.click(screen.getByRole('button', { name: 'Pay with Alipay' }))
  expect(onPaymentMethodSelect).toHaveBeenCalledExactlyOnceWith({
    name: 'Alipay',
    type: 'alipay',
  })
  view.rerender(
    <RechargeLayoutFixture
      onPaymentMethodSelect={onPaymentMethodSelect}
      paymentLoading='alipay'
    />
  )
  expect(screen.getByRole('button', { name: 'Pay with Alipay' })).toBeDisabled()
})

test('keeps Waffo and Creem options in the online tab with their original callbacks', async () => {
  const onWaffoMethodSelect = vi.fn()
  const onCreemProductSelect = vi.fn()
  const waffoMethod = { name: 'Waffo card', payMethodType: 'card' }
  const product = {
    productId: 'creem-10',
    name: 'Credit pack',
    price: 10,
    quota: 10,
    currency: 'USD' as const,
  }
  render(
    <RechargeLayoutFixture
      enableWaffoTopup
      waffoPayMethods={[waffoMethod]}
      onWaffoMethodSelect={onWaffoMethodSelect}
      enableCreemTopup
      creemProducts={[product]}
      onCreemProductSelect={onCreemProductSelect}
    />
  )
  const panel = screen.getByRole('tabpanel', { name: 'Online Top-up' })
  await userEvent.click(
    within(panel).getByRole('button', { name: 'Pay with Waffo card' })
  )
  expect(onWaffoMethodSelect).toHaveBeenCalledExactlyOnceWith(waffoMethod, 0)
  await userEvent.click(within(panel).getByText('Credit pack'))
  expect(onCreemProductSelect).toHaveBeenCalledExactlyOnceWith(product)
})

test.each([
  { method: 'alipay', endpoint: '/api/user/pay' },
  { method: 'stripe', endpoint: '/api/user/stripe/pay' },
  { method: 'waffo', endpoint: '/api/user/waffo/pay' },
  { method: 'waffo_pancake', endpoint: '/api/user/waffo-pancake/pay' },
])(
  'submits the full fractional amount to $method',
  async ({ method, endpoint }) => {
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { message: 'success', data: {} },
    })
    const { result } = renderHook(() => ({
      payment: usePayment(),
      waffo: useWaffoPayment(),
      pancake: useWaffoPancakePayment(),
    }))
    await act(async () => {
      if (method === 'waffo') {
        await result.current.waffo.processWaffoPayment(9.99, 0)
      } else if (method === 'waffo_pancake') {
        await result.current.pancake.processWaffoPancakePayment(9.99)
      } else {
        await result.current.payment.processPayment(9.99, method)
      }
    })
    expect(api.post).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({ amount: 9.99 }),
      expect.anything()
    )
  }
)
