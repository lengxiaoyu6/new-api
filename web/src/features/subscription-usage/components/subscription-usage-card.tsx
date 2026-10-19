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
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { UserSubscription } from '@/features/subscriptions/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import { getSubscriptionStatus } from '../lib/subscription-status'

interface SubscriptionUsageCardProps {
  subscription: UserSubscription
  title?: string
  now: number
}

export function SubscriptionUsageCard(props: SubscriptionUsageCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const subscription = props.subscription
  const status = getSubscriptionStatus(subscription, props.now)
  const current = status === 'active' || status === 'exhausted'
  const limited = subscription.amount_total > 0
  const remaining = Math.max(
    0,
    subscription.amount_total - subscription.amount_used
  )
  const percent = limited
    ? Math.min(
        100,
        Math.max(
          0,
          (subscription.amount_used / subscription.amount_total) * 100
        )
      )
    : 0
  const labels = {
    active: t('Active'),
    exhausted: t('Quota exhausted'),
    expired: t('Expired'),
    cancelled: t('Cancelled'),
  }
  const title = props.title || `${t('Subscription')} #${subscription.id}`

  return (
    <Card
      data-card-hover='false'
      className='min-w-0 gap-0 overflow-hidden py-0'
      aria-label={title}
    >
      <CardContent className='space-y-5 p-4 sm:p-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0 flex-1'>
            <h3 className='font-semibold break-words'>{title}</h3>
            {props.title && (
              <p className='text-muted-foreground mt-1 text-xs'>
                {t('Subscription')} #{subscription.id}
              </p>
            )}
          </div>
          <StatusBadge
            label={labels[status]}
            variant={status === 'active' ? 'success' : 'neutral'}
            className={status === 'exhausted' ? 'text-warning' : undefined}
            copyable={false}
          />
        </div>

        <dl className='grid grid-cols-2 gap-4'>
          <div className='min-w-0'>
            <dt className='text-muted-foreground text-xs'>{t('Quota used')}</dt>
            <dd className='mt-2 text-xl font-semibold break-all tabular-nums sm:text-2xl'>
              {formatQuota(subscription.amount_used)}
            </dd>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t('Plan Quota')}:{' '}
              {limited
                ? formatQuota(subscription.amount_total)
                : t('Unlimited')}
            </p>
          </div>
          <div className='min-w-0'>
            <dt className='text-muted-foreground text-xs'>{t('Remaining')}</dt>
            <dd className='mt-2 text-xl font-semibold break-all tabular-nums sm:text-2xl'>
              {limited ? formatQuota(remaining) : t('Unlimited')}
            </dd>
          </div>
        </dl>

        {limited && (
          <div className='space-y-2'>
            <div className='text-muted-foreground text-right text-xs tabular-nums'>
              {formatNumber(percent, locale)}%
            </div>
            <Progress
              value={percent}
              aria-label={t('Quota used')}
              aria-valuetext={`${formatQuota(subscription.amount_used)} / ${formatQuota(subscription.amount_total)}`}
              className='[&_[data-slot=progress-track]]:h-2'
            />
          </div>
        )}

        <dl className='grid gap-3 border-t pt-4 text-xs sm:grid-cols-2'>
          {current && (
            <div className='min-w-0'>
              <dt className='text-muted-foreground'>{t('Next reset')}</dt>
              <dd className='mt-1 break-words'>
                {subscription.next_reset_time
                  ? new Date(
                      subscription.next_reset_time * 1000
                    ).toLocaleString(locale)
                  : t('No Reset')}
              </dd>
            </div>
          )}
          <div className='min-w-0'>
            <dt className='text-muted-foreground'>{t('Expires at')}</dt>
            <dd className='mt-1 break-words'>
              {new Date(subscription.end_time * 1000).toLocaleString(locale)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
