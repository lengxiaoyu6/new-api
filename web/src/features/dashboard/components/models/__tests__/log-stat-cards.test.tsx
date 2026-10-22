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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LogStatCardsFallback } from '@/features/dashboard'
import type {
  DashboardFilters,
  ModelCacheStat,
  QuotaDataItem,
} from '@/features/dashboard/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { LogStatCards } from '../log-stat-cards'

const filters: DashboardFilters = {
  start_timestamp: new Date('2026-10-21T00:00:00Z'),
  end_timestamp: new Date('2026-10-21T01:00:00Z'),
  time_granularity: 'hour',
  username: 'usage-user',
}
let quotaData: QuotaDataItem[]
let cacheData: ModelCacheStat[]

beforeEach(async () => {
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'usage-user',
    role: 1,
  })
  await i18next.changeLanguage('en')
  quotaData = [
    {
      created_at: 1792540800,
      count: 120,
      quota: 500000,
      token_used: 9000,
      cache_read_tokens: 1200,
      cache_creation_tokens: 300,
    },
    {
      created_at: 1792542600,
      count: 60,
      quota: 250000,
      token_used: 1000,
      cache_read_tokens: 300,
      cache_creation_tokens: 200,
    },
  ]
  cacheData = [
    {
      model_name: 'model-a',
      cache_tokens: 300,
      total_prompt: 1000,
      cache_hit_rate: 30,
    },
    {
      model_name: 'model-b',
      cache_tokens: 200,
      total_prompt: 1000,
      cache_hit_rate: 20,
    },
  ]
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/data/self' || url === '/api/data') {
      return { data: { success: true, data: quotaData } }
    }
    if (url === '/api/data/cache/self' || url === '/api/data/cache') {
      return { data: { success: true, data: cacheData } }
    }
    throw new Error(`Unexpected statistics request: ${url}`)
  })
})

afterEach(async () => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  window.localStorage.clear()
  await i18next.changeLanguage('en')
  vi.restoreAllMocks()
})

async function waitForStatistics() {
  await waitFor(() => {
    expect(
      screen.getByRole('group', { name: 'Cache Hit Rate' })
    ).toHaveAttribute('aria-busy', 'false')
  })
}

describe('model usage statistics', () => {
  it('shows all eight metrics and calculates cache hit rate from prompt tokens', async () => {
    render(<LogStatCards filters={filters} />)
    await waitForStatistics()

    expect(screen.getAllByRole('group')).toHaveLength(8)
    expect(
      within(screen.getByRole('group', { name: 'Total Count' })).getByTitle(
        '180'
      )
    ).toBeVisible()
    expect(
      within(screen.getByRole('group', { name: 'Total Tokens' })).getByTitle(
        '10,000'
      )
    ).toBeVisible()
    expect(
      within(screen.getByRole('group', { name: 'Cache Read' })).getByTitle(
        '1,500'
      )
    ).toBeVisible()
    expect(
      within(screen.getByRole('group', { name: 'Cache Write' })).getByTitle(
        '500'
      )
    ).toBeVisible()
    expect(
      within(screen.getByRole('group', { name: 'Average RPM' })).getByTitle('3')
    ).toBeVisible()
    expect(
      within(screen.getByRole('group', { name: 'Cache Hit Rate' })).getByText(
        '25.0%'
      )
    ).toBeVisible()
    expect(api.get).toHaveBeenCalledWith('/api/data/cache/self', {
      params: {
        start_timestamp: 1792540800,
        end_timestamp: 1792544400,
        default_time: 'hour',
        username: 'usage-user',
      },
    })
  })

  it('keeps eight loading cards in the same two, four and eight column layout', async () => {
    let releaseQuota: (value: unknown) => void = () => undefined
    let releaseCache: (value: unknown) => void = () => undefined
    vi.mocked(api.get).mockImplementation(
      (url) =>
        new Promise((resolve) => {
          if (url === '/api/data/self') releaseQuota = resolve
          if (url === '/api/data/cache/self') releaseCache = resolve
        })
    )
    const fallback = render(<LogStatCardsFallback />)
    const fallbackGrid = fallback.container.querySelector('.grid')
    expect(fallbackGrid).toHaveClass(
      'min-w-0',
      'grid-cols-2',
      'sm:grid-cols-4',
      'xl:grid-cols-8'
    )
    expect(fallbackGrid?.children).toHaveLength(8)
    expect(fallbackGrid?.lastElementChild).not.toHaveClass('col-span-2')
    fallback.unmount()

    render(<LogStatCards filters={filters} />)
    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(8)
    expect(groups[0].parentElement).toHaveClass(
      'min-w-0',
      'grid-cols-2',
      'sm:grid-cols-4',
      'xl:grid-cols-8'
    )
    for (const group of groups) {
      expect(group).toHaveAttribute('aria-busy', 'true')
      expect(group).not.toHaveClass('col-span-2')
    }
    await act(async () => {
      releaseQuota({ data: { success: true, data: quotaData } })
      releaseCache({ data: { success: true, data: cacheData } })
    })
    await waitForStatistics()
    expect(screen.getAllByRole('group')[0].parentElement).toHaveClass(
      'xl:grid-cols-8'
    )
  })

  it('shows zero cache quantities and a zero percentage for historical empty data', async () => {
    quotaData = [{ created_at: 1792540800, token_used: 100, count: 1 }]
    cacheData = []
    render(<LogStatCards filters={filters} />)
    await waitForStatistics()

    expect(
      within(screen.getByRole('group', { name: 'Cache Read' })).getByText('0')
    ).toBeVisible()
    expect(
      within(screen.getByRole('group', { name: 'Cache Write' })).getByText('0')
    ).toBeVisible()
    expect(
      within(screen.getByRole('group', { name: 'Cache Hit Rate' })).getByText(
        '0.0%'
      )
    ).toBeVisible()
  })

  it('shows unavailable values across all eight metrics when a statistics request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Statistics unavailable'))
    render(<LogStatCards filters={filters} />)
    await waitForStatistics()

    expect(screen.getAllByText('--')).toHaveLength(8)
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  })

  it('refreshes both administrator queries when filters change', async () => {
    useAuthStore.getState().auth.setUser({
      id: 2,
      username: 'admin',
      role: 10,
    })
    const view = render(<LogStatCards filters={filters} />)
    await waitForStatistics()
    const nextFilters = { ...filters, username: 'another-user' }
    view.rerender(<LogStatCards filters={nextFilters} />)
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/data/cache', {
        params: expect.objectContaining({ username: 'another-user' }),
      })
      expect(api.get).toHaveBeenCalledWith('/api/data', {
        params: expect.objectContaining({ username: 'another-user' }),
      })
    })
  })

  it('updates cache number formatting when the interface language changes', async () => {
    render(<LogStatCards filters={filters} />)
    await waitForStatistics()
    await act(async () => {
      await i18next.changeLanguage('fr')
    })
    expect(
      within(screen.getByRole('group', { name: 'Cache Read' })).getByTitle(
        '1 500'
      )
    ).toHaveAttribute('title', '1\u202f500')
    expect(
      within(screen.getByRole('group', { name: 'Cache Hit Rate' })).getByText(
        '25.0%'
      )
    ).toBeVisible()
  })
})
