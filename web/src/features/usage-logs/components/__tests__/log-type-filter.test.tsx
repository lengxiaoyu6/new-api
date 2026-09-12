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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route as UsageLogsRoute } from '@/routes/_authenticated/usage-logs/$section'

import { UsageLogsProvider } from '../usage-logs-provider'
import { UsageLogsTable } from '../usage-logs-table'

const clients: QueryClient[] = []

function FilterFixture() {
  return (
    <UsageLogsProvider>
      <UsageLogsTable logCategory='common' />
    </UsageLogsProvider>
  )
}

async function renderFilter(initialEntry = '/usage-logs/common') {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.startsWith('/api/log/self?')) {
      return { data: { success: true, data: { items: [], total: 0 } } }
    }
    return {
      data: {
        success: true,
        data: url === '/api/user/self/groups' ? {} : { quota: 0, rpm: 0, tpm: 0 },
      },
    }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: FilterFixture,
    validateSearch: UsageLogsRoute.options.validateSearch,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('combobox', { name: 'Type' })
  return router
}

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  vi.restoreAllMocks()
})

it('marks only retired log types as deprecated while keeping historical filters selectable', async () => {
  const router = await renderFilter()
  await userEvent.click(screen.getByRole('combobox', { name: 'Type' }))
  for (const label of ['Manage', 'Login']) {
    expect(
      within(
        screen.getByRole('option', { name: new RegExp(`^${label}`) })
      ).getByText('Deprecated')
    ).toBeVisible()
  }
  for (const label of [
    'All Types',
    'Top-up',
    'Consume',
    'System',
    'Error',
    'Refund',
    'Affiliate',
  ]) {
    expect(
      within(screen.getByRole('option', { name: label })).queryByText(
        'Deprecated'
      )
    ).not.toBeInTheDocument()
  }
  await userEvent.click(screen.getByRole('option', { name: /^Manage/ }))
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent(
    'Deprecated'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ type: ['3'], page: 1 })
  )
  await userEvent.click(screen.getByRole('combobox', { name: 'Type' }))
  await userEvent.click(screen.getByRole('option', { name: /^Login/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ type: ['7'], page: 1 })
  )
})

it('keeps Affiliate selected and requests only affiliate logs after Search', async () => {
  const router = await renderFilter()
  await userEvent.click(screen.getByRole('combobox', { name: 'Type' }))
  await userEvent.click(screen.getByRole('option', { name: 'Affiliate' }))
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))

  await waitFor(() =>
    expect(router.state.matches.at(-1)?.search).toMatchObject({
      type: ['8'],
      page: 1,
    })
  )
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent(
    'Affiliate'
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/log\/self\?.*\btype=8(?:&|$)/)
    )
  )
})

it('restores the Affiliate filter from a saved log URL', async () => {
  await renderFilter('/usage-logs/common?type=%5B%228%22%5D')
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent(
    'Affiliate'
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/log\/self\?.*\btype=8(?:&|$)/)
    )
  )
})
