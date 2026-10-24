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
import { useQuery } from '@tanstack/react-query'
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePagination, DataTableView } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { createServerError } from '@/lib/server-error-message'

import { getLotteryAdminAudit } from '../api'
import type { LotteryAuditRecord } from '../types'

const EMPTY_RECORDS: LotteryAuditRecord[] = []
const awardStatusKeys: Record<string, string> = {
  granted: 'Award granted',
  completed: 'Completed',
}

export function LotteryAdminAudit(props: {
  activityId?: number
  active: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const auditQuery = useQuery({
    queryKey: ['lottery-admin-audit', props.activityId, pagination, locale],
    enabled: props.active && props.activityId != null,
    queryFn: async () => {
      const response = await getLotteryAdminAudit(
        props.activityId as number,
        pagination.pageIndex + 1,
        pagination.pageSize,
        undefined,
        locale
      )
      if (!response.success) {
        throw createServerError(response, t('Unable to load lottery audit'))
      }
      return response.data ?? { items: [], total: 0, page: 1, page_size: 20 }
    },
  })
  const columns: ColumnDef<LotteryAuditRecord>[] = [
    { accessorKey: 'draw_id', header: t('ID') },
    {
      accessorKey: 'username',
      header: t('Username'),
      cell: ({ row }) => row.original.username || '-',
    },
    { accessorKey: 'business_date', header: t('Draw date') },
    {
      accessorKey: 'attempt_no',
      header: t('Attempt'),
      cell: ({ row }) => `#${row.original.attempt_no}`,
    },
    {
      accessorKey: 'idempotency_key',
      header: t('Idempotency key'),
      cell: ({ row }) => (
        <span className='block max-w-48 min-w-32 font-mono text-xs break-all whitespace-normal'>
          {row.original.idempotency_key}
        </span>
      ),
    },
    { accessorKey: 'version_id', header: t('Configuration ID') },
    {
      accessorKey: 'raw_prize_title',
      header: t('Raw prize'),
      cell: ({ row }) => row.original.raw_prize_title || '-',
    },
    {
      accessorKey: 'final_prize_title',
      header: t('Final prize'),
      cell: ({ row }) => row.original.final_prize_title || '-',
    },
    {
      accessorKey: 'random_value',
      header: t('Random value'),
      cell: ({ row }) => (
        <span className='whitespace-nowrap'>
          {formatNumber(row.original.random_value, locale)} [
          {formatNumber(row.original.range_start, locale)},{' '}
          {formatNumber(row.original.range_end, locale)})
        </span>
      ),
    },
    {
      accessorKey: 'conversion_reason',
      header: t('Conversion reason'),
      cell: ({ row }) => row.original.conversion_reason || '-',
    },
    {
      accessorKey: 'award_status',
      header: t('Award status'),
      cell: ({ row }) =>
        t(
          awardStatusKeys[row.original.award_status || row.original.status] ||
            'Unknown'
        ),
    },
    {
      accessorKey: 'created_at',
      header: t('Time'),
      cell: ({ row }) => formatTimestampToDate(row.original.created_at),
    },
  ]
  const table = useReactTable({
    data: auditQuery.data?.items ?? EMPTY_RECORDS,
    columns,
    getRowId: (row) => String(row.draw_id),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: auditQuery.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
  })

  return (
    <Card className='min-w-0'>
      <CardHeader className='border-b'>
        <CardTitle>{t('Audit Logs')}</CardTitle>
      </CardHeader>
      <CardContent
        className='min-w-0 space-y-3'
        aria-busy={auditQuery.isFetching}
      >
        {props.activityId == null && (
          <EmptyState title={t('No audit records')} className='min-h-48' />
        )}
        {props.activityId != null && auditQuery.isPending && (
          <LoadingState className='min-h-48' size='sm' />
        )}
        {auditQuery.isError && (
          <ErrorState
            description={t('Unable to load lottery audit')}
            onRetry={() => void auditQuery.refetch()}
          />
        )}
        {auditQuery.isSuccess && (
          <>
            <DataTableView table={table} emptyTitle={t('No audit records')} />
            {auditQuery.data.total > pagination.pageSize && (
              <DataTablePagination table={table} compact />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
