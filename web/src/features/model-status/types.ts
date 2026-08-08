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
export type ModelHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown'

export type ModelStatusFilter = Exclude<ModelHealthStatus, 'unknown'> | 'all'

export type ModelStatusItem = {
  providerId: string
  provider: string
  modelName: string
  healthScore: number
  fastestTtftMs: number
  slowestTtftMs: number
  successRate: number
  requestCount: number
  ttftSampleCount?: number
  lastUpdated?: string | number
  status: ModelHealthStatus
}

export type ModelStatusApiItem = {
  provider_id?: string
  provider_name?: string
  provider?: string
  model_name: string
  health?: ModelHealthStatus
  health_score?: number | null
  fastest_ttft_ms?: number | null
  slowest_ttft_ms?: number | null
  success_rate?: number | null
  request_count?: number
  ttft_sample_count?: number
  owner_by?: string
  last_updated?: string | number
  status?: ModelHealthStatus
}

export type ModelStatusApiProvider = {
  provider_id: string
  provider_name: string
  icon?: string
  health?: ModelHealthStatus
  models: ModelStatusApiItem[]
}

export type ModelStatusResponse = {
  success: boolean
  message?: string
  data: {
    models?: ModelStatusApiItem[]
    providers?: ModelStatusApiProvider[]
    window_hours?: number
    generated_at?: number
    last_updated?: string | number
  }
}

export type ProviderStatusGroup = {
  providerId: string
  provider: string
  models: ModelStatusItem[]
  averageHealth: number
  averageSuccessRate: number
  requestCount: number
  status: ModelHealthStatus
}
