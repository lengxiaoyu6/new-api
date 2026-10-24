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

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { LotteryAdminVersion } from '../types'
import { LotteryStockForm } from './stock-form'

const prizeTypeKeys: Record<string, string> = {
  again: 'Draw again',
  thanks: 'Thank you for participating',
}

type LotteryCurrentConfigurationProps = {
  activityId?: number
  version?: LotteryAdminVersion
  canAdjustStock: boolean
}

export function LotteryCurrentConfiguration(
  props: LotteryCurrentConfigurationProps
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language) || 'en'
  const version = props.version
  if (!version) {
    return (
      <Card>
        <CardContent>
          <EmptyState title={t('No configuration')} className='min-h-48' />
        </CardContent>
      </Card>
    )
  }
  const balancePrizes = version.prizes.filter(
    (prize) => prize.type === 'balance'
  )
  const showStockForm = props.activityId != null && props.canAdjustStock
  const title =
    version.title[locale] ||
    version.title.en ||
    version.title.zh ||
    Object.values(version.title).find(Boolean)
  const rules =
    version.rule_text[locale] ||
    version.rule_text.en ||
    version.rule_text.zh ||
    Object.values(version.rule_text).find(Boolean)

  return (
    <div
      className={cn(
        'grid min-w-0 items-start gap-4',
        showStockForm && 'xl:grid-cols-[minmax(0,1fr)_20rem]'
      )}
    >
      <Card className='min-w-0'>
        <CardHeader className='border-b'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <CardTitle>{t('Current configuration')}</CardTitle>
            <Badge variant='outline'>{t('Published')}</Badge>
          </div>
          {title && (
            <CardDescription className='break-words'>{title}</CardDescription>
          )}
        </CardHeader>
        <CardContent className='min-w-0 space-y-4'>
          {rules && (
            <p className='text-muted-foreground break-words whitespace-pre-wrap'>
              {rules}
            </p>
          )}
          <StaticDataTable
            tableProps={{ 'aria-label': t('Current configuration') }}
          >
            <TableHeader>
              <TableRow>
                <TableHead>{t('Prize')}</TableHead>
                <TableHead>{t('Balance amount')}</TableHead>
                <TableHead className='text-right'>{t('Probability')}</TableHead>
                <TableHead className='text-right'>{t('Total stock')}</TableHead>
                <TableHead className='text-right'>{t('Remaining')}</TableHead>
                <TableHead className='text-right'>
                  {t('Daily stock limit')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {version.prizes.map((prize) => (
                <TableRow key={prize.id}>
                  <TableCell className='max-w-64 min-w-36 whitespace-normal'>
                    <div className='font-medium break-words'>
                      {prize.title[locale] ||
                        prize.title.en ||
                        prize.title.zh ||
                        Object.values(prize.title).find(Boolean) ||
                        prize.code}
                    </div>
                    <div
                      className='text-muted-foreground mt-1 font-mono break-all'
                      data-table-text='secondary'
                    >
                      {prize.code}
                    </div>
                  </TableCell>
                  <TableCell>
                    {prize.type === 'balance'
                      ? formatQuota(prize.balance_quota)
                      : t(prizeTypeKeys[prize.type] || prize.type)}
                  </TableCell>
                  <TableCell className='text-right'>
                    {formatNumber(prize.weight / 10000, locale)}%
                  </TableCell>
                  <TableCell className='text-right'>
                    {prize.type === 'balance'
                      ? formatNumber(prize.total_stock, locale)
                      : '-'}
                  </TableCell>
                  <TableCell className='text-right'>
                    {prize.type === 'balance'
                      ? formatNumber(
                          Math.max(0, prize.total_stock - prize.issued_stock),
                          locale
                        )
                      : '-'}
                  </TableCell>
                  <TableCell className='text-right'>
                    {prize.daily_limit > 0
                      ? formatNumber(prize.daily_limit, locale)
                      : t('Unlimited')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </StaticDataTable>
        </CardContent>
      </Card>
      {showStockForm && (
        <Card className='min-w-0'>
          <CardHeader className='border-b'>
            <CardTitle>{t('Add lottery stock')}</CardTitle>
          </CardHeader>
          <CardContent>
            <LotteryStockForm
              activityId={props.activityId as number}
              prizes={balancePrizes}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
