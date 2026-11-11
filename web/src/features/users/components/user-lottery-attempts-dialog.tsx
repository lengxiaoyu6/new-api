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
import { useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
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
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { grantAllUsersLotteryAttempts, grantUserLotteryAttempts } from '../api'
import {
  lotteryAttemptsFormSchema,
  type LotteryAttemptsFormValues,
} from '../lib/user-form'

interface UserLotteryAttemptsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user?: { id: number; username: string }
}

export function UserLotteryAttemptsDialog(
  props: UserLotteryAttemptsDialogProps
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [confirmation, setConfirmation] =
    useState<LotteryAttemptsFormValues | null>(null)
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
    mutationFn: async (values: LotteryAttemptsFormValues) => {
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
      if (props.user) {
        await grantUserLotteryAttempts(props.user.id, request.current)
        return null
      }
      const response = await grantAllUsersLotteryAttempts(request.current)
      if (!response.data) throw new Error(t('Failed to add draw attempts'))
      return response.data.users_count
    },
    onSuccess: (usersCount) => {
      toast.success(
        usersCount == null
          ? t('Draw attempts added successfully')
          : t('Draw attempts granted to {{users}} users', {
              users: formatNumber(usersCount, locale),
            })
      )
      setConfirmation(null)
      request.current = null
      form.reset()
      props.onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['lottery-activities'] })
      void queryClient.invalidateQueries({
        queryKey: ['lottery-attempt-history'],
      })
    },
    onError: (error) =>
      handleServerError(error, t('Failed to add draw attempts')),
  })

  return (
    <>
      <Dialog
        open={props.open && confirmation == null}
        onOpenChange={(open) => {
          if (!mutation.isPending) props.onOpenChange(open)
        }}
        title={
          props.user
            ? t('Add draw attempts')
            : t('Grant draw attempts to all users')
        }
        description={
          props.user
            ? t('Add draw attempts for {{username}}.', {
                username: props.user.username,
              })
            : t(
                'Grant to every existing account, including administrators and disabled accounts. Deleted accounts are excluded. List filters do not affect recipients.'
              )
        }
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
            onSubmit={form.handleSubmit((values) => {
              if (props.user) mutation.mutate(values)
              else setConfirmation(values)
            })}
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
      <ConfirmDialog
        open={props.open && confirmation != null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setConfirmation(null)
        }}
        title={t('Grant draw attempts to all users')}
        desc={t('Grant {{attempts}} draw attempts to each existing user?', {
          attempts: formatNumber(Number(confirmation?.count ?? 0), locale),
        })}
        confirmText={
          mutation.isPending ? t('Processing...') : t('Confirm grant')
        }
        isLoading={mutation.isPending}
        handleConfirm={() => {
          if (confirmation && !mutation.isPending) mutation.mutate(confirmation)
        }}
      />
    </>
  )
}
