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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  getPublicPlans,
  getSelfSubscriptionFull,
  updateBillingPreference,
} from '@/features/subscriptions/api'
import type {
  ApiResponse,
  SelfSubscriptionData,
} from '@/features/subscriptions/types'
import { useTopupInfo } from '@/features/wallet/hooks/use-topup-info'
import type { UserWalletData } from '@/features/wallet/types'
import { getSelf } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export function useSubscriptionUsage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const payment = useTopupInfo()
  const subscriptions = useQuery({
    queryKey: ['subscription-usage', 'self'],
    queryFn: async () =>
      requireServerSuccess(await getSelfSubscriptionFull()).data ?? null,
    refetchInterval: 60_000,
  })
  const plans = useQuery({
    queryKey: ['subscription-usage', 'plans'],
    queryFn: async () =>
      requireServerSuccess(await getPublicPlans()).data ?? [],
  })
  const wallet = useQuery({
    queryKey: ['subscription-usage', 'wallet'],
    queryFn: async () => {
      const response: ApiResponse<UserWalletData> = requireServerSuccess(
        await getSelf()
      )
      return response.data ?? null
    },
  })
  const preference = useMutation({
    mutationFn: async (value: string) =>
      requireServerSuccess(await updateBillingPreference(value)),
    onSuccess: (response, value) => {
      queryClient.setQueryData<SelfSubscriptionData | null>(
        ['subscription-usage', 'self'],
        (current) =>
          current
            ? {
                ...current,
                billing_preference: response.data?.billing_preference ?? value,
              }
            : current
      )
      toast.success(t('Updated successfully'))
    },
  })

  const refresh = async () => {
    await Promise.all([
      subscriptions.refetch(),
      plans.refetch(),
      wallet.refetch(),
      payment.refetch(),
    ])
  }

  return { subscriptions, plans, wallet, payment, preference, refresh }
}
