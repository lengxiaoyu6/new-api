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
export type LotteryPrize = {
  id: number
  code: string
  type: 'balance' | 'again' | 'thanks' | string
  balance_amount: number
  balance_quota: number
  title: string
  description: string
  weight: number
  probability_percent: number
  effective_weight: number
  effective_probability_percent: number
  available: boolean
}

export type LotteryQualification = {
  eligible: boolean
  threshold_quota: number
  reason: string
  checked_at: number
}

export type LotteryActivity = {
  id: number
  name: string
  start_at: number
  end_at: number
  consume_start_at: number
  consume_end_at: number
  business_date: string
  version_id: number
  status: string
  title: string
  rule_text: string
  threshold_quota: number
  base_used: boolean
  remaining_attempts: number
  extra_granted: boolean
  extra_available: boolean
  eligibility_reason: string
  qualification: LotteryQualification
  prizes: LotteryPrize[]
}

export type LotteryDraw = {
  id: number
  activity_id: number
  business_date: string
  version_id: number
  attempt_no: number
  prize_id: number
  prize_type: string
  prize_title: string
  prize_description: string
  balance_amount: number
  balance_quota: number
  created_at: number
  award_id?: number
  award_status?: string
  draw_status?: string
  award?: { quota: number; status: string }
}

export type LotteryDrawResult = {
  draw_id: number
  version_id: number
  attempt_no: number
  reused: boolean
  prize_id: number
  prize_type: string
  prize_title: string
  prize_description: string
  balance_amount: number
  balance_quota: number
  award_id: number
  award_status: string
  draw_status: string
  award?: { quota: number; status: string }
}

export type LotteryActivityResponse = {
  success: boolean
  message?: string
  data?: LotteryActivity
}

export type LotteryActivitiesResponse = {
  success: boolean
  message?: string
  data?: LotteryActivity[]
}

export type LotteryHistoryResponse = {
  success: boolean
  message?: string
  data?: {
    items: LotteryDraw[]
    total: number
    page: number
    page_size: number
  }
}

export type LotteryDrawResponse = {
  success: boolean
  message?: string
  data?: LotteryDrawResult
}

export type LotteryAdminActivity = {
  id: number
  name: string
  start_at: number
  end_at: number
  consume_start_at: number
  consume_end_at: number
  status: string
  max_attempts: number
}

export type LotteryAdminActivitiesResponse = {
  success: boolean
  message?: string
  data?: LotteryAdminActivity[]
}

export type LotteryAdminVersion = {
  id: number
  activity_id: number
  revision: number
  status: string
  threshold_quota: number
  quota_per_unit: number
  title: Record<string, string>
  rule_text: Record<string, string>
  published_at: number
  prizes: LotteryAdminPrize[]
}

export type LotteryAdminPrize = {
  id: number
  code: string
  type: 'balance' | 'again' | 'thanks' | string
  balance_amount: number
  balance_quota: number
  total_stock: number
  issued_stock: number
  title: Record<string, string>
  description: Record<string, string>
  weight: number
  daily_limit: number
  sort_order: number
  enabled: boolean
}

export type LotteryVersionPrizePayload = {
  type: string
  code: string
  balance_amount: number
  balance_quota: number
  total_stock: number
  title: Record<string, string>
  description: Record<string, string>
  weight: number
  daily_limit: number
  sort_order: number
  enabled: boolean
}

export type LotteryVersionPayload = {
  threshold_quota: number
  title: Record<string, string>
  rule_text: Record<string, string>
  prizes: LotteryVersionPrizePayload[]
}

export type LotteryAdminVersionsResponse = {
  success: boolean
  message?: string
  data?: LotteryAdminVersion[]
}

export type LotteryAuditRecord = {
  draw_id: number
  user_id: number
  business_date: string
  attempt_no: number
  idempotency_key: string
  version_id: number
  raw_prize_id: number
  final_prize_id: number
  random_value: number
  range_start: number
  range_end: number
  random_algorithm: string
  conversion_reason: string
  status: string
  award_id: number
  award_status: string
  created_at: number
}

export type LotteryAuditResponse = {
  success: boolean
  message?: string
  data?: {
    items: LotteryAuditRecord[]
    total: number
    page: number
    page_size: number
  }
}
