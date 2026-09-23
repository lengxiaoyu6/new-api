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
import { api } from '@/lib/api'

import type {
  LotteryActivitiesResponse,
  LotteryActivityResponse,
  LotteryAdminActivitiesResponse,
  LotteryAuditResponse,
  LotteryAdminVersionsResponse,
  LotteryDrawResponse,
  LotteryHistoryResponse,
  LotteryVersionPayload,
} from './types'

export async function getLotteryActivities(): Promise<LotteryActivitiesResponse> {
  const response = await api.get('/api/lottery/activities')
  return response.data
}

export async function getLotteryActivity(
  activityId: number
): Promise<LotteryActivityResponse> {
  const response = await api.get(`/api/lottery/activities/${activityId}`)
  return response.data
}

export async function drawLottery(
  activityId: number,
  idempotencyKey: string
): Promise<LotteryDrawResponse> {
  const response = await api.post(
    `/api/lottery/activities/${activityId}/draw`,
    {},
    { headers: { 'Idempotency-Key': idempotencyKey } }
  )
  return response.data
}

export async function getLotteryHistory(
  activityId?: number,
  businessDate?: string,
  page = 1,
  pageSize = 20
): Promise<LotteryHistoryResponse> {
  const path =
    activityId === undefined
      ? '/api/lottery/history'
      : `/api/lottery/activities/${activityId}/history`
  const response = await api.get(path, {
    params: {
      ...(businessDate ? { business_date: businessDate } : {}),
      page,
      page_size: pageSize,
    },
  })
  return response.data
}

export async function listLotteryAdminActivities(): Promise<LotteryAdminActivitiesResponse> {
  const response = await api.get('/api/lottery/admin/activities')
  return response.data
}

export async function createLotteryActivity(payload: {
  name: string
  start_at: number
  end_at: number
  consume_start_at: number
  consume_end_at: number
  max_attempts?: number
}) {
  const response = await api.post('/api/lottery/admin/activities', payload)
  return response.data
}

export async function setLotteryActivityStatus(
  activityId: number,
  status: string
) {
  const response = await api.post(
    `/api/lottery/admin/activities/${activityId}/status`,
    { status }
  )
  return response.data
}

export async function publishLotteryVersion(versionId: number) {
  const response = await api.post(
    `/api/lottery/admin/versions/${versionId}/publish`
  )
  return response.data
}

export async function addLotteryStock(
  activityId: number,
  payload: {
    prize_id: number
    delta: number
    request_id: string
    reason: string
  }
) {
  const response = await api.post(
    `/api/lottery/admin/activities/${activityId}/stock`,
    payload
  )
  return response.data
}

export async function listLotteryAdminVersions(
  activityId: number
): Promise<LotteryAdminVersionsResponse> {
  const response = await api.get(
    `/api/lottery/admin/activities/${activityId}/versions`
  )
  return response.data
}

export async function getLotteryAdminAudit(
  activityId: number,
  page = 1,
  pageSize = 20,
  businessDate?: string
): Promise<LotteryAuditResponse> {
  const response = await api.get(
    `/api/lottery/admin/activities/${activityId}/audit`,
    {
      params: {
        page,
        page_size: pageSize,
        ...(businessDate ? { business_date: businessDate } : {}),
      },
    }
  )
  return response.data
}

export async function createLotteryVersion(
  activityId: number,
  payload: LotteryVersionPayload
) {
  const response = await api.post(
    `/api/lottery/admin/activities/${activityId}/versions`,
    payload
  )
  return response.data
}
