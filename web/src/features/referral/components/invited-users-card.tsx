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
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { useState } from 'react'
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
import { formatTimestampToDate } from '@/lib/format'

import type { InvitedUsersPage } from '../types'

interface InvitedUsersCardProps {
  data: InvitedUsersPage | null
  loading?: boolean
  page: number
  onPageChange: (page: number) => void
}

export function InvitedUsersCard(props: InvitedUsersCardProps) {
  const { t } = useTranslation()
  const [navigating, setNavigating] = useState(false)
  const items = props.data?.items ?? []
  const total = props.data?.total ?? 0
  const pageSize = props.data?.page_size ?? 10
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = props.page > 1
  const canNext = props.page < totalPages && items.length > 0

  const handlePageChange = (nextPage: number) => {
    if (navigating) return
    setNavigating(true)
    props.onPageChange(nextPage)
    window.setTimeout(() => setNavigating(false), 500)
  }

  return (
    <div className='flex flex-col gap-3 rounded-lg border p-4 sm:p-5'>
      <div className='flex items-center gap-2.5'>
        <IconBadge tone='info'>
          <Users />
        </IconBadge>
        <div className='text-sm font-semibold'>{t('Invited Users')}</div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Username')}</TableHead>
            <TableHead>{t('Status')}</TableHead>
            <TableHead className='text-right'>{t('Joined')}</TableHead>
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
                    {t('No invited users yet')}
                  </TableCell>
                </TableRow>
              )
            }
            return items.map((user) => (
              <TableRow key={user.id}>
                <TableCell className='font-mono text-xs'>{user.username}</TableCell>
                <TableCell className='text-xs'>
                  {user.status === 1 ? t('Enabled') : t('Disabled')}
                </TableCell>
                <TableCell className='text-muted-foreground text-right text-xs'>
                  {formatTimestampToDate(user.created_at)}
                </TableCell>
              </TableRow>
            ))
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
              onClick={() => handlePageChange(props.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              aria-label={t('Next page')}
              disabled={!canNext || props.loading}
              onClick={() => handlePageChange(props.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
