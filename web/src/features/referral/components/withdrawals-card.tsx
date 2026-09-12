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
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePagination, DataTableView } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { useReviewWithdrawal, useWithdrawals } from '../hooks'
import type { AffiliateWithdrawal, WithdrawalReview } from '../types'

const EMPTY_WITHDRAWALS: AffiliateWithdrawal[] = []

export function WithdrawalsCard(props: { admin?: boolean }) {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const query = useWithdrawals(
    pagination.pageIndex + 1,
    pagination.pageSize,
    props.admin
  )
  const mutation = useReviewWithdrawal()
  const verification = useSecureVerification()
  const [review, setReview] = useState<{
    item: AffiliateWithdrawal
    status: WithdrawalReview['status']
  } | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const busy = submitting || mutation.isPending || verification.isActive
  const columns: ColumnDef<AffiliateWithdrawal>[] = [
    { accessorKey: 'id', header: t('ID') },
    {
      accessorKey: 'created_at',
      header: t('Time'),
      cell: ({ row }) => formatTimestampToDate(row.original.created_at),
    },
    {
      accessorKey: 'amount_usd',
      header: `${t('Amount')} · USD`,
      cell: ({ row }) => row.original.amount_usd,
    },
    {
      accessorKey: 'method',
      header: t('Payout method'),
      cell: ({ row }) =>
        row.original.method === 'alipay' ? t('Alipay') : row.original.method,
    },
    { accessorKey: 'account_name', header: t('Account holder') },
    {
      accessorKey: 'account',
      header: t('Payout account'),
      cell: ({ row }) => (
        <span className='break-all'>{row.original.account}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        switch (row.original.status) {
          case 'pending':
            return t('Pending review')
          case 'paid':
            return t('Paid')
          case 'rejected':
            return t('Rejected')
        }
      },
    },
    {
      accessorKey: 'review_note',
      header: t('Review note'),
      cell: ({ row }) => (
        <span className='break-words whitespace-pre-wrap'>
          {row.original.review_note}
        </span>
      ),
    },
  ]
  if (props.admin) {
    columns.splice(1, 0, { accessorKey: 'user_id', header: t('User ID') })
    columns.push({
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => {
        if (row.original.status !== 'pending') return null
        return (
          <div className='flex flex-wrap gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={busy}
              onClick={() => {
                setNote('')
                setReview({ item: row.original, status: 'paid' })
              }}
            >
              {t('Mark as paid')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={busy}
              onClick={() => {
                setNote('')
                setReview({ item: row.original, status: 'rejected' })
              }}
            >
              {t('Reject')}
            </Button>
          </div>
        )
      },
    })
  }
  const table = useReactTable({
    data: query.data?.items ?? EMPTY_WITHDRAWALS,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: query.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
  })

  const confirmReview = async () => {
    if (!review || !note.trim() || busy) return
    const request: WithdrawalReview = {
      withdrawal_id: review.item.id,
      status: review.status,
      note: note.trim(),
    }
    setSubmitting(true)
    try {
      const proof = await verification.requestVerification({
        scope: 'affiliate.withdraw.review',
        context: request,
        title:
          request.status === 'paid'
            ? t('Mark as paid')
            : t('Reject withdrawal'),
        description: `#${review.item.id} · USD ${review.item.amount_usd} · ${review.item.account} · ${request.note}`,
      })
      if (!proof) return
      await mutation.mutateAsync({ request, proof: proof.proof_token })
      setReview(null)
    } catch (error) {
      handleServerError(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className='flex min-w-0 flex-col gap-3 rounded-lg border p-4 sm:p-5'>
      <h2 className='text-sm font-semibold'>
        {props.admin ? t('Withdrawal review') : t('Withdrawal history')}
      </h2>
      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DataTableView
            table={table}
            isLoading={query.isLoading}
            emptyTitle={t('No withdrawal requests yet')}
          />
          <DataTablePagination table={table} compact />
        </>
      )}
      <ConfirmDialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null)
        }}
        title={
          review?.status === 'paid' ? t('Mark as paid') : t('Reject withdrawal')
        }
        desc={
          review?.status === 'paid'
            ? t(
                'Confirm that the payout has been completed and enter its payment reference.'
              )
            : t(
                'Rejected funds will return to the withdrawable rebate balance.'
              )
        }
        confirmText={t('Confirm')}
        isLoading={busy}
        disabled={!note.trim()}
        handleConfirm={() => void confirmReview()}
      >
        {review && (
          <p className='text-sm break-all'>
            #{review.item.id} · USD {review.item.amount_usd} ·{' '}
            {review.item.method} · {review.item.account_name} ·{' '}
            {review.item.account}
          </p>
        )}
        <Field data-disabled={busy}>
          <FieldLabel
            htmlFor={props.admin ? 'admin-withdrawal-note' : 'withdrawal-note'}
          >
            {t('Payment reference or rejection reason')}
          </FieldLabel>
          <Textarea
            id={props.admin ? 'admin-withdrawal-note' : 'withdrawal-note'}
            value={note}
            maxLength={500}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </ConfirmDialog>
      <SecureVerificationDialog {...verification.dialogProps} />
    </section>
  )
}
