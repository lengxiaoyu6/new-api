/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { readFileSync } from 'node:fs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { DirectionProvider } from '@/context/direction-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { THEME_STORAGE_KEYS } from '@/lib/theme-storage'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { AuthenticatedLayout } from '../components/authenticated-layout'
import { SectionPageLayout } from '../components/section-page-layout'

let client: QueryClient
let style: HTMLStyleElement
const originalWidth = window.innerWidth
const originalMatchMedia = window.matchMedia

beforeEach(() => {
  window.localStorage.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'console-style-user',
    role: 1,
  })
  document.cookie = 'sidebar_state=true; path=/'
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1280,
  })
  style = document.createElement('style')
  style.textContent =
    readFileSync('src/styles/gateway-home.css', 'utf8') +
    readFileSync('src/styles/gateway-console.css', 'utf8')
  document.head.append(style)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    system_name: 'New API',
    HeaderNavModules: { home: true, console: true, docs: false, about: false },
  })
  client.setQueryData(['notice'], { success: true, data: '' })
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
})

afterEach(() => {
  cleanup()
  client.clear()
  style.remove()
  document.documentElement.classList.remove('light', 'dark')
  document.body.removeAttribute('data-theme-preset')
  document.cookie = 'sidebar_state=; path=/; max-age=0'
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: originalWidth,
  })
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  window.localStorage.clear()
})

async function renderConsole(defaultTheme?: 'light' | 'dark' | 'system') {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <AuthenticatedLayout>
          <SectionPageLayout>
            <SectionPageLayout.Title>Overview</SectionPageLayout.Title>
            <SectionPageLayout.Content>
              <p>Console content</p>
            </SectionPageLayout.Content>
          </SectionPageLayout>
        </AuthenticatedLayout>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  const content = (
    <DirectionProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </DirectionProvider>
  )
  return render(
    defaultTheme ? (
      <ThemeProvider defaultTheme={defaultTheme}>{content}</ThemeProvider>
    ) : (
      content
    )
  )
}

it.each([1280, 390])(
  'omits the header search entry at %ipx while retaining navigation controls',
  async (width) => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: width,
    })
    await renderConsole()
    const header = within(screen.getByRole('banner'))

    expect(
      header.queryByRole('button', { name: 'Search' })
    ).not.toBeInTheDocument()
    expect(header.getByRole('button', { name: 'Toggle Sidebar' })).toBeEnabled()
    expect(header.getByRole('button', { name: 'Notifications' })).toBeEnabled()
    expect(
      header.getByRole('button', { name: 'Change language' })
    ).toBeEnabled()
    expect(header.getByRole('button', { name: 'Toggle theme' })).toBeEnabled()
    expect(
      header.queryByRole('button', { name: 'Open theme settings' })
    ).not.toBeInTheDocument()
    expect(header.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/'
    )
    expect(header.getByRole('link', { name: 'Console' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
  }
)

it.each([
  { theme: 'light', systemDark: false, initial: 'light', next: 'dark' },
  { theme: 'dark', systemDark: false, initial: 'dark', next: 'light' },
  { theme: 'system', systemDark: false, initial: 'light', next: 'dark' },
  { theme: 'system', systemDark: true, initial: 'dark', next: 'light' },
] as const)(
  'switches the $theme theme from $initial to $next without opening settings',
  async ({ theme, systemDark, initial, next }) => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const media = originalMatchMedia(query)
      return {
        ...media,
        matches:
          query === '(prefers-color-scheme: dark)' ? systemDark : media.matches,
      }
    })
    await renderConsole(theme)
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: 'Toggle theme' })
    expect(toggle).toHaveAttribute('aria-pressed', String(initial === 'dark'))
    expect(document.documentElement).toHaveClass(initial)

    await user.click(toggle)

    expect(document.documentElement).toHaveClass(next)
    expect(toggle).toHaveAttribute('aria-pressed', String(next === 'dark'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(document.documentElement).toHaveClass(initial)
    expect(toggle).toHaveAttribute('aria-pressed', String(initial === 'dark'))
    expect(toggle).toHaveFocus()
  }
)

it('restores the console theme selection when the page is mounted again', async () => {
  const firstView = await renderConsole('dark')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Toggle theme' }))
  expect(window.localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('light')
  firstView.unmount()

  await renderConsole('dark')

  expect(document.documentElement).toHaveClass('light')
  expect(screen.getByRole('button', { name: 'Toggle theme' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
})

it.each(['light', 'dark'])(
  'uses the homepage %s palette for the console and portalled menus',
  async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    const view = await renderConsole()
    const homepage = document.createElement('div')
    homepage.className = 'gateway-home'
    document.body.append(homepage)

    try {
      for (const token of [
        '--background',
        '--foreground',
        '--card',
        '--primary',
        '--border',
      ]) {
        expect(getComputedStyle(document.body).getPropertyValue(token)).toBe(
          getComputedStyle(homepage).getPropertyValue(token)
        )
      }
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Change language' }))
      const menu = await screen.findByRole('menu')
      expect(view.container).not.toContainElement(menu)
      expect(menu.closest('body')).toBe(document.body)
      await user.keyboard('{Escape}')
      expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible()
    } finally {
      homepage.remove()
    }
  }
)

it.each(['light', 'dark'])(
  'gives the entire %s sidebar a card surface and a visible frame',
  async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    await renderConsole()
    const sidebar = document.querySelector('[data-slot="sidebar-inner"]')
    expect(sidebar).toBeInTheDocument()
    if (!sidebar) throw new Error('The sidebar surface is missing')

    const surface = getComputedStyle(sidebar)
    expect(surface.background).toBe('var(--card)')
    expect(surface.borderRadius).toBe('1.25rem')
    expect(surface.boxShadow).toContain('inset')
    expect(surface.boxShadow).toContain('var(--border)')
  }
)

it('preserves page spacing, heading size, and navigation dimensions when applying the console skin', async () => {
  await renderConsole()
  const header = screen.getByRole('banner')
  const elements = [
    document.body,
    header,
    header.firstElementChild,
    document.querySelector('[data-slot="sidebar-content"]'),
    document.querySelector('[data-slot="sidebar-menu"]'),
    screen.getByRole('link', { name: 'Wallet' }),
    document.querySelector('[data-slot="sidebar-inset"]'),
    screen.getByRole('heading', { name: 'Overview' }),
    screen.getByText('Console content').parentElement,
  ]
  const properties = [
    '--app-header-height',
    'display',
    'width',
    'height',
    'min-width',
    'min-height',
    'font-size',
    'font-weight',
    'letter-spacing',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin-bottom',
    'row-gap',
    'column-gap',
    'grid-template-columns',
    'overflow',
  ]

  style.remove()
  const baseline = elements.map((element) => {
    expect(element).toBeInTheDocument()
    if (!element) throw new Error('The console layout element is missing')
    const computed = getComputedStyle(element)
    return properties.map((property) => computed.getPropertyValue(property))
  })
  document.head.append(style)

  for (const [index, element] of elements.entries()) {
    if (!element) throw new Error('The console layout element is missing')
    const computed = getComputedStyle(element)
    expect(
      properties.map((property) => computed.getPropertyValue(property))
    ).toEqual(baseline[index])
  }
})

it('keeps the mobile sidebar usable and restores focus after closing it', async () => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 390,
  })
  await renderConsole()
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'Toggle Sidebar' })
  await user.click(trigger)
  const sidebar = await screen.findByRole('dialog', { name: 'Sidebar' })
  expect(within(sidebar).getByRole('link', { name: 'Wallet' })).toBeVisible()
  await user.keyboard('{Escape}')
  expect(
    screen.queryByRole('dialog', { name: 'Sidebar' })
  ).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('releases the console palette when leaving the layout and preserves custom presets', async () => {
  document.body.setAttribute('data-theme-preset', 'rose-garden')
  await renderConsole()
  expect(getComputedStyle(document.body).getPropertyValue('--primary')).toBe('')
  cleanup()
  document.body.removeAttribute('data-theme-preset')
  expect(getComputedStyle(document.body).getPropertyValue('--background')).toBe(
    ''
  )
})
