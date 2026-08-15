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
export interface ApiResponse<T = unknown> {
  success: boolean
  message: string
  data: T
}

export interface AffiliateSummary {
  aff_code: string
  aff_quota: number
  aff_history_quota: number
  aff_count: number
  inviter_reward: number
  invitee_reward: number
  topup_rebate_percent: number
  compliance_confirmed: boolean
}

export interface InvitedUser {
  id: number
  username: string
  status: number
  created_at: number
}

export interface InvitedUsersPage {
  page: number
  page_size: number
  total: number
  items: InvitedUser[]
}

export type AffiliateSummaryResponse = ApiResponse<AffiliateSummary>
export type InvitedUsersResponse = ApiResponse<InvitedUsersPage>
export type AffiliateTransferResponse = ApiResponse

export interface AffiliateLogItem {
  id: number
  user_id: number
  created_at: number
  type: number
  quota: number
  other: string
}

export interface AffiliateLogsPage {
  page: number
  page_size: number
  total: number
  items: AffiliateLogItem[]
}

export type AffiliateLogsResponse = ApiResponse<AffiliateLogsPage>
