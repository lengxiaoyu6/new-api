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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import { requireServerSuccess } from '@/lib/server-error-message'

import {
  getAffiliateLogs,
  getAffiliateSummary,
  getInvitedUsers,
  transferAffiliateQuota,
  getWithdrawals,
  createWithdrawal,
  reviewWithdrawal,
} from '../api'
import type { WithdrawalRequest, WithdrawalReview } from '../types'

export const AFFILIATE_SUMMARY_KEY = ['referral', 'summary'] as const
const INVITED_USERS_KEY = ['referral', 'invited'] as const
const AFFILIATE_LOGS_KEY = ['referral', 'logs'] as const

export function useReferralSummary() {
  return useQuery({
    queryKey: AFFILIATE_SUMMARY_KEY,
    queryFn: async () => requireServerSuccess(await getAffiliateSummary()),
    select: (response) => (response.success ? response.data : null),
  })
}

export function useInvitedUsers(page: number, pageSize: number) {
  return useQuery({
    queryKey: [...INVITED_USERS_KEY, page, pageSize],
    queryFn: () => getInvitedUsers(page, pageSize),
    select: (response) => (response.success ? response.data : null),
  })
}

export function useAffiliateLogs(page: number, pageSize: number) {
  return useQuery({
    queryKey: [...AFFILIATE_LOGS_KEY, page, pageSize],
    queryFn: () => getAffiliateLogs(page, pageSize),
    select: (response) => (response.success ? response.data : null),
  })
}

export function useTransferAffiliateQuota() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (quota: number) =>
      requireServerSuccess(await transferAffiliateQuota(quota)),
    onSuccess: async (response) => {
      toast.success(response.message || i18next.t('Transfer successful'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AFFILIATE_SUMMARY_KEY }),
        queryClient.invalidateQueries({ queryKey: AFFILIATE_LOGS_KEY }),
      ])
    },
  })
}

export function useWithdrawals(page: number, pageSize: number, admin = false) {
  return useQuery({
    queryKey: ['referral', 'withdrawals', admin, page, pageSize],
    queryFn: () => getWithdrawals(page, pageSize, admin),
    select: (response) => response.data,
  })
}

export function useCreateWithdrawal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { request: WithdrawalRequest; proof: string }) =>
      createWithdrawal(input.request, input.proof),
    onSuccess: async () => {
      toast.success(i18next.t('Withdrawal request submitted'))
      await queryClient.invalidateQueries({ queryKey: ['referral'] })
    },
  })
}

export function useReviewWithdrawal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { request: WithdrawalReview; proof: string }) =>
      reviewWithdrawal(input.request, input.proof),
    onSuccess: async () => {
      toast.success(i18next.t('Withdrawal updated'))
      await queryClient.invalidateQueries({ queryKey: ['referral'] })
    },
  })
}
