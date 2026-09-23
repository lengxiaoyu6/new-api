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
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { handleServerError } from '@/lib/handle-server-error'

import { createLotteryActivity } from '../api'
import {
  getLotteryActivityFormSchema,
  shanghaiLocalDateTimeToUnix,
  type LotteryActivityFormValues,
} from '../lib/forms'

const DEFAULT_VALUES: LotteryActivityFormValues = {
  name: '',
  startAt: '',
  endAt: '',
  consumeStartAt: '',
  consumeEndAt: '',
  maxAttempts: 2,
}

export function LotteryActivityForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const schema = getLotteryActivityFormSchema(t)
  const form = useForm<LotteryActivityFormValues>({
    resolver: zodResolver(schema) as Resolver<LotteryActivityFormValues>,
    defaultValues: DEFAULT_VALUES,
  })
  const mutation = useMutation({
    mutationFn: (value: LotteryActivityFormValues) =>
      createLotteryActivity({
        name: value.name.trim(),
        start_at: shanghaiLocalDateTimeToUnix(value.startAt),
        end_at: shanghaiLocalDateTimeToUnix(value.endAt),
        consume_start_at: shanghaiLocalDateTimeToUnix(value.consumeStartAt),
        consume_end_at: shanghaiLocalDateTimeToUnix(value.consumeEndAt),
        max_attempts: value.maxAttempts,
      }),
    onSuccess: async (response) => {
      if (!response.success) {
        throw new Error(
          response.message || t('Unable to create lottery activity')
        )
      }
      toast.success(t('Lottery activity created'))
      form.reset(DEFAULT_VALUES)
      await queryClient.invalidateQueries({
        queryKey: ['lottery-admin-activities'],
      })
    },
    onError: (error) =>
      handleServerError(error, t('Unable to create lottery activity')),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Create activity')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit((value) => mutation.mutate(value))}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor='lottery-activity-name'>
                {t('Activity name')}
              </FieldLabel>
              <Input
                id='lottery-activity-name'
                aria-invalid={!!form.formState.errors.name}
                {...form.register('name')}
              />
              <FieldError>{form.formState.errors.name?.message}</FieldError>
            </Field>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field data-invalid={!!form.formState.errors.startAt}>
                <FieldLabel htmlFor='lottery-activity-start'>
                  {t('Activity start')}
                </FieldLabel>
                <Input
                  id='lottery-activity-start'
                  type='datetime-local'
                  aria-invalid={!!form.formState.errors.startAt}
                  {...form.register('startAt')}
                />
                <FieldError>
                  {form.formState.errors.startAt?.message}
                </FieldError>
              </Field>
              <Field data-invalid={!!form.formState.errors.endAt}>
                <FieldLabel htmlFor='lottery-activity-end'>
                  {t('Activity end')}
                </FieldLabel>
                <Input
                  id='lottery-activity-end'
                  type='datetime-local'
                  aria-invalid={!!form.formState.errors.endAt}
                  {...form.register('endAt')}
                />
                <FieldError>{form.formState.errors.endAt?.message}</FieldError>
              </Field>
              <Field data-invalid={!!form.formState.errors.consumeStartAt}>
                <FieldLabel htmlFor='lottery-spend-start'>
                  {t('Spend window start')}
                </FieldLabel>
                <Input
                  id='lottery-spend-start'
                  type='datetime-local'
                  aria-invalid={!!form.formState.errors.consumeStartAt}
                  {...form.register('consumeStartAt')}
                />
                <FieldError>
                  {form.formState.errors.consumeStartAt?.message}
                </FieldError>
              </Field>
              <Field data-invalid={!!form.formState.errors.consumeEndAt}>
                <FieldLabel htmlFor='lottery-spend-end'>
                  {t('Spend window end')}
                </FieldLabel>
                <Input
                  id='lottery-spend-end'
                  type='datetime-local'
                  aria-invalid={!!form.formState.errors.consumeEndAt}
                  {...form.register('consumeEndAt')}
                />
                <FieldError>
                  {form.formState.errors.consumeEndAt?.message}
                </FieldError>
              </Field>
            </div>
            <Field data-invalid={!!form.formState.errors.maxAttempts}>
              <FieldLabel htmlFor='lottery-max-attempts'>
                {t('Maximum daily draws')}
              </FieldLabel>
              <Input
                id='lottery-max-attempts'
                type='number'
                min={1}
                max={2}
                step={1}
                aria-invalid={!!form.formState.errors.maxAttempts}
                {...form.register('maxAttempts', { valueAsNumber: true })}
              />
              <FieldError>
                {form.formState.errors.maxAttempts?.message}
              </FieldError>
            </Field>
            <Button type='submit' disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Spinner aria-hidden='true' />
              ) : (
                <Plus aria-hidden='true' />
              )}
              {t('Create activity')}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
