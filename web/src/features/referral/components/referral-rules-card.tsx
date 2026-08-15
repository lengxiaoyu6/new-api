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
import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { formatQuota } from '@/lib/format'

import type { AffiliateSummary } from '../types'

interface ReferralRulesCardProps {
  summary: AffiliateSummary | null
}

export function ReferralRulesCard(props: ReferralRulesCardProps) {
  const { t } = useTranslation()
  const summary = props.summary

  const rules: string[] = [
    t('Share your referral link with friends. When they register through the link, they become your invitees.'),
  ]
  if (summary && summary.inviter_reward > 0) {
    rules.push(
      t('You receive {{quota}} for each user who registers via your referral link.', {
        quota: formatQuota(summary.inviter_reward),
      })
    )
  }
  if (summary && summary.invitee_reward > 0) {
    rules.push(
      t('Invited users receive {{quota}} as a registration bonus.', {
        quota: formatQuota(summary.invitee_reward),
      })
    )
  }
  if (summary && summary.topup_rebate_percent > 0) {
    rules.push(
      t(
        "You receive {{percent}}% of an invited user's top-up as affiliate quota.",
        { percent: summary.topup_rebate_percent }
      )
    )
  }
  rules.push(
    t('Affiliate rewards can be transferred to your main balance at any time.')
  )

  return (
    <div className='flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:p-5'>
      <div className='flex items-center gap-2.5'>
        <IconBadge tone='info'>
          <Gift />
        </IconBadge>
        <div className='text-sm font-semibold'>{t('How It Works')}</div>
      </div>
      <ol className='text-muted-foreground flex flex-col gap-2 text-sm'>
        {rules.map((rule, index) => (
          <li key={rule} className='flex gap-2.5'>
            <span className='text-foreground/70 font-mono text-xs'>
              {index + 1}.
            </span>
            <span>{rule}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
