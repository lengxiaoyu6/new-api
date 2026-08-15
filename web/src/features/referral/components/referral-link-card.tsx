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
import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

interface ReferralLinkCardProps {
  affCode: string
  affiliateLink: string
  loading?: boolean
}

export function ReferralLinkCard(props: ReferralLinkCardProps) {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:p-5'>
      <div className='flex items-center gap-2.5'>
        <IconBadge tone='chart-3'>
          <Share2 />
        </IconBadge>
        <div>
          <div className='text-sm font-semibold'>{t('Your Referral Link')}</div>
          <div className='text-muted-foreground text-xs'>
            {t(
              'Earn rewards when users join through your referral link.'
            )}
          </div>
        </div>
      </div>

      {props.loading ? (
        <>
          <Skeleton className='h-9 w-full' />
          <Skeleton className='h-9 w-2/3' />
        </>
      ) : (
        <>
          <div className='flex items-center gap-2'>
            <Input
              readOnly
              value={props.affiliateLink}
              aria-label={t('Your Referral Link')}
              className='bg-background font-mono text-xs'
            />
            <CopyButton
              value={props.affiliateLink}
              tooltip={t('Copy referral link')}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Input
              readOnly
              value={props.affCode}
              aria-label={t('Invitation Code')}
              className='bg-background w-40 font-mono text-xs'
            />
            <CopyButton
              value={props.affCode}
              tooltip={t('Copy invitation code')}
            />
          </div>
        </>
      )}
    </div>
  )
}
