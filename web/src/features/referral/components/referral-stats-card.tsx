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
import { Clock, TrendingUp, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota } from '@/lib/format'

import type { AffiliateSummary } from '../types'

interface ReferralStatsCardProps {
  summary: AffiliateSummary | null
  loading?: boolean
}

export function ReferralStatsCard(props: ReferralStatsCardProps) {
  const { t } = useTranslation()
  if (props.loading) {
    return (
      <div className='grid grid-cols-2 gap-px rounded-lg border sm:grid-cols-4'>
        {['pending', 'withdrawable', 'earned', 'invites'].map((key) => (
          <div key={key} className='min-w-0 px-2.5 py-2.5 sm:px-5 sm:py-4'>
            <Skeleton className='h-3.5 w-full' />
            <Skeleton className='mt-2 h-6 w-full sm:h-7' />
            <Skeleton className='mt-1.5 hidden h-3.5 w-24 md:block' />
          </div>
        ))}
      </div>
    )
  }

  const stats: {
    label: string
    value: string
    description: string
    icon: typeof UserPlus
    tone: IconBadgeTone
  }[] = [
    {
      label: t('Available Rewards'),
      value: formatQuota(props.summary?.aff_quota ?? 0),
      description: t('Available referral rewards'),
      icon: Clock,
      tone: 'success',
    },
    {
      label: t('Withdrawable rebates'),
      value: formatQuota(props.summary?.aff_withdrawable_quota ?? 0),
      description: t('Top-up rebates available for withdrawal'),
      icon: Clock,
      tone: 'success',
    },
    {
      label: t('Total Earned'),
      value: formatQuota(props.summary?.aff_history_quota ?? 0),
      description: t('Total invitation revenue'),
      icon: TrendingUp,
      tone: 'info',
    },
    {
      label: t('Invites'),
      value: (props.summary?.aff_count ?? 0).toLocaleString(),
      description: t('Users joined via your link'),
      icon: UserPlus,
      tone: 'chart-4',
    },
  ]

  return (
    <div className='grid grid-cols-2 gap-px rounded-lg border sm:grid-cols-4'>
      {stats.map((item) => (
        <div key={item.label} className='min-w-0 px-2.5 py-2.5 sm:px-5 sm:py-4'>
          <div className='flex items-center gap-1.5 sm:gap-2.5'>
            <IconBadge tone={item.tone} size='stat'>
              <item.icon />
            </IconBadge>
            <div className='text-muted-foreground truncate text-[11px] font-medium tracking-wider uppercase sm:text-xs'>
              {item.label}
            </div>
          </div>

          <div className='text-foreground mt-1.5 font-mono text-sm font-bold tracking-tight break-all tabular-nums sm:mt-2.5 sm:text-2xl'>
            {item.value}
          </div>
          <div className='text-muted-foreground/60 mt-1 hidden text-xs md:block'>
            {item.description}
          </div>
        </div>
      ))}
    </div>
  )
}
