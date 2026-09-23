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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Gift, History, Play, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import {
  drawLottery,
  getLotteryActivities,
  getLotteryHistory,
} from './api'
import type { LotteryActivity, LotteryDraw } from './types'

const statusKeys: Record<string, string> = {
  not_started: 'Not started',
  eligible: 'Eligible',
  ineligible: 'Not eligible',
  extra_available: 'Extra draw available',
  completed: 'Completed for today',
  paused: 'Paused',
  ended: 'Ended',
  active: 'Active',
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'warning' | 'outline' {
  if (status === 'eligible' || status === 'extra_available') return 'default'
  if (status === 'ineligible') return 'warning'
  if (status === 'paused' || status === 'ended') return 'destructive'
  return 'outline'
}

function canDraw(activity: LotteryActivity) {
  return activity.status === 'eligible' || activity.status === 'extra_available'
}

function HistoryRows(props: { rows: LotteryDraw[] }) {
  const { t } = useTranslation()
  if (props.rows.length === 0) {
    return <p className='text-muted-foreground py-3 text-sm'>{t('No draw history')}</p>
  }
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Attempt')}</TableHead>
            <TableHead>{t('Result')}</TableHead>
            <TableHead>{t('Time')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>#{row.attempt_no}</TableCell>
              <TableCell>
                <div className='font-medium'>{row.prize_title}</div>
                <div className='text-muted-foreground text-xs'>{row.prize_description}</div>
              </TableCell>
              <TableCell>{formatTimestampToDate(row.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ActivityCard(props: { activity: LotteryActivity }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showHistory, setShowHistory] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string | null>(null)
  const historyQuery = useQuery({
    queryKey: ['lottery-history', props.activity.id, historyPage],
    queryFn: async () => {
      const response = await getLotteryHistory(props.activity.id, undefined, historyPage)
      if (!response.success) throw new Error(response.message || t('Unable to load draw history'))
      return response.data ?? { items: [], total: 0, page: historyPage, page_size: 20 }
    },
    enabled: showHistory,
  })
  const drawMutation = useMutation({
    mutationFn: (idempotencyKey: string) => drawLottery(props.activity.id, idempotencyKey),
    onSuccess: async (response) => {
      if (!response.success || !response.data) {
        throw new Error(response.message || t('The draw could not be completed'))
      }
      toast.success(response.data.prize_title || t('Draw completed'))
      await queryClient.invalidateQueries({ queryKey: ['lottery-activities'] })
      await queryClient.invalidateQueries({ queryKey: ['lottery-history', props.activity.id] })
      setPendingIdempotencyKey(null)
      setShowHistory(true)
    },
    onError: (error) => handleServerError(error, t('The draw could not be completed')),
  })
  const submitDraw = () => {
    const idempotencyKey = pendingIdempotencyKey ?? crypto.randomUUID()
    setPendingIdempotencyKey(idempotencyKey)
    drawMutation.mutate(idempotencyKey)
  }
  const statusLabel = statusKeys[props.activity.status] || props.activity.status

  return (
    <Card>
      <CardHeader className='gap-3 border-b'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <CardTitle className='flex items-center gap-2'>
              <Gift className='size-4' aria-hidden='true' />
              <span className='truncate'>{props.activity.title}</span>
            </CardTitle>
            <CardDescription className='mt-1'>{props.activity.rule_text}</CardDescription>
          </div>
          <Badge variant={statusVariant(props.activity.status)}>{t(statusLabel)}</Badge>
        </div>
        <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
          <span>{t('Business date')}: {props.activity.business_date}</span>
          <span>{t('Required spend')}: {formatQuota(props.activity.qualification.threshold_quota)}</span>
          <span>{t('Remaining')}: {props.activity.remaining_attempts}</span>
        </div>
      </CardHeader>
      <CardContent className='space-y-4 pt-4'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Prize')}</TableHead>
                <TableHead>{t('Probability')}</TableHead>
                <TableHead>{t('Availability')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.activity.prizes.map((prize) => (
                <TableRow key={prize.id}>
                  <TableCell>
                    <div className='font-medium'>{prize.title}</div>
                    <div className='text-muted-foreground text-xs'>{prize.description}</div>
                  </TableCell>
                  <TableCell>
                    <div>{t('Configured')}: {prize.probability_percent.toFixed(2)}%</div>
                    <div className='text-muted-foreground text-xs'>{t('Effective')}: {prize.effective_probability_percent.toFixed(2)}%</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={prize.available ? 'outline' : 'secondary'}>
                      {t(prize.available ? 'Available' : 'Out of stock')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button disabled={!canDraw(props.activity) || drawMutation.isPending} onClick={submitDraw}>
            {drawMutation.isPending ? <RefreshCw className='animate-spin' aria-hidden='true' /> : <Play aria-hidden='true' />}
            {t('Draw now')}
          </Button>
          <Button variant='outline' onClick={() => setShowHistory((value) => !value)}>
            <History aria-hidden='true' />
            {t('History')}
          </Button>
          {props.activity.extra_available && <span className='text-muted-foreground text-sm'>{t('One extra draw is available.')}</span>}
        </div>
        {showHistory && (
          <div className='border-t pt-3'>
            {historyQuery.isPending && <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>}
            {historyQuery.isError && <ErrorState description={t('Unable to load draw history')} />}
            {historyQuery.data && (
              <>
                <HistoryRows rows={historyQuery.data.items} />
                {historyQuery.data.total > historyQuery.data.page_size && (
                  <div className='flex items-center justify-end gap-2 pt-3'>
                    <Button
                      size='icon'
                      variant='outline'
                      aria-label={t('Previous page')}
                      disabled={historyPage <= 1 || historyQuery.isFetching}
                      onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                    >
                      <ChevronLeft aria-hidden='true' />
                    </Button>
                    <span className='text-muted-foreground text-sm tabular-nums'>
                      {historyQuery.data.page} / {Math.max(1, Math.ceil(historyQuery.data.total / historyQuery.data.page_size))}
                    </span>
                    <Button
                      size='icon'
                      variant='outline'
                      aria-label={t('Next page')}
                      disabled={historyPage >= Math.ceil(historyQuery.data.total / historyQuery.data.page_size) || historyQuery.isFetching}
                      onClick={() => setHistoryPage((page) => page + 1)}
                    >
                      <ChevronRight aria-hidden='true' />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function Lottery() {
  const { t } = useTranslation()
  const activitiesQuery = useQuery({
    queryKey: ['lottery-activities'],
    queryFn: async () => {
      const response = await getLotteryActivities()
      if (!response.success) throw new Error(response.message || t('Unable to load lottery activities'))
      return response.data ?? []
    },
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Lottery')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {activitiesQuery.isPending && <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>}
        {activitiesQuery.isError && <ErrorState description={t('Unable to load lottery activities')} />}
        {activitiesQuery.data && activitiesQuery.data.length === 0 && <p className='text-muted-foreground text-sm'>{t('No active lottery activities')}</p>}
        <div className='space-y-4'>
          {activitiesQuery.data?.map((activity) => <ActivityCard key={activity.id} activity={activity} />)}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
