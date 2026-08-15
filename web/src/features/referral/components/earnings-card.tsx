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
import { ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import type { AffiliateLogsPage, AffiliateLogItem } from '../types'

interface EarningsCardProps {
  data: AffiliateLogsPage | null
  loading?: boolean
  page: number
  onPageChange: (page: number) => void
}

function kindLabelKey(kind: string): string {
  if (kind === 'register') return 'Registration Reward'
  if (kind === 'transfer') return 'Transfer to Balance'
  return 'Topup Rebate'
}

function parseKind(item: AffiliateLogItem): string {
  if (!item.other) return 'topup'
  try {
    const parsed = JSON.parse(item.other) as { kind?: string }
    return parsed.kind ?? 'topup'
  } catch {
    return 'topup'
  }
}

export function EarningsCard(props: EarningsCardProps) {
  const { t } = useTranslation()
  const items = props.data?.items ?? []
  const total = props.data?.total ?? 0
  const pageSize = props.data?.page_size ?? 10
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = props.page > 1
  const canNext = props.page < totalPages && items.length > 0

  return (
    <div className='flex flex-col gap-3 rounded-lg border p-4 sm:p-5'>
      <div className='flex items-center gap-2.5'>
        <IconBadge tone='chart-4'>
          <ReceiptText />
        </IconBadge>
        <div className='text-sm font-semibold'>{t('Earnings Detail')}</div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Time')}</TableHead>
            <TableHead>{t('Type')}</TableHead>
            <TableHead className='text-right'>{t('Amount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(() => {
            if (props.loading) {
              return [0, 1, 2].map((row) => (
                <TableRow key={`skeleton-${row}`}>
                  <TableCell colSpan={3}>
                    <Skeleton className='h-4 w-full' />
                  </TableCell>
                </TableRow>
              ))
            }
            if (items.length === 0) {
              return (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className='text-muted-foreground py-6 text-center text-sm'
                  >
                    {t('No earnings records yet')}
                  </TableCell>
                </TableRow>
              )
            }
            return items.map((item) => {
              const kind = parseKind(item)
              const positive = item.quota >= 0
              return (
                <TableRow key={item.id}>
                  <TableCell className='text-muted-foreground text-xs'>
                    {formatTimestampToDate(item.created_at)}
                  </TableCell>
                  <TableCell className='text-xs'>
                    {t(kindLabelKey(kind))}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs tabular-nums ${
                      positive
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {positive ? '+' : '-'}
                    {formatQuota(Math.abs(item.quota))}
                  </TableCell>
                </TableRow>
              )
            })
          })()}
        </TableBody>
      </Table>
      {totalPages > 1 ? (
        <div className='text-muted-foreground flex items-center justify-end gap-3 text-xs'>
          <span>
            {props.page} / {totalPages}
          </span>
          <div className='flex gap-1'>
            <Button
              variant='outline'
              size='icon-sm'
              aria-label={t('Previous page')}
              disabled={!canPrev || props.loading}
              onClick={() => props.onPageChange(props.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              aria-label={t('Next page')}
              disabled={!canNext || props.loading}
              onClick={() => props.onPageChange(props.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
