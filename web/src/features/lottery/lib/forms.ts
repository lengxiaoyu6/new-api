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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars } from '@/lib/format'

import type { LotteryVersionPayload } from '../types'

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function shanghaiLocalDateTimeToUnix(value: string): number {
  const match = DATE_TIME_PATTERN.exec(value)
  if (!match) return 0
  const [, year, month, day, hour, minute] = match
  const parts = [year, month, day, hour, minute].map(Number)
  const localAsUtc = Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2],
    parts[3],
    parts[4]
  )
  const parsed = new Date(localAsUtc)
  if (
    parsed.getUTCFullYear() !== parts[0] ||
    parsed.getUTCMonth() !== parts[1] - 1 ||
    parsed.getUTCDate() !== parts[2] ||
    parsed.getUTCHours() !== parts[3] ||
    parsed.getUTCMinutes() !== parts[4]
  ) {
    return 0
  }
  return Math.floor((localAsUtc - 8 * 60 * 60 * 1000) / 1000)
}

export function getLotteryActivityFormSchema(t: TFunction) {
  return z
    .object({
      name: z.string().trim().min(1, t('Activity name is required')).max(128),
      startAt: z
        .string()
        .refine(
          (value) => shanghaiLocalDateTimeToUnix(value) > 0,
          t('Enter a valid Shanghai date and time')
        ),
      endAt: z
        .string()
        .refine(
          (value) => shanghaiLocalDateTimeToUnix(value) > 0,
          t('Enter a valid Shanghai date and time')
        ),
      consumeStartAt: z
        .string()
        .refine(
          (value) => shanghaiLocalDateTimeToUnix(value) > 0,
          t('Enter a valid Shanghai date and time')
        ),
      consumeEndAt: z
        .string()
        .refine(
          (value) => shanghaiLocalDateTimeToUnix(value) > 0,
          t('Enter a valid Shanghai date and time')
        ),
      maxAttempts: z.number().int().min(1).max(2),
    })
    .superRefine((value, context) => {
      if (
        shanghaiLocalDateTimeToUnix(value.endAt) <=
        shanghaiLocalDateTimeToUnix(value.startAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['endAt'],
          message: t('Activity end must be after its start'),
        })
      }
      if (
        shanghaiLocalDateTimeToUnix(value.consumeEndAt) <=
        shanghaiLocalDateTimeToUnix(value.consumeStartAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['consumeEndAt'],
          message: t('Spend window end must be after its start'),
        })
      }
    })
}

export type LotteryActivityFormValues = z.infer<
  ReturnType<typeof getLotteryActivityFormSchema>
>

export function getLotteryStockFormSchema(t: TFunction) {
  return z.object({
    prizeId: z.number().int().positive(t('Select a balance prize')),
    delta: z
      .number()
      .int()
      .positive(t('Stock amount must be greater than zero')),
    reason: z.string().trim().min(1, t('Reason is required')).max(255),
  })
}

export type LotteryStockFormValues = z.infer<
  ReturnType<typeof getLotteryStockFormSchema>
>

const lotteryPrizeSchema = z.object({
  code: z.string().trim().min(1).max(64),
  type: z.enum(['balance', 'again', 'thanks']),
  balanceAmount: z.number().finite().min(0),
  totalStock: z.number().int().min(0),
  dailyLimit: z.number().int().min(0),
  probability: z.number().finite().gt(0).max(100),
  title: z.string().trim().max(128),
  description: z.string().trim().max(255),
})

export function getLotteryVersionFormSchema(t: TFunction) {
  return z
    .object({
      thresholdAmount: z.number().finite().min(0),
      title: z.string().trim().min(1, t('Lottery title is required')).max(128),
      ruleText: z
        .string()
        .trim()
        .min(1, t('Lottery rules are required'))
        .max(2000),
      prizes: z.array(lotteryPrizeSchema).min(2).max(50),
    })
    .superRefine((value, context) => {
      const codes = new Set<string>()
      let thanksCount = 0
      let againCount = 0
      let totalWeight = 0
      value.prizes.forEach((prize, index) => {
        const code = prize.code.trim()
        if (codes.has(code)) {
          context.addIssue({
            code: 'custom',
            path: ['prizes', index, 'code'],
            message: t('Prize codes must be unique'),
          })
        }
        codes.add(code)
        if (prize.type === 'thanks') thanksCount += 1
        if (prize.type === 'again') againCount += 1
        if (prize.type === 'balance' && prize.balanceAmount <= 0) {
          context.addIssue({
            code: 'custom',
            path: ['prizes', index, 'balanceAmount'],
            message: t('Balance amount must be greater than zero'),
          })
        }
        totalWeight += Math.round(prize.probability * 10000)
      })
      if (thanksCount !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['prizes'],
          message: t('Configure exactly one participation prize'),
        })
      }
      if (againCount > 1) {
        context.addIssue({
          code: 'custom',
          path: ['prizes'],
          message: t('Configure at most one extra draw prize'),
        })
      }
      if (totalWeight !== 1_000_000) {
        context.addIssue({
          code: 'custom',
          path: ['prizes'],
          message: t('Prize probabilities must total 100%'),
        })
      }
    })
}

export type LotteryVersionFormValues = z.infer<
  ReturnType<typeof getLotteryVersionFormSchema>
>

export const DEFAULT_LOTTERY_PRIZES: LotteryVersionFormValues['prizes'] = [
  {
    code: 'balance-2',
    type: 'balance',
    balanceAmount: 2,
    totalStock: 100,
    dailyLimit: 0,
    probability: 25,
    title: '',
    description: '',
  },
  {
    code: 'balance-3',
    type: 'balance',
    balanceAmount: 3,
    totalStock: 100,
    dailyLimit: 0,
    probability: 25,
    title: '',
    description: '',
  },
  {
    code: 'again',
    type: 'again',
    balanceAmount: 0,
    totalStock: 0,
    dailyLimit: 0,
    probability: 10,
    title: '',
    description: '',
  },
  {
    code: 'thanks',
    type: 'thanks',
    balanceAmount: 0,
    totalStock: 0,
    dailyLimit: 0,
    probability: 40,
    title: '',
    description: '',
  },
]

function localizedText(value: string, locale: string): Record<string, string> {
  const text = value.trim()
  return text === '' ? {} : { [locale]: text }
}

export function lotteryVersionFormToPayload(
  value: LotteryVersionFormValues,
  locale: string
): LotteryVersionPayload {
  return {
    threshold_quota: parseQuotaFromDollars(value.thresholdAmount),
    title: localizedText(value.title, locale),
    rule_text: localizedText(value.ruleText, locale),
    prizes: value.prizes.map((prize, index) => {
      const balance = prize.type === 'balance'
      return {
        type: prize.type,
        code: prize.code.trim(),
        balance_amount: balance ? prize.balanceAmount : 0,
        balance_quota: 0,
        total_stock: balance ? prize.totalStock : 0,
        title: localizedText(prize.title, locale),
        description: localizedText(prize.description, locale),
        weight: Math.round(prize.probability * 10000),
        daily_limit: balance ? prize.dailyLimit : 0,
        sort_order: index,
        enabled: true,
      }
    }),
  }
}
