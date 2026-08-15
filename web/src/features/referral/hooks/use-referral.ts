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
import i18next from 'i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  getAffiliateLogs,
  getAffiliateSummary,
  getInvitedUsers,
  transferAffiliateQuota,
} from '../api'

export const AFFILIATE_SUMMARY_KEY = ['referral', 'summary'] as const
const INVITED_USERS_KEY = ['referral', 'invited'] as const
const AFFILIATE_LOGS_KEY = ['referral', 'logs'] as const

export function useReferralSummary() {
  return useQuery({
    queryKey: AFFILIATE_SUMMARY_KEY,
    queryFn: getAffiliateSummary,
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
    mutationFn: (quota: number) => transferAffiliateQuota(quota),
    onSuccess: async (response) => {
      if (response.success) {
        toast.success(response.message || i18next.t('Transfer successful'))
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: AFFILIATE_SUMMARY_KEY }),
          queryClient.invalidateQueries({ queryKey: AFFILIATE_LOGS_KEY }),
        ])
      } else {
        toast.error(response.message || i18next.t('Transfer failed'))
      }
    },
    onError: () => {
      toast.error(i18next.t('Transfer failed'))
    },
  })
}
