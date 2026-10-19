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
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { RechargeFormCard } from '../components/recharge-form-card'
import { usePayment } from '../hooks/use-payment'
import { useTopupInfo } from '../hooks/use-topup-info'
import { useWaffoPancakePayment } from '../hooks/use-waffo-pancake-payment'
import { useWaffoPayment } from '../hooks/use-waffo-payment'

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
  await user.click(await screen.findByRole('button', { name: '9.99 Pay 9.99' }))
  const input = screen.getByRole('spinbutton', { name: 'Custom Amount' })
  expect(input).toHaveValue(9.99)
  await user.clear(input)
  await user.type(input, '19.99')
  expect(screen.getByText('19.99', { selector: 'span' })).toBeVisible()
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
