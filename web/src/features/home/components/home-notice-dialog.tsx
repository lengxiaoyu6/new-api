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
import { Bell, Megaphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Markdown } from '@/components/ui/markdown'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStatus } from '@/hooks/use-status'
import { getNotice } from '@/lib/api'
import { getAnnouncementColorClass } from '@/lib/colors'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

interface AnnouncementItem {
  type?: string
  content?: string
  extra?: string
  publishDate?: string
}

export function HomeNoticeDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const { data: noticeResponse } = useQuery({
    queryKey: ['notice'],
    queryFn: getNotice,
    staleTime: 1000 * 60 * 5,
  })

  const { status } = useStatus()
  const announcementsEnabled = status?.announcements_enabled ?? false
  const announcements: AnnouncementItem[] = announcementsEnabled
    ? ((status?.announcements || []) as AnnouncementItem[]).slice(0, 20)
    : []

  const noticeContent = noticeResponse?.success
    ? (noticeResponse.data || '').trim()
    : ''

  const hasNotice = !!noticeContent
  const hasAnnouncements = announcements.length > 0

  useEffect(() => {
    if (hasNotice || hasAnnouncements) {
      setOpen(true)
    }
  }, [hasNotice, hasAnnouncements])

  if (!hasNotice && !hasAnnouncements) return null

  const defaultTab = hasNotice ? 'notice' : 'announcements'

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className='gateway-home gateway-notice'>
        <AlertDialogHeader className='gateway-notice-header'>
          <AlertDialogTitle className='gateway-notice-title'>
            <span className='gateway-notice-icon' aria-hidden='true'>
              <Bell className='size-5' />
            </span>
            {t('System Announcements')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('Latest platform updates and notices')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Tabs defaultValue={defaultTab} className='gateway-notice-tabs'>
          <TabsList
            className='gateway-notice-tab-list'
            aria-label={t('System Announcements')}
          >
            <TabsTrigger value='notice' disabled={!hasNotice}>
              <Bell className='size-3.5' aria-hidden='true' />
              {t('Notice')}
            </TabsTrigger>
            <TabsTrigger value='announcements' disabled={!hasAnnouncements}>
              <Megaphone className='size-3.5' aria-hidden='true' />
              {t('Timeline')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value='notice' className='gateway-notice-panel'>
            {hasNotice ? (
              <div className='gateway-notice-copy'>
                <Markdown>{noticeContent}</Markdown>
              </div>
            ) : (
              <Empty className='min-h-32 border-0 p-4'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <Bell />
                  </EmptyMedia>
                  <EmptyTitle>{t('No announcements at this time')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </TabsContent>

          <TabsContent value='announcements' className='gateway-notice-panel'>
            {hasAnnouncements ? (
              <ol className='gateway-notice-timeline'>
                {announcements.map((item) => {
                  const publishDate = item.publishDate
                    ? new Date(item.publishDate)
                    : null
                  const absoluteTime = publishDate
                    ? formatDateTimeObject(publishDate)
                    : ''

                  return (
                    <li
                      key={`${item.publishDate}-${item.type}-${item.content}-${item.extra}`}
                      className='gateway-notice-item'
                    >
                      <span
                        aria-hidden='true'
                        className={cn(
                          'gateway-notice-dot',
                          getAnnouncementColorClass(item.type)
                        )}
                      />
                      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                        <div className='text-sm'>
                          <Markdown>{item.content || ''}</Markdown>
                        </div>
                        {item.extra ? (
                          <div className='text-muted-foreground text-xs'>
                            <Markdown>{item.extra}</Markdown>
                          </div>
                        ) : null}
                        {absoluteTime ? (
                          <time
                            dateTime={item.publishDate}
                            className='text-muted-foreground text-xs'
                          >
                            {absoluteTime}
                          </time>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <Empty className='min-h-32 border-0 p-4'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <Megaphone />
                  </EmptyMedia>
                  <EmptyTitle>{t('No system announcements')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </TabsContent>
        </Tabs>

        <AlertDialogFooter className='gateway-notice-footer'>
          <AlertDialogCancel variant='default'>{t('Close')}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
