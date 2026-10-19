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
import { Check, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import { formatDuration, formatResetPeriod } from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import type { TopupInfo } from '@/features/wallet/types'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

interface SubscriptionPlanCatalogProps {
  plans: PlanRecord[]
  subscriptions: UserSubscriptionRecord[]
  topupInfo: TopupInfo | null
  userQuota?: number
  paymentLoading: boolean
  onRefresh: () => Promise<void>
  onPurchaseSuccess: () => void
}

export function SubscriptionPlanCatalog(props: SubscriptionPlanCatalogProps) {
  const { t } = useTranslation()
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  const planPurchaseCountMap = new Map<number, number>()
  for (const record of props.subscriptions) {
    const planId = record.subscription.plan_id
    planPurchaseCountMap.set(
      planId,
      (planPurchaseCountMap.get(planId) ?? 0) + 1
    )
  }
  const epayMethods = (props.topupInfo?.pay_methods ?? []).filter(
    (method) =>
      method.type && method.type !== 'stripe' && method.type !== 'creem'
  )

  return (
    <>
      {props.plans.length > 0 ? (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {props.plans.map((p, index) => {
            const plan = p?.plan
            if (!plan) return null
            const totalAmount = Number(plan.total_amount || 0)
            const price = Number(plan.price_amount || 0).toFixed(2)
            const isPopular = index === 0 && props.plans.length > 1
            const limit = Number(plan.max_purchase_per_user || 0)
            const count = planPurchaseCountMap.get(plan.id) || 0
            const reached = limit > 0 && count >= limit

            const benefits = [
              `${t('Validity Period')}: ${formatDuration(plan, t)}`,
              formatResetPeriod(plan, t) !== t('No Reset')
                ? `${t('Quota Reset')}: ${formatResetPeriod(plan, t)}`
                : null,
              totalAmount > 0
                ? `${t('Total Quota')}: ${formatQuota(totalAmount)}`
                : `${t('Total Quota')}: ${t('Unlimited')}`,
              limit > 0 ? `${t('Purchase Limit')}: ${limit}` : null,
              plan.upgrade_group
                ? `${t('Upgrade Group')}: ${plan.upgrade_group}`
                : null,
            ].filter(Boolean) as string[]

            return (
              <Card
                key={plan.id}
                data-card-hover='false'
                className={cn(isPopular && 'border-primary/70 shadow-sm')}
              >
                <CardContent className='flex h-full flex-col p-3.5 sm:p-4'>
                  <div className='mb-2 flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <h4 className='truncate font-semibold'>
                        {plan.title || t('Subscription Plans')}
                      </h4>
                      {plan.subtitle && (
                        <p className='text-muted-foreground truncate text-xs'>
                          {plan.subtitle}
                        </p>
                      )}
                    </div>
                    {isPopular && (
                      <StatusBadge
                        variant='info'
                        copyable={false}
                        className='shrink-0'
                      >
                        <Sparkles className='h-3 w-3' />
                        {t('Recommended')}
                      </StatusBadge>
                    )}
                  </div>

                  <div className='py-2'>
                    <span className='text-primary text-2xl font-bold'>
                      ${price}
                    </span>
                  </div>

                  <div className='flex-1 space-y-1.5 pb-3'>
                    {benefits.map((label) => (
                      <div
                        key={label}
                        className='text-muted-foreground flex items-center gap-2 text-xs'
                      >
                        <Check className='text-primary h-3 w-3 shrink-0' />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>

                  <Separator className='mb-3' />

                  {reached ? (
                    <Tooltip>
                      <TooltipTrigger render={<div />}>
                        <Button variant='outline' className='w-full' disabled>
                          {t('Limit Reached')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('Purchase limit reached')} ({count}/{limit})
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      variant='outline'
                      className='w-full'
                      disabled={props.paymentLoading}
                      onClick={() => {
                        setSelectedPlan(p)
                        setPurchaseOpen(true)
                      }}
                    >
                      {t('Subscribe Now')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <EmptyState bordered title={t('No plans available')} />
      )}
      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) void props.onRefresh()
        }}
        plan={selectedPlan}
        enableStripe={!!props.topupInfo?.enable_stripe_topup}
        enableCreem={!!props.topupInfo?.enable_creem_topup}
        enableWaffoPancake={!!props.topupInfo?.enable_waffo_pancake_topup}
        enableOnlineTopUp={!!props.topupInfo?.enable_online_topup}
        epayMethods={epayMethods}
        userQuota={props.userQuota}
        onPurchaseSuccess={props.onPurchaseSuccess}
        purchaseLimit={selectedPlan?.plan.max_purchase_per_user}
        purchaseCount={
          selectedPlan
            ? planPurchaseCountMap.get(selectedPlan.plan.id)
            : undefined
        }
      />
    </>
  )
}
