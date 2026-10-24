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
import { ListPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePagination, DataTableView } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { createServerError } from '@/lib/server-error-message'

import { getLotteryAttemptHistory } from '../api'
import type { LotteryAttemptHistoryItem } from '../types'

const EMPTY_ITEMS: LotteryAttemptHistoryItem[] = []

export function LotteryAttemptHistory(props: { active: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const historyQuery = useQuery({
    queryKey: ['lottery-attempt-history', pagination],
    enabled: props.active,
    queryFn: async () => {
      const response = await getLotteryAttemptHistory(
        pagination.pageIndex + 1,
        pagination.pageSize
      )
      if (!response.success) {
        throw createServerError(response, t('Unable to load attempt history'))
      }
      return (
        response.data ?? {
          items: [],
          total: 0,
          page: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
        }
      )
    },
  })
  const columns: ColumnDef<LotteryAttemptHistoryItem>[] = [
    {
      accessorKey: 'created_at',
      header: t('Time'),
      cell: ({ row }) => formatTimestampToDate(row.original.created_at),
    },
    {
      accessorKey: 'source',
      header: t('Source'),
      cell: ({ row }) =>
        row.original.source === 'payment'
          ? t('Online payment')
          : t('Administrator gift'),
    },
    {
      accessorKey: 'count',
      header: t('Attempts added'),
      cell: ({ row }) => (
        <span className='tabular-nums'>
          +{formatNumber(row.original.count, locale)}
        </span>
      ),
    },
    {
      accessorKey: 'reason',
      header: t('Remark'),
      cell: ({ row }) => (
        <span className='block max-w-sm min-w-32 break-words whitespace-pre-wrap'>
          {row.original.reason || '-'}
        </span>
      ),
    },
  ]
  const table = useReactTable({
    data: historyQuery.data?.items ?? EMPTY_ITEMS,
    columns,
    getRowId: (row) => `${row.source}-${row.id}`,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: historyQuery.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
  })

  return (
    <Card>
      <CardHeader className='border-b'>
        <CardTitle className='flex items-center gap-2'>
          <ListPlus className='size-4' aria-hidden='true' />
          {t('Attempt history')}
        </CardTitle>
      </CardHeader>
      <CardContent
        className='space-y-3 pt-4'
        aria-busy={historyQuery.isFetching}
      >
        {historyQuery.isPending && <LoadingState />}
        {historyQuery.isError && (
          <ErrorState
            description={t('Unable to load attempt history')}
            onRetry={() => void historyQuery.refetch()}
          />
        )}
        {historyQuery.isSuccess && (
          <>
            <DataTableView table={table} emptyTitle={t('No attempt history')} />
            {historyQuery.data.total > pagination.pageSize && (
              <DataTablePagination table={table} compact />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
