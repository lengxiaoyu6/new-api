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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useRef } from 'react'
import { Controller, useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { addLotteryStock } from '../api'
import {
  getLotteryStockFormSchema,
  type LotteryStockFormValues,
} from '../lib/forms'
import type { LotteryAdminPrize } from '../types'

type LotteryStockFormProps = {
  activityId: number
  prizes: LotteryAdminPrize[]
}

export function LotteryStockForm(props: LotteryStockFormProps) {
  const { t } = useTranslation()
  const prizeOptions = props.prizes.map((prize) => ({
    value: String(prize.id),
    label: `${prize.code} · ${formatQuota(prize.balance_quota)} · ${prize.issued_stock}/${prize.total_stock}`,
  }))
  const queryClient = useQueryClient()
  const form = useForm<LotteryStockFormValues>({
    resolver: zodResolver(
      getLotteryStockFormSchema(t)
    ) as Resolver<LotteryStockFormValues>,
    defaultValues: { prizeId: 0, delta: 1, reason: '' },
  })
  const pendingRequest = useRef<{ fingerprint: string; id: string } | null>(
    null
  )
  const mutation = useMutation({
    mutationFn: (request: {
      value: LotteryStockFormValues
      requestId: string
    }) =>
      addLotteryStock(props.activityId, {
        prize_id: request.value.prizeId,
        delta: request.value.delta,
        request_id: request.requestId,
        reason: request.value.reason.trim(),
      }),
    onSuccess: async (response) => {
      if (!response.success) {
        throw new Error(response.message || t('Unable to adjust lottery stock'))
      }
      toast.success(t('Lottery stock adjusted'))
      pendingRequest.current = null
      form.reset({ prizeId: form.getValues('prizeId'), delta: 1, reason: '' })
      await queryClient.invalidateQueries({
        queryKey: ['lottery-admin-versions', props.activityId],
      })
    },
    onError: (error) =>
      handleServerError(error, t('Unable to adjust lottery stock')),
  })

  const submit = (value: LotteryStockFormValues) => {
    const fingerprint = JSON.stringify(value)
    if (pendingRequest.current?.fingerprint !== fingerprint) {
      pendingRequest.current = { fingerprint, id: crypto.randomUUID() }
    }
    mutation.mutate({ value, requestId: pendingRequest.current.id })
  }

  return (
    <form onSubmit={form.handleSubmit(submit)}>
      <FieldGroup>
        <Field data-invalid={!!form.formState.errors.prizeId}>
          <FieldLabel htmlFor='lottery-stock-prize'>
            {t('Balance prize')}
          </FieldLabel>
          <Controller
            control={form.control}
            name='prizeId'
            render={({ field }) => (
              <Select
                items={prizeOptions}
                value={field.value > 0 ? String(field.value) : null}
                onValueChange={(value) => field.onChange(Number(value))}
              >
                <SelectTrigger
                  id='lottery-stock-prize'
                  className='w-full'
                  aria-invalid={!!form.formState.errors.prizeId}
                >
                  <SelectValue placeholder={t('Select a balance prize')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {prizeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          />
          <FieldError>{form.formState.errors.prizeId?.message}</FieldError>
        </Field>
        <Field data-invalid={!!form.formState.errors.delta}>
          <FieldLabel htmlFor='lottery-stock-delta'>
            {t('Stock amount')}
          </FieldLabel>
          <Input
            id='lottery-stock-delta'
            type='number'
            min={1}
            step={1}
            inputMode='numeric'
            aria-invalid={!!form.formState.errors.delta}
            {...form.register('delta', { valueAsNumber: true })}
          />
          <FieldError>{form.formState.errors.delta?.message}</FieldError>
        </Field>
        <Field data-invalid={!!form.formState.errors.reason}>
          <FieldLabel htmlFor='lottery-stock-reason'>{t('Reason')}</FieldLabel>
          <Input
            id='lottery-stock-reason'
            aria-invalid={!!form.formState.errors.reason}
            {...form.register('reason')}
          />
          <FieldError>{form.formState.errors.reason?.message}</FieldError>
        </Field>
        <Button
          type='submit'
          disabled={mutation.isPending || props.prizes.length === 0}
        >
          {mutation.isPending ? (
            <Spinner aria-hidden='true' />
          ) : (
            <Plus aria-hidden='true' />
          )}
          {t('Add lottery stock')}
        </Button>
      </FieldGroup>
    </form>
  )
}
