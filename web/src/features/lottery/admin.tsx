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
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import {
  getLotteryAdminAudit,
  listLotteryAdminActivities,
  listLotteryAdminVersions,
  setLotteryActivityStatus,
} from './api'
import { LotteryStockForm } from './components/stock-form'
import { LotteryVersionForm } from './components/version-form'
import type { LotteryAdminVersion } from './types'

const versionStatusKeys: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
}

export function LotteryAdmin() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [auditPage, setAuditPage] = useState(1)
  const canWrite =
    hasPermission(
      user,
      ADMIN_PERMISSION_RESOURCES.LOTTERY,
      ADMIN_PERMISSION_ACTIONS.WRITE
    ) && hasPermission(user, ADMIN_PERMISSION_RESOURCES.LOTTERY, 'publish')
  const canOperate = hasPermission(
    user,
    ADMIN_PERMISSION_RESOURCES.LOTTERY,
    ADMIN_PERMISSION_ACTIONS.OPERATE
  )
  const canAdjustStock = hasPermission(
    user,
    ADMIN_PERMISSION_RESOURCES.LOTTERY,
    'stock'
  )

  const activitiesQuery = useQuery({
    queryKey: ['lottery-admin-activities'],
    queryFn: async () => {
      const response = await listLotteryAdminActivities()
      if (!response.success) {
        throw new Error(
          response.message || t('Unable to load lottery activities')
        )
      }
      return response.data ?? []
    },
  })
  const selectedActivity = activitiesQuery.data?.[0]
  const selectedId = selectedActivity?.id
  const versionsQuery = useQuery({
    queryKey: ['lottery-admin-versions', selectedId],
    queryFn: async () => {
      const response = await listLotteryAdminVersions(selectedId as number)
      if (!response.success) {
        throw new Error(
          response.message || t('Unable to load lottery configuration')
        )
      }
      return response.data ?? []
    },
    enabled: selectedId != null,
  })
  const auditQuery = useQuery({
    queryKey: ['lottery-admin-audit', selectedId, auditPage],
    queryFn: async () => {
      const response = await getLotteryAdminAudit(
        selectedId as number,
        auditPage
      )
      if (!response.success) {
        throw new Error(response.message || t('Unable to load lottery audit'))
      }
      return (
        response.data ?? { items: [], total: 0, page: auditPage, page_size: 20 }
      )
    },
    enabled: selectedId != null,
  })
  const displayedVersion = versionsQuery.data?.find(
    (version) => version.status === 'published'
  )
  const balancePrizes = (displayedVersion?.prizes ?? []).filter(
    (prize) => prize.type === 'balance'
  )
  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      if (selectedId == null) throw new Error(t('No configuration'))
      const response = await setLotteryActivityStatus(selectedId, status)
      if (!response.success) {
        throw new Error(response.message || t('Unable to update activity'))
      }
      return response
    },
    onSuccess: async () => {
      toast.success(t('Lottery activity updated'))
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['lottery-admin-activities'],
        }),
        queryClient.invalidateQueries({ queryKey: ['lottery-activities'] }),
      ])
    },
    onError: (error) =>
      handleServerError(error, t('Unable to update activity')),
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Lottery management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <CardTitle>{t('Payment lottery')}</CardTitle>
              {selectedActivity && (
                <Badge
                  variant={
                    selectedActivity.status === 'paused' ? 'warning' : 'outline'
                  }
                >
                  {selectedActivity.status === 'paused'
                    ? t('Paused')
                    : t('Active')}
                </Badge>
              )}
            </div>
            <CardDescription>
              {t(
                'Each successful online payment grants one draw. Unused draws carry over.'
              )}
            </CardDescription>
            <CardDescription>
              {t(
                'Only payments completed after the prize pool is enabled count.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {activitiesQuery.isPending && (
              <LoadingState className='min-h-28' size='sm' />
            )}
            {activitiesQuery.isError && (
              <ErrorState
                description={t('Unable to load lottery activities')}
                onRetry={() => void activitiesQuery.refetch()}
              />
            )}
            {selectedActivity && canOperate && (
              <div className='flex flex-wrap gap-2'>
                <Button
                  variant='outline'
                  disabled={
                    statusMutation.isPending ||
                    selectedActivity.status === 'active'
                  }
                  onClick={() => statusMutation.mutate('active')}
                >
                  <Play aria-hidden='true' />
                  {t('Resume')}
                </Button>
                <Button
                  variant='outline'
                  disabled={
                    statusMutation.isPending ||
                    selectedActivity.status === 'paused'
                  }
                  onClick={() => statusMutation.mutate('paused')}
                >
                  <Pause aria-hidden='true' />
                  {t('Pause')}
                </Button>
              </div>
            )}
            {selectedId != null && versionsQuery.isPending && (
              <LoadingState className='min-h-28' size='sm' />
            )}
            {versionsQuery.isError && (
              <ErrorState
                description={t('Unable to load lottery configuration')}
                onRetry={() => void versionsQuery.refetch()}
              />
            )}
            {displayedVersion && (
              <VersionRow version={displayedVersion} locale={locale} />
            )}
          </CardContent>
        </Card>
        <div className='mt-4 grid items-start gap-4 xl:grid-cols-2'>
          {canWrite &&
            activitiesQuery.isSuccess &&
            (selectedId == null || versionsQuery.isSuccess) && (
              <LotteryVersionForm
                activityId={selectedId}
                activityName={t('Payment lottery')}
                latestVersion={displayedVersion}
              />
            )}
          {selectedId != null && canAdjustStock && (
            <Card>
              <CardHeader>
                <CardTitle>{t('Add lottery stock')}</CardTitle>
              </CardHeader>
              <CardContent>
                <LotteryStockForm
                  activityId={selectedId}
                  prizes={balancePrizes}
                />
              </CardContent>
            </Card>
          )}
        </div>
        {selectedId != null && (
          <Card className='mt-4'>
            <CardHeader>
              <CardTitle>{t('Audit Logs')}</CardTitle>
            </CardHeader>
            <CardContent>
              {auditQuery.isPending && (
                <LoadingState className='min-h-36' size='sm' />
              )}
              {auditQuery.isError && (
                <ErrorState
                  description={t('Unable to load lottery audit')}
                  onRetry={() => void auditQuery.refetch()}
                />
              )}
              {auditQuery.data?.items.length === 0 && (
                <EmptyState
                  title={t('No audit records')}
                  className='min-h-36'
                />
              )}
              {auditQuery.data && auditQuery.data.items.length > 0 && (
                <>
                  <div className='overflow-x-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('ID')}</TableHead>
                          <TableHead>{t('User')}</TableHead>
                          <TableHead>{t('Draw date')}</TableHead>
                          <TableHead>{t('Attempt')}</TableHead>
                          <TableHead>{t('Idempotency key')}</TableHead>
                          <TableHead>{t('Configuration ID')}</TableHead>
                          <TableHead>{t('Raw prize')}</TableHead>
                          <TableHead>{t('Final prize')}</TableHead>
                          <TableHead>{t('Random value')}</TableHead>
                          <TableHead>{t('Conversion reason')}</TableHead>
                          <TableHead>{t('Award status')}</TableHead>
                          <TableHead>{t('Time')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditQuery.data.items.map((item) => (
                          <TableRow key={item.draw_id}>
                            <TableCell>{item.draw_id}</TableCell>
                            <TableCell>{item.user_id}</TableCell>
                            <TableCell>{item.business_date}</TableCell>
                            <TableCell>#{item.attempt_no}</TableCell>
                            <TableCell className='max-w-48 font-mono text-xs break-all'>
                              {item.idempotency_key}
                            </TableCell>
                            <TableCell>{item.version_id}</TableCell>
                            <TableCell>{item.raw_prize_id}</TableCell>
                            <TableCell>{item.final_prize_id}</TableCell>
                            <TableCell className='whitespace-nowrap'>
                              {formatNumber(item.random_value, locale)} [
                              {formatNumber(item.range_start, locale)},{' '}
                              {formatNumber(item.range_end, locale)})
                            </TableCell>
                            <TableCell>
                              {item.conversion_reason || '-'}
                            </TableCell>
                            <TableCell>
                              {item.award_status || item.status}
                            </TableCell>
                            <TableCell className='whitespace-nowrap'>
                              {formatTimestampToDate(item.created_at)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {auditQuery.data.total > auditQuery.data.page_size && (
                    <div className='mt-3 flex items-center justify-end gap-2'>
                      <Button
                        size='icon'
                        variant='outline'
                        aria-label={t('Previous page')}
                        disabled={auditPage <= 1 || auditQuery.isFetching}
                        onClick={() =>
                          setAuditPage((page) => Math.max(1, page - 1))
                        }
                      >
                        <ChevronLeft aria-hidden='true' />
                      </Button>
                      <span className='text-muted-foreground text-sm tabular-nums'>
                        {auditQuery.data.page} /{' '}
                        {Math.max(
                          1,
                          Math.ceil(
                            auditQuery.data.total / auditQuery.data.page_size
                          )
                        )}
                      </span>
                      <Button
                        size='icon'
                        variant='outline'
                        aria-label={t('Next page')}
                        disabled={
                          auditPage >=
                            Math.ceil(
                              auditQuery.data.total / auditQuery.data.page_size
                            ) || auditQuery.isFetching
                        }
                        onClick={() => setAuditPage((page) => page + 1)}
                      >
                        <ChevronRight aria-hidden='true' />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

type VersionRowProps = {
  version: LotteryAdminVersion
  locale?: string
}

function VersionRow(props: VersionRowProps) {
  const { t } = useTranslation()
  return (
    <div className='border-border rounded-md border p-3'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0 text-sm'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-medium'>{t('Current configuration')}</span>
            <Badge
              variant={
                props.version.status === 'published' ? 'outline' : 'secondary'
              }
            >
              {t(
                versionStatusKeys[props.version.status] || props.version.status
              )}
            </Badge>
          </div>
        </div>
      </div>
      <Separator className='my-3' />
      <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
        {props.version.prizes.map((prize) => (
          <div
            className='bg-muted/40 rounded-md px-2 py-1.5 text-xs'
            key={prize.id}
          >
            <div className='truncate font-medium'>{prize.code}</div>
            <div className='text-muted-foreground'>
              {formatNumber(prize.weight / 10000, props.locale)}%
              {prize.type === 'balance'
                ? ` · ${prize.issued_stock}/${prize.total_stock}`
                : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
