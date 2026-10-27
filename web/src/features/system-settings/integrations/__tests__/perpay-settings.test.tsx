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
import { useState, type ComponentProps } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { PaymentSettingsSection } from '../payment-settings-section'

type PaymentProps = ComponentProps<typeof PaymentSettingsSection>
const defaults: PaymentProps = {
  defaultValues: {
    PerPayEnabled: false,
    PerPayURL: '',
    PerPayClientID: '',
    PerPayAPISecret: '',
    PerPayWebhookSecret: '',
    PayAddress: '',
    EpayId: '',
    EpayKey: '',
    Price: 7.3,
    MinTopUp: 1,
    CustomCallbackAddress: '',
    PayMethods: '[]',
    AmountOptions: '[5,10]',
    AmountDiscount: '{}',
    StripeApiSecret: '',
    StripeWebhookSecret: '',
    StripePriceId: '',
    StripeUnitPrice: 1,
    StripeMinTopUp: 1,
    StripePromotionCodesEnabled: false,
    CreemApiKey: '',
    CreemWebhookSecret: '',
    CreemProducts: '[]',
    CreemTestMode: false,
  },
  waffoDefaultValues: {
    WaffoEnabled: false,
    WaffoApiKey: '',
    WaffoPrivateKey: '',
    WaffoPublicCert: '',
    WaffoSandboxPublicCert: '',
    WaffoSandboxApiKey: '',
    WaffoSandboxPrivateKey: '',
    WaffoSandbox: false,
    WaffoMerchantId: '',
    WaffoCurrency: 'USD',
    WaffoUnitPrice: 1,
    WaffoMinTopUp: 1,
    WaffoNotifyUrl: '',
    WaffoReturnUrl: '',
    WaffoPayMethods: '[]',
  },
  waffoPancakeDefaultValues: {
    WaffoPancakeMerchantID: '',
    WaffoPancakePrivateKey: '',
    WaffoPancakeReturnURL: '',
  },
  complianceDefaults: {
    confirmed: true,
    termsVersion: 'v1',
    confirmedAt: 0,
    confirmedBy: 1,
  },
}

function PaymentFixture(props: { enabled?: boolean }) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div ref={setActions} />
      <PaymentSettingsSection
        {...defaults}
        defaultValues={{
          ...defaults.defaultValues,
          PerPayEnabled: props.enabled ?? false,
        }}
      />
    </SettingsPageProvider>
  )
}

function renderPayment(enabled = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PaymentFixture enabled={enabled} />
    </QueryClientProvider>
  )
  return userEvent.setup()
}

afterEach(() => vi.restoreAllMocks())

test('PerPay configuration saves credentials before enabling payment and masks both secrets', async () => {
  const request = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = renderPayment()
  await user.click(screen.getByRole('tab', { name: /^PerPay$/ }))
  await user.type(
    screen.getByLabelText('PerPay endpoint'),
    'https://pay.example'
  )
  await user.type(screen.getByLabelText('PerPay client ID'), 'site-client')
  const apiSecret = screen.getByLabelText('PerPay API secret')
  const webhookSecret = screen.getByLabelText('PerPay webhook secret')
  expect(apiSecret).toHaveAttribute('type', 'password')
  expect(webhookSecret).toHaveAttribute('type', 'password')
  await user.type(apiSecret, 'a'.repeat(43))
  await user.type(webhookSecret, 'b'.repeat(43))
  await user.click(screen.getByRole('switch', { name: 'Enable PerPay' }))
  await user.click(screen.getByRole('button', { name: 'Save all settings' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(5))
  expect(request.mock.calls.map((call) => call[1])).toEqual([
    { key: 'PerPayURL', value: 'https://pay.example' },
    { key: 'PerPayClientID', value: 'site-client' },
    { key: 'PerPayAPISecret', value: 'a'.repeat(43) },
    { key: 'PerPayWebhookSecret', value: 'b'.repeat(43) },
    { key: 'PerPayEnabled', value: true },
  ])
})

test('disabling PerPay does not overwrite existing secrets with empty form fields', async () => {
  const request = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = renderPayment(true)
  await user.click(screen.getByRole('tab', { name: /^PerPay$/ }))
  await user.click(screen.getByRole('switch', { name: 'Enable PerPay' }))
  await user.click(screen.getByRole('button', { name: 'Save all settings' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  expect(request).toHaveBeenCalledWith('/api/option/', {
    key: 'PerPayEnabled',
    value: false,
  })
})
