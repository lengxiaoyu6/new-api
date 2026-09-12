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
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { useCreateWithdrawal } from '../hooks'

interface WithdrawalDialogProps {
  availableQuota: number
  onOpenChange: (open: boolean) => void
}

export function WithdrawalDialog(props: WithdrawalDialogProps) {
  const { t } = useTranslation()
  const [requestId] = useState(() => crypto.randomUUID())
  const mutation = useCreateWithdrawal()
  const verification = useSecureVerification()
  const schema = z.object({
    amount: z
      .number()
      .positive()
      .refine((amount) => {
        const quota = parseQuotaFromDollars(amount)
        return (
          Number.isSafeInteger(quota) &&
          quota > 0 &&
          quota <= props.availableQuota
        )
      }),
    method: z.string().trim().min(1).max(64),
    account_name: z.string().trim().min(1).max(100),
    account: z.string().trim().min(1).max(200),
  })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      amount: quotaUnitsToDollars(props.availableQuota),
      method: '',
      account_name: '',
      account: '',
    },
  })
  const busy =
    form.formState.isSubmitting || mutation.isPending || verification.isActive
  const settlementAmount =
    parseQuotaFromDollars(form.watch('amount')) /
    getCurrencyDisplay().config.quotaPerUnit
  const submit = form.handleSubmit(async (values) => {
    const request = {
      request_id: requestId,
      quota: parseQuotaFromDollars(values.amount),
      method: values.method,
      account_name: values.account_name,
      account: values.account,
    }
    try {
      const proof = await verification.requestVerification({
        scope: 'affiliate.withdraw',
        context: request,
        title: t('Confirm withdrawal'),
        description: `${values.amount} ${getCurrencyLabel()} · ${request.method} · ${request.account_name} · ${request.account}`,
      })
      if (!proof) return
      await mutation.mutateAsync({ request, proof: proof.proof_token })
      props.onOpenChange(false)
    } catch (error) {
      handleServerError(error)
    }
  })

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!busy) props.onOpenChange(open)
        }}
        title={t('Request withdrawal')}
        description={t(
          'Withdrawal requests are reviewed and paid manually by an administrator.'
        )}
        contentClassName='sm:max-w-md'
        footer={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => props.onOpenChange(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              form='withdrawal-form'
              disabled={
                busy || !form.formState.isValid || props.availableQuota <= 0
              }
            >
              {t('Submit request')}
            </Button>
          </>
        }
      >
        <p className='text-muted-foreground mb-4 text-sm'>
          {t('Withdrawable rebates')}: {formatQuota(props.availableQuota)}
        </p>
        <form id='withdrawal-form' onSubmit={submit}>
          <FieldGroup>
            <Field
              data-invalid={Boolean(form.formState.errors.amount)}
              data-disabled={busy}
            >
              <FieldLabel htmlFor='withdrawal-amount'>
                {t('Withdrawal amount')} · {getCurrencyLabel()}
              </FieldLabel>
              <Input
                id='withdrawal-amount'
                type='number'
                step='any'
                min={0}
                max={quotaUnitsToDollars(props.availableQuota)}
                disabled={busy}
                aria-invalid={Boolean(form.formState.errors.amount)}
                {...form.register('amount', { valueAsNumber: true })}
              />
              {form.formState.errors.amount && (
                <p role='alert' className='text-destructive text-sm'>
                  {t('Enter an amount within the withdrawable balance.')}
                </p>
              )}
            </Field>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor='withdrawal-method'>
                {t('Payout method')}
              </FieldLabel>
              <Input
                id='withdrawal-method'
                maxLength={64}
                disabled={busy}
                aria-invalid={Boolean(form.formState.errors.method)}
                {...form.register('method')}
              />
            </Field>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor='withdrawal-name'>
                {t('Account holder')}
              </FieldLabel>
              <Input
                id='withdrawal-name'
                maxLength={100}
                disabled={busy}
                aria-invalid={Boolean(form.formState.errors.account_name)}
                {...form.register('account_name')}
              />
            </Field>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor='withdrawal-account'>
                {t('Payout account')}
              </FieldLabel>
              <Input
                id='withdrawal-account'
                maxLength={200}
                disabled={busy}
                aria-invalid={Boolean(form.formState.errors.account)}
                {...form.register('account')}
              />
            </Field>
          </FieldGroup>
        </form>
        <p className='mt-4 text-sm'>
          {t('Withdrawal amount')} · USD: {settlementAmount.toLocaleString(undefined, { maximumFractionDigits: 12 })}
        </p>
        <p className='text-muted-foreground mt-4 text-sm'>
          {t(
            'Requested funds are reserved until paid or rejected. Rejected funds become withdrawable again.'
          )}
        </p>
      </Dialog>
      <SecureVerificationDialog {...verification.dialogProps} />
    </>
  )
}
