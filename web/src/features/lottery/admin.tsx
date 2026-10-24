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
import { Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  listLotteryAdminActivities,
  listLotteryAdminVersions,
  setLotteryActivityStatus,
} from './api'
import { LotteryAdminAudit } from './components/admin-audit'
import { LotteryCurrentConfiguration } from './components/current-configuration'
import { LotteryVersionForm } from './components/version-form'

export function LotteryAdmin() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const [tab, setTab] = useState<string | null>(null)
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
  let activeTab = tab ?? (canWrite ? 'configure' : 'current')
  if (activeTab === 'configure' && !canWrite) activeTab = 'current'

  const activitiesQuery = useQuery({
    queryKey: ['lottery-admin-activities'],
    queryFn: async () => {
      const response = await listLotteryAdminActivities()
      if (!response.success) {
        throw createServerError(
          response,
          t('Unable to load lottery activities')
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
        throw createServerError(
          response,
          t('Unable to load lottery configuration')
        )
      }
      return response.data ?? []
    },
    enabled: selectedId != null,
  })
  const displayedVersion = versionsQuery.data?.find(
    (version) => version.status === 'published'
  )
  const configurationReady = selectedId == null || versionsQuery.isSuccess
  const configurationFeedback = (
    <>
      {selectedId != null && versionsQuery.isPending && (
        <LoadingState className='min-h-48' size='sm' />
      )}
      {versionsQuery.isError && (
        <ErrorState
          description={t('Unable to load lottery configuration')}
          onRetry={() => void versionsQuery.refetch()}
        />
      )}
    </>
  )
  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      if (selectedId == null) throw new Error(t('No configuration'))
      const response = await setLotteryActivityStatus(selectedId, status)
      if (!response.success) {
        throw createServerError(response, t('Unable to update activity'))
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
        <div className='space-y-4'>
          <Card>
            <CardHeader className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
              <div className='min-w-0 space-y-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <CardTitle>{t('Payment lottery')}</CardTitle>
                  {selectedActivity && (
                    <Badge
                      variant={
                        selectedActivity.status === 'paused'
                          ? 'warning'
                          : 'outline'
                      }
                    >
                      {selectedActivity.status === 'paused'
                        ? t('Paused')
                        : t('Active')}
                    </Badge>
                  )}
                </div>
                <CardDescription className='space-y-1'>
                  <p>
                    {t(
                      'Each successful online payment grants one draw. Unused draws carry over.'
                    )}
                  </p>
                  <p>
                    {t(
                      'Only payments completed after the prize pool is enabled count.'
                    )}
                  </p>
                </CardDescription>
              </div>
              {selectedActivity && canOperate && (
                <div className='flex shrink-0 flex-wrap gap-2'>
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
            </CardHeader>
          </Card>
          {activitiesQuery.isPending && (
            <LoadingState className='min-h-48' size='sm' />
          )}
          {activitiesQuery.isError && (
            <ErrorState
              description={t('Unable to load lottery activities')}
              onRetry={() => void activitiesQuery.refetch()}
            />
          )}
          {activitiesQuery.isSuccess && (
            <Tabs
              value={activeTab}
              onValueChange={(value) => setTab(String(value))}
              className='min-w-0 gap-4'
            >
              <TabsList className='min-h-10 w-full flex-wrap group-data-horizontal/tabs:h-auto sm:w-fit'>
                {canWrite && (
                  <TabsTrigger value='configure' className='px-4 py-2'>
                    {t('Configure prizes')}
                  </TabsTrigger>
                )}
                <TabsTrigger value='current' className='px-4 py-2'>
                  {t('Current configuration')}
                </TabsTrigger>
                <TabsTrigger value='audit' className='px-4 py-2'>
                  {t('Audit Logs')}
                </TabsTrigger>
              </TabsList>
              {canWrite && (
                <TabsContent value='configure' keepMounted className='min-w-0'>
                  {configurationFeedback}
                  {configurationReady && (
                    <LotteryVersionForm
                      activityId={selectedId}
                      activityName={t('Payment lottery')}
                      latestVersion={displayedVersion}
                    />
                  )}
                </TabsContent>
              )}
              <TabsContent value='current' keepMounted className='min-w-0'>
                {configurationFeedback}
                {configurationReady && (
                  <LotteryCurrentConfiguration
                    activityId={selectedId}
                    version={displayedVersion}
                    canAdjustStock={canAdjustStock}
                  />
                )}
              </TabsContent>
              <TabsContent value='audit' keepMounted className='min-w-0'>
                <LotteryAdminAudit
                  key={selectedId}
                  activityId={selectedId}
                  active={activeTab === 'audit'}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
