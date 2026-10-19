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
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'
import { cn } from '@/lib/utils'

import { BillingPreferenceCard } from './components/billing-preference-card'
import { SubscriptionPlanCatalog } from './components/subscription-plan-catalog'
import { SubscriptionUsageCard } from './components/subscription-usage-card'
import { useSubscriptionUsage } from './hooks/use-subscription-usage'
import { getSubscriptionStatus } from './lib/subscription-status'

export function SubscriptionUsage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('usage')
  const data = useSubscriptionUsage()
  const now = Math.floor(
    (data.subscriptions.dataUpdatedAt || Date.now()) / 1000
  )
  const records = new Map<number, UserSubscriptionRecord>()
  for (const record of [
    ...(data.subscriptions.data?.subscriptions ?? []),
    ...(data.subscriptions.data?.all_subscriptions ?? []),
  ]) {
    records.set(record.subscription.id, record)
  }
  const current: UserSubscriptionRecord[] = []
  const history: UserSubscriptionRecord[] = []
  for (const record of records.values()) {
    const status = getSubscriptionStatus(record.subscription, now)
    if (status === 'active' || status === 'exhausted') {
      current.push(record)
    } else {
      history.push(record)
    }
  }
  const planTitles = new Map(
    (data.plans.data ?? []).map((record) => [record.plan.id, record.plan.title])
  )
  const refreshing =
    data.subscriptions.isFetching ||
    data.plans.isFetching ||
    data.wallet.isFetching ||
    data.payment.loading
  const catalogLoading =
    data.plans.isPending ||
    data.subscriptions.isPending ||
    data.wallet.isPending
  const catalogError =
    data.plans.isError || data.subscriptions.isError || data.wallet.isError

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Subscription Usage')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='ghost'
          size='icon'
          aria-label={t('Refresh')}
          disabled={refreshing}
          onClick={() => void data.refresh()}
        >
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
        </Button>
        <Button variant='outline' onClick={() => setTab('plans')}>
          {t('Browse Plans')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl space-y-5'>
          <p className='text-muted-foreground text-sm'>
            {t('Track subscription quota, usage, and reset times.')}
          </p>
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(String(value))}
            className='gap-5'
          >
            <TabsList aria-label={t('Subscription Usage')}>
              <TabsTrigger value='usage'>{t('Usage Overview')}</TabsTrigger>
              <TabsTrigger value='plans'>{t('Subscription Plans')}</TabsTrigger>
            </TabsList>

            <TabsContent value='usage' className='space-y-5'>
              {data.subscriptions.isPending && (
                <div role='status' aria-label={t('Loading...')}>
                  <Skeleton className='h-64 w-full' />
                </div>
              )}
              {data.subscriptions.isError && (
                <ErrorState
                  title={t('Failed to load subscriptions')}
                  onRetry={() => void data.subscriptions.refetch()}
                />
              )}
              {data.subscriptions.isSuccess && (
                <>
                  <section aria-label={t('Current Subscriptions')}>
                    <h3 className='mb-3 text-sm font-medium'>
                      {t('Current Subscriptions')}
                    </h3>
                    {current.length > 0 ? (
                      <div
                        className={cn(
                          'grid gap-4',
                          current.length > 1 && 'lg:grid-cols-2'
                        )}
                      >
                        {current.map((record) => (
                          <SubscriptionUsageCard
                            key={record.subscription.id}
                            subscription={record.subscription}
                            title={planTitles.get(record.subscription.plan_id)}
                            now={now}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        bordered
                        title={t('No Active')}
                        description={t('Subscribe to a plan for model access')}
                        action={
                          <Button onClick={() => setTab('plans')}>
                            {t('Browse Plans')}
                          </Button>
                        }
                      />
                    )}
                  </section>

                  <BillingPreferenceCard
                    value={
                      data.subscriptions.data?.billing_preference ??
                      'subscription_first'
                    }
                    hasActive={current.length > 0}
                    pending={data.preference.isPending}
                    onChange={(value) => data.preference.mutate(value)}
                  />

                  {history.length > 0 && (
                    <Collapsible className='rounded-xl border p-4 sm:p-5'>
                      <CollapsibleTrigger
                        render={
                          <Button
                            variant='ghost'
                            className='group w-full justify-between'
                          />
                        }
                      >
                        {t('Subscription History')}
                        <ChevronDown className='size-4 transition-transform group-aria-expanded:rotate-180' />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className='mt-4 grid gap-4 lg:grid-cols-2'>
                          {history.map((record) => (
                            <SubscriptionUsageCard
                              key={record.subscription.id}
                              subscription={record.subscription}
                              title={planTitles.get(
                                record.subscription.plan_id
                              )}
                              now={now}
                            />
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value='plans'>
              {catalogLoading && (
                <div role='status' aria-label={t('Loading...')}>
                  <Skeleton className='h-64 w-full' />
                </div>
              )}
              {!catalogLoading && catalogError && (
                <ErrorState
                  title={t('Failed to load subscription plans')}
                  onRetry={() => void data.refresh()}
                />
              )}
              {!catalogLoading && !catalogError && (
                <SubscriptionPlanCatalog
                  plans={data.plans.data ?? []}
                  subscriptions={[...records.values()]}
                  topupInfo={data.payment.topupInfo}
                  userQuota={data.wallet.data?.quota}
                  paymentLoading={data.payment.loading}
                  onRefresh={data.refresh}
                  onPurchaseSuccess={() => setTab('usage')}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
