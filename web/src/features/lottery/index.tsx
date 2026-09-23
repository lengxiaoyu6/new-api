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
import {
  ChevronLeft,
  ChevronRight,
  Gift,
  History,
  RotateCcw,
  WalletCards,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useMediaQuery } from '@/hooks/use-media-query'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { drawLottery, getLotteryActivities, getLotteryHistory } from './api'
import { LotteryWheel } from './components/lottery-wheel'
import { getLotteryWheelRotation } from './lib/wheel'
import type {
  LotteryActivity,
  LotteryDraw,
  LotteryDrawResult,
  LotteryPrize,
} from './types'

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

function statusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'warning' | 'outline' {
  if (status === 'eligible' || status === 'extra_available') return 'default'
  if (status === 'ineligible') return 'warning'
  if (status === 'paused' || status === 'ended') return 'destructive'
  return 'outline'
}

function canDraw(activity: LotteryActivity) {
  return activity.status === 'eligible' || activity.status === 'extra_available'
}

function PrizeIcon(props: { type: LotteryPrize['type'] }) {
  if (props.type === 'balance') {
    return <WalletCards aria-hidden='true' />
  }
  if (props.type === 'again') {
    return <RotateCcw aria-hidden='true' />
  }
  return <Gift aria-hidden='true' />
}

function HistoryRows(props: { rows: LotteryDraw[] }) {
  const { t } = useTranslation()
  if (props.rows.length === 0) {
    return (
      <p className='text-muted-foreground py-3 text-sm'>
        {t('No draw history')}
      </p>
    )
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
                <div className='text-muted-foreground text-xs'>
                  {row.prize_description}
                </div>
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
  const shouldReduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [showHistory, setShowHistory] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [wheelRotation, setWheelRotation] = useState(0)
  const [isSpinning, setIsSpinning] = useState(false)
  const [pendingResult, setPendingResult] = useState<LotteryDrawResult | null>(
    null
  )
  const [drawResult, setDrawResult] = useState<LotteryDrawResult | null>(null)
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<
    string | null
  >(null)
  const historyQuery = useQuery({
    queryKey: ['lottery-history', props.activity.id, historyPage],
    queryFn: async () => {
      const response = await getLotteryHistory(
        props.activity.id,
        undefined,
        historyPage
      )
      if (!response.success) {
        throw new Error(response.message || t('Unable to load draw history'))
      }
      return (
        response.data ?? {
          items: [],
          total: 0,
          page: historyPage,
          page_size: 20,
        }
      )
    },
    enabled: showHistory,
  })
  const drawMutation = useMutation({
    mutationFn: (idempotencyKey: string) =>
      drawLottery(props.activity.id, idempotencyKey),
    onSuccess: async (response) => {
      if (!response.success || !response.data) {
        setIsSpinning(false)
        throw new Error(
          response.message || t('The draw could not be completed')
        )
      }
      const result = response.data
      const prizeIndex = props.activity.prizes.findIndex(
        (prize) => prize.id === result.prize_id
      )
      setPendingIdempotencyKey(null)
      if (shouldReduceMotion || prizeIndex < 0) {
        setIsSpinning(false)
        setDrawResult(result)
      } else {
        setPendingResult(result)
        setWheelRotation((rotation) =>
          getLotteryWheelRotation(
            rotation,
            prizeIndex,
            props.activity.prizes.length
          )
        )
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lottery-activities'] }),
        queryClient.invalidateQueries({
          queryKey: ['lottery-history', props.activity.id],
        }),
      ])
    },
    onError: (error) => {
      setIsSpinning(false)
      setPendingResult(null)
      handleServerError(error, t('The draw could not be completed'))
    },
  })
  const submitDraw = () => {
    if (isSpinning || drawMutation.isPending) return
    const idempotencyKey = pendingIdempotencyKey ?? crypto.randomUUID()
    setDrawResult(null)
    setIsSpinning(true)
    setPendingIdempotencyKey(idempotencyKey)
    drawMutation.mutate(idempotencyKey)
  }
  const completeSpin = () => {
    if (!pendingResult) return
    setDrawResult(pendingResult)
    setPendingResult(null)
    setIsSpinning(false)
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
            <CardDescription className='mt-1'>
              {props.activity.rule_text}
            </CardDescription>
          </div>
          <Badge variant={statusVariant(props.activity.status)}>
            {t(statusLabel)}
          </Badge>
        </div>
        <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
          <span>
            {t('Required spend')}:{' '}
            {formatQuota(props.activity.qualification.threshold_quota)}
          </span>
          <span>
            {t('Remaining')}: {props.activity.remaining_attempts}
          </span>
        </div>
      </CardHeader>
      <CardContent className='space-y-4 pt-4'>
        <div className='grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.72fr)]'>
          <div className='min-w-0'>
            <LotteryWheel
              prizes={props.activity.prizes}
              rotation={wheelRotation}
              spinning={isSpinning}
              disabled={!canDraw(props.activity) || drawMutation.isPending}
              onSpin={submitDraw}
              onSpinEnd={completeSpin}
            />
          </div>
          <div className='min-w-0 space-y-3'>
            <div className='flex items-center justify-between gap-3'>
              <h3 className='text-sm font-medium'>{t('Prize')}</h3>
              <Badge variant='outline'>
                {t('Remaining')}: {props.activity.remaining_attempts}
              </Badge>
            </div>
            <div className='divide-y border-y'>
              {props.activity.prizes.map((prize) => (
                <div
                  key={prize.id}
                  className='flex min-w-0 items-start gap-3 py-3'
                >
                  <IconBadge
                    size='sm'
                    tone={prize.type === 'balance' ? 'success' : 'info'}
                  >
                    <PrizeIcon type={prize.type} />
                  </IconBadge>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='min-w-0 truncate text-sm font-medium'>
                        {prize.title}
                      </span>
                      <Badge
                        variant={prize.available ? 'outline' : 'secondary'}
                        className='text-[11px]'
                      >
                        {t(prize.available ? 'Available' : 'Out of stock')}
                      </Badge>
                    </div>
                    <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
                      {prize.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className='flex flex-wrap items-center justify-between gap-2 border-t pt-3'>
          <div className='text-muted-foreground min-w-0 text-sm'>
            {props.activity.extra_available && (
              <span>{t('One extra draw is available.')}</span>
            )}
          </div>
          <Button
            variant='outline'
            onClick={() => setShowHistory((value) => !value)}
          >
            <History aria-hidden='true' />
            {t('History')}
          </Button>
        </div>
        <Dialog
          open={drawResult !== null}
          onOpenChange={(open) => {
            if (!open) setDrawResult(null)
          }}
          title={t('Result')}
          contentClassName='sm:max-w-md'
          contentHeight='auto'
          bodyClassName='space-y-4'
          footer={
            <Button onClick={() => setDrawResult(null)}>{t('Close')}</Button>
          }
        >
          {drawResult && (
            <div className='space-y-4 py-2 text-center'>
              <IconBadge
                size='lg'
                tone={drawResult.prize_type === 'balance' ? 'success' : 'info'}
                className='mx-auto'
              >
                <PrizeIcon type={drawResult.prize_type} />
              </IconBadge>
              <div>
                <p className='text-muted-foreground text-sm'>{t('Prize')}</p>
                <p className='mt-1 text-xl font-semibold'>
                  {drawResult.prize_title}
                </p>
                {drawResult.prize_description && (
                  <p className='text-muted-foreground mt-2 text-sm'>
                    {drawResult.prize_description}
                  </p>
                )}
              </div>
              {drawResult.prize_type === 'balance' && (
                <div className='bg-success/10 text-success rounded-lg px-4 py-3 text-sm font-medium'>
                  {formatQuota(drawResult.balance_quota)}
                </div>
              )}
            </div>
          )}
        </Dialog>
        {showHistory && (
          <div className='border-t pt-3'>
            {historyQuery.isPending && (
              <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
            )}
            {historyQuery.isError && (
              <ErrorState description={t('Unable to load draw history')} />
            )}
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
                      onClick={() =>
                        setHistoryPage((page) => Math.max(1, page - 1))
                      }
                    >
                      <ChevronLeft aria-hidden='true' />
                    </Button>
                    <span className='text-muted-foreground text-sm tabular-nums'>
                      {historyQuery.data.page} /{' '}
                      {Math.max(
                        1,
                        Math.ceil(
                          historyQuery.data.total / historyQuery.data.page_size
                        )
                      )}
                    </span>
                    <Button
                      size='icon'
                      variant='outline'
                      aria-label={t('Next page')}
                      disabled={
                        historyPage >=
                          Math.ceil(
                            historyQuery.data.total /
                              historyQuery.data.page_size
                          ) || historyQuery.isFetching
                      }
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
      if (!response.success) {
        throw new Error(
          response.message || t('Unable to load lottery activities')
        )
      }
      return response.data ?? []
    },
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Lottery')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {activitiesQuery.isPending && (
          <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
        )}
        {activitiesQuery.isError && (
          <ErrorState description={t('Unable to load lottery activities')} />
        )}
        {activitiesQuery.data && activitiesQuery.data.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('No active lottery activities')}
          </p>
        )}
        <div className='space-y-4'>
          {activitiesQuery.data?.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
