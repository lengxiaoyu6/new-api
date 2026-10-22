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
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'

import { BillingHistoryDialog } from '@/features/wallet/components/dialogs/billing-history-dialog'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { CreemConfirmDialog } from '../components/dialogs/creem-confirm-dialog'
import { PaymentConfirmDialog } from '../components/dialogs/payment-confirm-dialog'
import { RechargeFormCard } from '../components/recharge-form-card'

const i18n = createInstance()

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
})

it('translates billing history statuses and updates them when the language changes', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 3,
        items: ['success', 'pending', 'expired'].map((status, id) => ({
          id,
          status,
          amount: 10,
          money: 10,
          trade_no: `order-${id}`,
          payment_method: 'stripe',
          create_time: 1,
        })),
      },
    },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <BillingHistoryDialog open onOpenChange={vi.fn()} />
    </I18nextProvider>
  )
  await screen.findByText('order-0')
  for (const label of ['成功', '待确认', '已过期']) {
    expect(screen.getByText(label)).toBeVisible()
  }
  await act(() => i18n.changeLanguage('en'))
  for (const label of ['Success', 'Pending', 'Expired']) {
    expect(screen.getByText(label)).toBeVisible()
  }
})

it.each([
  { priceRatio: 7.3, paid: '584', saved: '146', full: '146' },
  { priceRatio: 0.000123, paid: '0.0098', saved: '0.0025', full: '0.0025' },
])(
  'translates recharge presets and minimum amount without changing precision at price ratio $priceRatio',
  async ({ priceRatio, paid, saved, full }) => {
    render(
      <I18nextProvider i18n={i18n}>
        <RechargeFormCard
          topupInfo={{
            enable_online_topup: true,
            enable_stripe_topup: false,
            pay_methods: [],
            min_topup: 1,
            stripe_min_topup: 1,
            amount_options: [100, 20],
            discount: {},
          }}
          presetAmounts={[{ value: 100, discount: 0.8 }, { value: 20 }]}
          selectedPreset={null}
          topupAmount={1}
          paymentAmount={priceRatio}
          priceRatio={priceRatio}
          calculating={false}
          paymentLoading={null}
          redemptionCode=''
          redeeming={false}
          onSelectPreset={vi.fn()}
          onTopupAmountChange={vi.fn()}
          onPaymentMethodSelect={vi.fn()}
          onRedemptionCodeChange={vi.fn()}
          onRedeem={vi.fn()}
        />
      </I18nextProvider>
    )
    expect(screen.getByRole('button', { name: /^\$100 / })).toHaveTextContent(
      `优惠 20%支付 ￥${paid} • 节省 ￥${saved}`
    )
    expect(screen.getByRole('button', { name: /^\$20 / })).toHaveTextContent(
      `支付 ￥${full}`
    )
    expect(screen.getByPlaceholderText('最低 1')).toBeVisible()
    await act(() => i18n.changeLanguage('en'))
    expect(screen.getByRole('button', { name: /^\$100 / })).toHaveTextContent(
      `20% OFFPay ￥${paid} • Save ￥${saved}`
    )
    expect(screen.getByRole('button', { name: /^\$20 / })).toHaveTextContent(
      `Pay ￥${full}`
    )
    expect(screen.getByPlaceholderText('Minimum 1')).toBeVisible()
  }
)

it.each([
  { amount: 8, paid: '8', original: '10', saved: '2' },
  {
    amount: 0.008,
    paid: '0.008',
    original: '0.01',
    saved: '0.002',
  },
])(
  'shows the yuan symbol on payment, original price and savings for a payment of $amount',
  ({ amount, paid, original, saved }) => {
    render(
      <I18nextProvider i18n={i18n}>
        <PaymentConfirmDialog
          open
          onOpenChange={vi.fn()}
          onConfirm={vi.fn()}
          topupAmount={100}
          paymentAmount={amount}
          paymentMethod={{ name: 'Alipay', type: 'alipay' }}
          discountRate={0.8}
          calculating={false}
          processing={false}
        />
      </I18nextProvider>
    )
    const dialog = within(screen.getByRole('alertdialog'))
    expect(dialog.getByText(`￥${paid}`)).toBeVisible()
    expect(dialog.getByText(`￥${original}`)).toBeVisible()
    expect(dialog.getByText(`￥${saved}`)).toBeVisible()
    expect(dialog.getByText('$100')).toBeVisible()
  }
)

it.each(['alipay', 'stripe', 'waffo', 'creem'])(
  'shows the payment terms above the details in a wider %s top-up confirmation',
  async (method) => {
    const onConfirm = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        {method === 'creem' ? (
          <CreemConfirmDialog
            open
            onOpenChange={vi.fn()}
            onConfirm={onConfirm}
            processing={false}
            product={{
              productId: 'credit-10',
              name: 'Credit pack',
              price: 10,
              quota: 10,
              currency: 'USD',
            }}
          />
        ) : (
          <PaymentConfirmDialog
            open
            onOpenChange={vi.fn()}
            onConfirm={onConfirm}
            topupAmount={10}
            paymentAmount={10}
            paymentMethod={{ name: method, type: method }}
            calculating={false}
            processing={false}
          />
        )}
      </I18nextProvider>
    )

    const notice = screen.getByRole('note', { name: '付款须知' })
    expect(
      within(notice).getByText(
        '请仔细阅读以下内容，若您付款后则代表您已阅读并同意以下协议。'
      )
    ).toBeVisible()
    const clauses = within(notice).getAllByRole('listitem')
    expect(clauses).toHaveLength(2)
    expect(clauses[0]).toHaveTextContent(
      '如OpenAI、Anthropic 等渠道对配额、价格或其他政策进行调整，本站有权据此对相关产品的倍率、定价及服务内容进行同步调整，并将通过站内公告、交流群等途径予以说明。'
    )
    expect(clauses[1]).toHaveTextContent(
      '您承诺合法使用本站服务，不得用于违法、违规、侵权、欺诈、恶意攻击、破坏网络安全或其他危害社会公共利益及他人合法权益的活动。'
    )
    const confirm = screen.getByRole('button', { name: '确认付款' })
    const details = screen.getByText(method === 'creem' ? '产品' : '充值金额')
    expect(
      notice.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByRole(method === 'creem' ? 'dialog' : 'alertdialog')
    ).toHaveClass('w-[calc(100vw-1.5rem)]', '!max-w-[600px]')
    expect(
      notice.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  }
)

it('updates the full payment terms when the interface language changes', async () => {
  render(
    <I18nextProvider i18n={i18n}>
      <PaymentConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        topupAmount={10}
        paymentAmount={10}
        paymentMethod={{ name: 'Alipay', type: 'alipay' }}
        calculating={false}
        processing={false}
      />
    </I18nextProvider>
  )
  expect(screen.getByRole('note', { name: '付款须知' })).toBeVisible()
  await act(() => i18n.changeLanguage('en'))
  const notice = screen.getByRole('note', { name: 'Payment Terms' })
  expect(notice).toHaveTextContent(
    'Please read the following carefully. By making a payment, you acknowledge that you have read and agreed to the following terms.'
  )
  const clauses = within(notice).getAllByRole('listitem')
  expect(clauses[0]).toHaveTextContent(
    'If providers such as OpenAI or Anthropic adjust quotas, prices, or other policies'
  )
  expect(clauses[1]).toHaveTextContent('You agree to use this site lawfully')
})
