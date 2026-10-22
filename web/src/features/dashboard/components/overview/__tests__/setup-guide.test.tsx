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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { PanelWrapper } from '../../ui/panel-wrapper'
import { ApiInfoItemComponent } from '../api-info-item'
import { OverviewDashboard } from '../overview-dashboard'

const storageKey = 'dashboard_overview_setup_guide_expanded'
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)
let client: QueryClient
let keyLookupError: Error | null
let contentVisibility: Record<string, boolean>
let contentData: Record<string, unknown>

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'dashboard-user',
    role: 1,
    quota: 1000000,
    used_quota: 1000,
    request_count: 1,
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  keyLookupError = null
  contentVisibility = {
    api_info_enabled: false,
    announcements_enabled: false,
    faq_enabled: false,
    uptime_kuma_enabled: false,
  }
  contentData = {}
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    switch (url) {
      case '/api/token/?p=1&size=10':
        if (keyLookupError) throw keyLookupError
        return {
          data: {
            success: true,
            data: {
              items: [{ id: 1, name: 'App key', key: 'masked', status: 1 }],
            },
          },
        }
      case '/api/status':
        return {
          data: {
            data: { ...contentVisibility, ...contentData },
          },
        }
      case '/api/uptime/status':
        return { data: { success: true, data: [] } }
      case '/api/perf-metrics/summary':
        return { data: { success: true, data: { models: [] } } }
      case '/api/user/models':
        return { data: { success: true, data: ['gpt-4o-mini'] } }
      case '/api/data/self':
        return { data: { success: true, data: [] } }
      default:
        throw new Error(`Unexpected dashboard request: ${url}`)
    }
  })
})

afterEach(() => {
  cleanup()
  if (getAnimationsDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      getAnimationsDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  window.localStorage.clear()
})

async function renderOverview() {
  const router = createRouter({
    routeTree: createRootRoute({ component: OverviewDashboard }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('overview content layout', () => {
  it('reserves the same content height while an information panel is loading', () => {
    render(
      <PanelWrapper
        title='API Info'
        loading
        height='h-72'
        contentClassName='p-0 sm:p-0'
      />
    )

    const panel = screen.getByText('API Info').closest('.gateway-console-panel')
    expect(panel).toHaveClass('flex', 'h-full', 'flex-col')
    expect(panel?.lastElementChild).toHaveClass('h-72', 'flex-auto')
    expect(panel?.querySelector('[data-slot="skeleton"]')).toHaveClass(
      'size-full'
    )
  })

  it('keeps long API details above the actions in narrow panels', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn()
    const item = {
      route: 'Global application endpoint with a long display name',
      url: 'https://api.example.com/compatible/very-long-application-endpoint',
      description: 'OpenAI-compatible endpoint for application requests',
      color: 'blue',
    }
    const { container } = render(
      <ApiInfoItemComponent
        item={item}
        status={{ latency: 125, testing: false, error: false }}
        onTest={onTest}
      />
    )

    expect(container.firstElementChild).toHaveClass('flex-wrap')
    expect(container.firstElementChild?.firstElementChild).toHaveClass(
      'basis-full',
      '@lg/api-row:basis-0'
    )
    expect(screen.getByText(item.route)).toHaveClass('wrap-anywhere')
    expect(screen.getByText(item.url)).toHaveClass('truncate')
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'External Speed Test' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Open in New Tab' })
    ).toHaveAttribute('href', item.url)
    await user.click(screen.getByRole('button', { name: 'Test Latency' }))
    expect(onTest).toHaveBeenCalledWith(item.url)
  })

  it.each(['empty', 'populated'])(
    'keeps the three information panels equally sized with %s content',
    async (state) => {
      contentVisibility.api_info_enabled = true
      contentVisibility.announcements_enabled = true
      contentVisibility.faq_enabled = true
      if (state === 'populated') {
        contentData = {
          api_info: [
            {
              route: 'Public API',
              url: 'https://api.example.com/v1',
              description: 'Application endpoint',
              color: 'blue',
            },
          ],
          announcements: [{ id: 1, content: 'Service update' }],
          faq: [
            {
              id: 1,
              question: 'How can applications connect?',
              answer: 'Create an API key and configure the endpoint.',
            },
          ],
        }
      }
      await renderOverview()

      for (const title of ['API Info', 'Announcements', 'FAQ']) {
        const panel = (await screen.findByText(title)).closest(
          '.gateway-console-panel'
        )
        expect(panel).toHaveClass('flex', 'h-full', 'flex-col')
        expect(panel?.lastElementChild).toHaveClass(
          'min-h-0',
          'flex-auto',
          'h-72',
          'p-0',
          'sm:p-0'
        )

        if (state === 'populated') {
          expect(panel?.querySelector('[data-slot="scroll-area"]')).toHaveClass(
            'h-full'
          )
        }
      }

      if (state === 'populated') {
        const user = userEvent.setup()
        await user.click(
          screen.getByRole('button', {
            name: 'How can applications connect?',
          })
        )
        expect(
          screen.getByText('Create an API key and configure the endpoint.')
        ).toBeVisible()
      }
    }
  )

  it.each([
    {
      enabled: ['api_info_enabled', 'announcements_enabled', 'faq_enabled'],
      titles: ['API Info', 'Announcements', 'FAQ'],
      columns: 'lg:grid-cols-3',
    },
    {
      enabled: ['api_info_enabled', 'faq_enabled'],
      titles: ['API Info', 'FAQ'],
      columns: 'lg:grid-cols-2',
    },
    {
      enabled: ['announcements_enabled'],
      titles: ['Announcements'],
      columns: 'grid-cols-1',
    },
  ])(
    'places $titles in one desktop row and stacks them on mobile',
    async ({ enabled, titles, columns }) => {
      for (const key of enabled) contentVisibility[key] = true
      contentVisibility.uptime_kuma_enabled = true
      await renderOverview()

      const firstTitle = await screen.findByText(titles[0])
      const grid = firstTitle.closest('.grid')
      expect(grid).toHaveClass('grid-cols-1', columns)
      expect(
        titles.map((title) => screen.getByText(title).closest('.grid'))
      ).toEqual(titles.map(() => grid))
      for (const title of ['API Info', 'Announcements', 'FAQ']) {
        if (!titles.includes(title)) {
          expect(screen.queryByText(title)).not.toBeInTheDocument()
        }
      }
      expect(screen.queryByText('Uptime')).not.toBeInTheDocument()
      expect(api.get).not.toHaveBeenCalledWith('/api/uptime/status')
    }
  )

  it('keeps administrator performance health above the three information panels', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'dashboard-admin',
      role: 10,
      quota: 1000000,
      request_count: 1,
    })
    for (const key of Object.keys(contentVisibility)) {
      contentVisibility[key] = true
    }
    await renderOverview()

    const apiInfo = await screen.findByText('API Info')
    const performance = await screen.findByRole('heading', {
      name: 'Performance health',
    })
    const grid = apiInfo.closest('.grid')
    expect(grid).toHaveClass('lg:grid-cols-3')
    expect(performance.closest('.grid')).toBe(grid)
    expect(performance.closest('section')?.parentElement).toHaveClass(
      'lg:col-span-full'
    )
    expect(
      performance.compareDocumentPosition(apiInfo) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('omits uptime when it is enabled and all information panels are disabled', async () => {
    contentVisibility.uptime_kuma_enabled = true
    await renderOverview()

    await screen.findByRole('button', { name: 'Setup guide' })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.queryByText('Uptime')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalledWith('/api/uptime/status')
    for (const title of ['API Info', 'Announcements', 'FAQ']) {
      expect(screen.queryByText(title)).not.toBeInTheDocument()
    }
  })
})

describe('overview setup guide', () => {
  it('keeps usage before balance in the original combined summary panel', async () => {
    await renderOverview()
    const heading = await screen.findByRole('heading', {
      name: 'Usage at a glance',
    })
    const summary = heading.closest<HTMLElement>('.bg-card')
    expect(summary).toBeInTheDocument()
    if (!summary) throw new Error('The combined summary panel is missing')

    const layout = heading.closest('.grid')
    expect(layout).toHaveClass('xl:grid-cols-[minmax(0,1fr)_19rem]')
    const balance = within(summary)
      .getByText('Credit remaining')
      .closest('.border-t')
    expect(balance).toBeInTheDocument()
    expect(
      within(summary).getByRole('button', { name: 'Wallet' })
    ).toHaveAttribute('href', '/wallet')

    for (const title of ['Historical Usage', 'Request Count']) {
      const label = within(summary).getByText(title)
      expect(label.closest('.grid-cols-3')).toBeInTheDocument()
      expect(balance).not.toContainElement(label)
      expect(
        label.compareDocumentPosition(
          within(summary).getByText('Credit remaining')
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
  })

  it('shows usage first and only a header entry when setup is complete', async () => {
    await renderOverview()

    const toggle = await screen.findByRole('button', { name: 'Setup guide' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getAllByRole('heading').map((heading) => heading.textContent)
    ).toEqual(['Overview', 'Usage at a glance'])
    expect(screen.queryByText('Setup guide complete')).not.toBeInTheDocument()
    expect(screen.queryByText('Setup progress: 3/3')).not.toBeInTheDocument()
    for (const name of ['API Keys', 'Channels', 'Usage Logs', 'Pricing']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls') ?? ''
    )
    expect(panel).toBeInTheDocument()
    expect(panel).not.toBeVisible()
  })

  it('toggles the completed guide with the keyboard and restores focus after hiding it', async () => {
    const user = userEvent.setup()
    await renderOverview()
    const toggle = await screen.findByRole('button', { name: 'Setup guide' })

    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'Build on your API gateway in minutes',
      })
    ).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^API Keys/ })).toBeVisible()
    )

    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Hide setup guide' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('restores the completed guide preference after remounting', async () => {
    const user = userEvent.setup()
    const first = await renderOverview()
    await user.click(await screen.findByRole('button', { name: 'Setup guide' }))
    first.unmount()

    const second = await renderOverview()
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Hide setup guide' }))
    second.unmount()

    await renderOverview()
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Setup guide complete')).not.toBeInTheDocument()
  })

  it('keeps the existing progress banner when an incomplete guide is manually collapsed', async () => {
    const user = userEvent.setup()
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'new-user', role: 1 })
    await renderOverview()

    await user.click(
      await screen.findByRole('button', { name: 'Hide setup guide' })
    )
    expect(screen.getByText('Setup progress: 1/3')).toBeVisible()
    expect(
      screen.getByText('Setup guide is collapsed. Expand it anytime.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'API Keys' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Setup guide' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show setup guide' }))
    expect(
      screen.getByRole('button', { name: 'Hide setup guide' })
    ).toBeVisible()
  })

  it('removes the collapsed progress banner when the remaining setup step completes', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'dashboard-user',
      role: 1,
      quota: 1000000,
    })
    window.localStorage.setItem(storageKey, 'collapsed')
    await renderOverview()
    expect(await screen.findByText('Setup progress: 2/3')).toBeVisible()

    act(() => {
      useAuthStore.getState().auth.setUser({
        id: 1,
        username: 'dashboard-user',
        role: 1,
        quota: 1000000,
        request_count: 1,
      })
    })
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Setup progress:/)).not.toBeInTheDocument()
  })

  it('does not show a completed setup entry when the key lookup fails', async () => {
    keyLookupError = new Error('Key lookup unavailable')
    await renderOverview()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Hide setup guide' })
      ).toBeVisible()
    })
    expect(
      screen.queryByRole('button', { name: 'Setup guide' })
    ).not.toBeInTheDocument()
  })
})
