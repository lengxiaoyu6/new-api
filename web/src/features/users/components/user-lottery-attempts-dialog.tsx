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
import { useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { grantUserLotteryAttempts } from '../api'
import {
  lotteryAttemptsFormSchema,
  type LotteryAttemptsFormValues,
} from '../lib/user-form'

interface UserLotteryAttemptsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: number; username: string }
}

export function UserLotteryAttemptsDialog(
  props: UserLotteryAttemptsDialogProps
) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const formId = useId()
  const request = useRef<{
    count: number
    reason: string
    request_id: string
  } | null>(null)
  const form = useForm<LotteryAttemptsFormValues>({
    resolver: zodResolver(lotteryAttemptsFormSchema),
    defaultValues: { count: '1', reason: '' },
  })
  const mutation = useMutation({
    mutationFn: (values: LotteryAttemptsFormValues) => {
      const count = Number(values.count)
      if (
        !request.current ||
        request.current.count !== count ||
        request.current.reason !== values.reason
      ) {
        request.current = {
          count,
          reason: values.reason,
          request_id: crypto.randomUUID(),
        }
      }
      return grantUserLotteryAttempts(props.user.id, request.current)
    },
    onSuccess: () => {
      toast.success(t('Draw attempts added successfully'))
      request.current = null
      form.reset()
      props.onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['lottery-activities'] })
    },
    onError: (error) =>
      handleServerError(error, t('Failed to add draw attempts')),
  })

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!mutation.isPending) props.onOpenChange(open)
      }}
      title={t('Add draw attempts')}
      description={t('Add draw attempts for {{username}}.', {
        username: props.user.username,
      })}
      contentClassName='sm:max-w-md'
      footer={
        <>
          <Button
            variant='outline'
            disabled={mutation.isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={formId} disabled={mutation.isPending}>
            {mutation.isPending ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={formId}
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className='space-y-4'
          noValidate
        >
          <FormField
            control={form.control}
            name='count'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Draw attempts')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    min={1}
                    max={1_000_000}
                    step={1}
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='reason'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Reason')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    maxLength={255}
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
