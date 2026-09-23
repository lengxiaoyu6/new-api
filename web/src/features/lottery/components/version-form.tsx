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
import { Plus, Send, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Resolver,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
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
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, quotaUnitsToEditableAmount } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { createLotteryVersion } from '../api'
import {
  DEFAULT_LOTTERY_PRIZES,
  getLotteryVersionFormSchema,
  lotteryVersionFormToPayload,
  type LotteryVersionFormValues,
} from '../lib/forms'
import type { LotteryAdminVersion } from '../types'

type LotteryVersionFormProps = {
  activityId: number
  activityName: string
  latestVersion?: LotteryAdminVersion
}

function tomorrowInShanghai(): string {
  return new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function nextDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return tomorrowInShanghai()
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

function localizedValue(
  values: Record<string, string>,
  locale: string
): string {
  return (
    values[locale] ||
    values.en ||
    values.zh ||
    Object.values(values).find(Boolean) ||
    ''
  )
}

function versionDefaults(
  activityName: string,
  latestVersion: LotteryAdminVersion | undefined,
  locale: string,
  defaultRule: string
): LotteryVersionFormValues {
  if (!latestVersion) {
    return {
      businessDate: tomorrowInShanghai(),
      thresholdAmount: 0,
      title: activityName,
      ruleText: defaultRule,
      prizes: DEFAULT_LOTTERY_PRIZES.map((prize) => ({ ...prize })),
    }
  }
  return {
    businessDate: nextDate(latestVersion.business_date),
    thresholdAmount: quotaUnitsToEditableAmount(latestVersion.threshold_quota),
    title: localizedValue(latestVersion.title, locale) || activityName,
    ruleText: localizedValue(latestVersion.rule_text, locale) || defaultRule,
    prizes: latestVersion.prizes.map((prize) => ({
      code: prize.code,
      type:
        prize.type === 'again' || prize.type === 'thanks'
          ? prize.type
          : 'balance',
      balanceAmount: prize.balance_amount,
      totalStock: prize.total_stock,
      dailyLimit: prize.daily_limit,
      probability: prize.weight / 10000,
      title: localizedValue(prize.title, locale),
      description: localizedValue(prize.description, locale),
    })),
  }
}

export function LotteryVersionForm(props: LotteryVersionFormProps) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language) || 'en'
  const defaultRule = t(
    'Spend the required amount during the configured period to draw once.'
  )
  const schema = getLotteryVersionFormSchema(t)
  const form = useForm<LotteryVersionFormValues>({
    resolver: zodResolver(schema) as Resolver<LotteryVersionFormValues>,
    defaultValues: versionDefaults(
      props.activityName,
      props.latestVersion,
      locale,
      defaultRule
    ),
  })
  const prizes = useWatch({ control: form.control, name: 'prizes' })
  const prizeFields = useFieldArray({ control: form.control, name: 'prizes' })
  const probabilityTotal = prizes.reduce(
    (total, prize) =>
      total + (Number.isFinite(prize.probability) ? prize.probability : 0),
    0
  )

  useEffect(() => {
    form.reset(
      versionDefaults(
        props.activityName,
        props.latestVersion,
        locale,
        defaultRule
      )
    )
  }, [
    defaultRule,
    form,
    locale,
    props.activityId,
    props.activityName,
    props.latestVersion,
  ])

  const mutation = useMutation({
    mutationFn: (value: LotteryVersionFormValues) =>
      createLotteryVersion(
        props.activityId,
        lotteryVersionFormToPayload(value, locale)
      ),
    onSuccess: async (response) => {
      if (!response.success) {
        throw new Error(
          response.message || t('Unable to create lottery version')
        )
      }
      toast.success(t('Lottery version created'))
      await queryClient.invalidateQueries({
        queryKey: ['lottery-admin-versions', props.activityId],
      })
    },
    onError: (error) =>
      handleServerError(error, t('Unable to create lottery version')),
  })

  const prizesError =
    form.formState.errors.prizes?.message ||
    form.formState.errors.prizes?.root?.message

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <CardTitle>{t('Create version')}</CardTitle>
          <Badge
            variant={
              Math.abs(probabilityTotal - 100) < 0.00005
                ? 'outline'
                : 'destructive'
            }
          >
            {t('Probability total')}: {formatNumber(probabilityTotal, locale)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit((value) => mutation.mutate(value))}>
          <FieldGroup>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field data-invalid={!!form.formState.errors.businessDate}>
                <FieldLabel htmlFor='lottery-business-date'>
                  {t('Business date')}
                </FieldLabel>
                <Input
                  id='lottery-business-date'
                  type='date'
                  aria-invalid={!!form.formState.errors.businessDate}
                  {...form.register('businessDate')}
                />
                <FieldError>
                  {form.formState.errors.businessDate?.message}
                </FieldError>
              </Field>
              <Field data-invalid={!!form.formState.errors.thresholdAmount}>
                <FieldLabel htmlFor='lottery-required-spend'>
                  {t('Required spend')}
                </FieldLabel>
                <Input
                  id='lottery-required-spend'
                  type='number'
                  min={0}
                  step='any'
                  inputMode='decimal'
                  aria-invalid={!!form.formState.errors.thresholdAmount}
                  {...form.register('thresholdAmount', { valueAsNumber: true })}
                />
                <FieldError>
                  {form.formState.errors.thresholdAmount?.message}
                </FieldError>
              </Field>
            </div>
            <Field data-invalid={!!form.formState.errors.title}>
              <FieldLabel htmlFor='lottery-version-title'>
                {t('Lottery title')}
              </FieldLabel>
              <Input
                id='lottery-version-title'
                aria-invalid={!!form.formState.errors.title}
                {...form.register('title')}
              />
              <FieldError>{form.formState.errors.title?.message}</FieldError>
            </Field>
            <Field data-invalid={!!form.formState.errors.ruleText}>
              <FieldLabel htmlFor='lottery-rule-text'>
                {t('Lottery rules')}
              </FieldLabel>
              <Textarea
                id='lottery-rule-text'
                aria-invalid={!!form.formState.errors.ruleText}
                {...form.register('ruleText')}
              />
              <FieldError>{form.formState.errors.ruleText?.message}</FieldError>
            </Field>

            <FieldSet>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <FieldLabel>{t('Prizes')}</FieldLabel>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() =>
                    prizeFields.append({
                      code: `prize-${crypto.randomUUID().slice(0, 8)}`,
                      type: 'balance',
                      balanceAmount: 1,
                      totalStock: 0,
                      dailyLimit: 0,
                      probability: 1,
                      title: '',
                      description: '',
                    })
                  }
                >
                  <Plus aria-hidden='true' />
                  {t('Add prize')}
                </Button>
              </div>
              <FieldError>{prizesError}</FieldError>
              <div className='space-y-3'>
                {prizeFields.fields.map((prizeField, index) => {
                  const prizeType = prizes[index]?.type
                  return (
                    <fieldset
                      className='border-border rounded-md border p-3'
                      key={prizeField.id}
                    >
                      <legend className='px-1 text-sm font-medium'>
                        {t('Prize {{number}}', { number: index + 1 })}
                      </legend>
                      <FieldGroup className='gap-3'>
                        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                          <Field
                            data-invalid={
                              !!form.formState.errors.prizes?.[index]?.code
                            }
                          >
                            <FieldLabel htmlFor={`lottery-prize-${index}-code`}>
                              {t('Prize code')}
                            </FieldLabel>
                            <Input
                              id={`lottery-prize-${index}-code`}
                              aria-invalid={
                                !!form.formState.errors.prizes?.[index]?.code
                              }
                              {...form.register(`prizes.${index}.code`)}
                            />
                            <FieldError>
                              {
                                form.formState.errors.prizes?.[index]?.code
                                  ?.message
                              }
                            </FieldError>
                          </Field>
                          <Field
                            data-invalid={
                              !!form.formState.errors.prizes?.[index]?.type
                            }
                          >
                            <FieldLabel htmlFor={`lottery-prize-${index}-type`}>
                              {t('Prize type')}
                            </FieldLabel>
                            <Controller
                              control={form.control}
                              name={`prizes.${index}.type`}
                              render={({ field }) => (
                                <Select
                                  value={field.value}
                                  onValueChange={(value) => {
                                    if (
                                      value !== 'balance' &&
                                      value !== 'again' &&
                                      value !== 'thanks'
                                    ) {
                                      return
                                    }
                                    field.onChange(value)
                                    if (value !== 'balance') {
                                      form.setValue(
                                        `prizes.${index}.balanceAmount`,
                                        0
                                      )
                                      form.setValue(
                                        `prizes.${index}.totalStock`,
                                        0
                                      )
                                      form.setValue(
                                        `prizes.${index}.dailyLimit`,
                                        0
                                      )
                                    }
                                  }}
                                >
                                  <SelectTrigger
                                    id={`lottery-prize-${index}-type`}
                                    className='w-full'
                                    aria-invalid={
                                      !!form.formState.errors.prizes?.[index]
                                        ?.type
                                    }
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent alignItemWithTrigger={false}>
                                    <SelectGroup>
                                      <SelectItem value='balance'>
                                        {t('Balance reward')}
                                      </SelectItem>
                                      <SelectItem value='again'>
                                        {t('Draw again')}
                                      </SelectItem>
                                      <SelectItem value='thanks'>
                                        {t('Thank you for participating')}
                                      </SelectItem>
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                            <FieldError>
                              {
                                form.formState.errors.prizes?.[index]?.type
                                  ?.message
                              }
                            </FieldError>
                          </Field>
                          <Field
                            data-invalid={
                              !!form.formState.errors.prizes?.[index]
                                ?.probability
                            }
                          >
                            <FieldLabel
                              htmlFor={`lottery-prize-${index}-probability`}
                            >
                              {t('Probability')}
                            </FieldLabel>
                            <Input
                              id={`lottery-prize-${index}-probability`}
                              type='number'
                              min={0.0001}
                              max={100}
                              step={0.0001}
                              inputMode='decimal'
                              aria-invalid={
                                !!form.formState.errors.prizes?.[index]
                                  ?.probability
                              }
                              {...form.register(`prizes.${index}.probability`, {
                                valueAsNumber: true,
                              })}
                            />
                            <FieldError>
                              {
                                form.formState.errors.prizes?.[index]
                                  ?.probability?.message
                              }
                            </FieldError>
                          </Field>
                          {prizeType === 'balance' && (
                            <Field
                              data-invalid={
                                !!form.formState.errors.prizes?.[index]
                                  ?.balanceAmount
                              }
                            >
                              <FieldLabel
                                htmlFor={`lottery-prize-${index}-amount`}
                              >
                                {t('Balance amount')}
                              </FieldLabel>
                              <Input
                                id={`lottery-prize-${index}-amount`}
                                type='number'
                                min={0}
                                step={0.00000001}
                                inputMode='decimal'
                                aria-invalid={
                                  !!form.formState.errors.prizes?.[index]
                                    ?.balanceAmount
                                }
                                {...form.register(
                                  `prizes.${index}.balanceAmount`,
                                  { valueAsNumber: true }
                                )}
                              />
                              <FieldError>
                                {
                                  form.formState.errors.prizes?.[index]
                                    ?.balanceAmount?.message
                                }
                              </FieldError>
                            </Field>
                          )}
                          {prizeType === 'balance' && (
                            <Field
                              data-invalid={
                                !!form.formState.errors.prizes?.[index]
                                  ?.totalStock
                              }
                            >
                              <FieldLabel
                                htmlFor={`lottery-prize-${index}-stock`}
                              >
                                {t('Total stock')}
                              </FieldLabel>
                              <Input
                                id={`lottery-prize-${index}-stock`}
                                type='number'
                                min={0}
                                step={1}
                                inputMode='numeric'
                                aria-invalid={
                                  !!form.formState.errors.prizes?.[index]
                                    ?.totalStock
                                }
                                {...form.register(
                                  `prizes.${index}.totalStock`,
                                  { valueAsNumber: true }
                                )}
                              />
                              <FieldError>
                                {
                                  form.formState.errors.prizes?.[index]
                                    ?.totalStock?.message
                                }
                              </FieldError>
                            </Field>
                          )}
                          {prizeType === 'balance' && (
                            <Field
                              data-invalid={
                                !!form.formState.errors.prizes?.[index]
                                  ?.dailyLimit
                              }
                            >
                              <FieldLabel
                                htmlFor={`lottery-prize-${index}-daily-limit`}
                              >
                                {t('Daily stock limit')}
                              </FieldLabel>
                              <Input
                                id={`lottery-prize-${index}-daily-limit`}
                                type='number'
                                min={0}
                                step={1}
                                inputMode='numeric'
                                aria-invalid={
                                  !!form.formState.errors.prizes?.[index]
                                    ?.dailyLimit
                                }
                                {...form.register(
                                  `prizes.${index}.dailyLimit`,
                                  { valueAsNumber: true }
                                )}
                              />
                              <FieldError>
                                {
                                  form.formState.errors.prizes?.[index]
                                    ?.dailyLimit?.message
                                }
                              </FieldError>
                            </Field>
                          )}
                          <Field>
                            <FieldLabel
                              htmlFor={`lottery-prize-${index}-title`}
                            >
                              {t('Prize title')}
                            </FieldLabel>
                            <Input
                              id={`lottery-prize-${index}-title`}
                              {...form.register(`prizes.${index}.title`)}
                            />
                          </Field>
                          <Field>
                            <FieldLabel
                              htmlFor={`lottery-prize-${index}-description`}
                            >
                              {t('Prize description')}
                            </FieldLabel>
                            <Input
                              id={`lottery-prize-${index}-description`}
                              {...form.register(`prizes.${index}.description`)}
                            />
                          </Field>
                        </div>
                        <Button
                          type='button'
                          size='icon'
                          variant='ghost'
                          disabled={prizeFields.fields.length <= 2}
                          aria-label={t('Remove prize {{number}}', {
                            number: index + 1,
                          })}
                          onClick={() => prizeFields.remove(index)}
                        >
                          <Trash2 aria-hidden='true' />
                        </Button>
                      </FieldGroup>
                    </fieldset>
                  )
                })}
              </div>
            </FieldSet>
            <Button type='submit' disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Spinner aria-hidden='true' />
              ) : (
                <Send aria-hidden='true' />
              )}
              {t('Create version')}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
