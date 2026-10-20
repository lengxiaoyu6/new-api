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
import { readFileSync } from 'node:fs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { STATUS_QUERY_KEY, type StatusData } from '@/lib/status-query'

import { HomeNoticeDialog } from '../components/home-notice-dialog'

const clients: QueryClient[] = []
let style: HTMLStyleElement

beforeEach(() => {
  localStorage.clear()
  style = document.createElement('style')
  style.textContent = readFileSync('src/styles/gateway-home.css', 'utf8')
  document.head.append(style)
})

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  style.remove()
  document.documentElement.classList.remove('dark')
  localStorage.clear()
})

function renderNotice(options: { notice?: string; status?: StatusData } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  })
  clients.push(client)
  client.setQueryData(['notice'], {
    success: true,
    data: options.notice ?? 'Platform **notice**.',
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    announcements_enabled: true,
    announcements: [
      {
        content: 'New models are available.',
        extra: 'Explore the model catalog.',
        publishDate: '2026-10-20T10:00:00Z',
        type: 'success',
      },
    ],
    ...options.status,
  })
  render(
    <QueryClientProvider client={client}>
      <main className='gateway-home' aria-label='Homepage'>
        <HomeNoticeDialog />
      </main>
    </QueryClientProvider>
  )
  return client
}

it.each(['light', 'dark'])(
  'keeps the portalled announcement in the homepage %s theme',
  async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    renderNotice()

    const dialog = await screen.findByRole('alertdialog', {
      name: 'System Announcements',
    })
    const homepage = screen.getByRole('main', {
      name: 'Homepage',
      hidden: true,
    })
    expect(homepage).not.toContainElement(dialog)
    for (const token of [
      '--background',
      '--foreground',
      '--card',
      '--primary',
      '--border',
    ]) {
      expect(getComputedStyle(dialog).getPropertyValue(token)).toBe(
        getComputedStyle(homepage).getPropertyValue(token)
      )
    }
    expect(dialog).toHaveAccessibleDescription(
      'Latest platform updates and notices'
    )
  }
)

it('keeps long notices scrollable while tabs and the close action retain their space', async () => {
  renderNotice({ notice: 'A long platform notice.\n\n'.repeat(60) })
  const dialog = await screen.findByRole('alertdialog')
  const panel = within(dialog).getByRole('tabpanel', { name: 'Notice' })
  const footer = within(dialog).getByRole('button', {
    name: 'Close',
  }).parentElement
  if (!footer) throw new Error('The announcement footer is missing')
  expect(getComputedStyle(dialog).display).toBe('flex')
  expect(getComputedStyle(dialog).flexDirection).toBe('column')
  expect(getComputedStyle(panel).overflowY).toBe('auto')
  expect(getComputedStyle(panel).minHeight).toBe('0px')
  expect(getComputedStyle(within(dialog).getByRole('tablist')).flexShrink).toBe(
    '0'
  )
  expect(getComputedStyle(footer).flexShrink).toBe('0')
  expect(panel).not.toContainElement(footer)
})

it('switches between notice and timeline with the keyboard and closes with the action', async () => {
  const user = userEvent.setup()
  renderNotice()
  const dialog = await screen.findByRole('alertdialog')
  const notice = within(dialog).getByRole('tab', { name: 'Notice' })
  notice.focus()
  await user.keyboard('{ArrowRight}{Enter}')

  const timeline = within(dialog).getByRole('tab', { name: 'Timeline' })
  expect(timeline).toHaveFocus()
  expect(timeline).toHaveAttribute('aria-selected', 'true')
  expect(
    within(dialog).getByRole('tabpanel', { name: 'Timeline' })
  ).toHaveTextContent('New models are available.')
  expect(within(dialog).getByText('Explore the model catalog.')).toBeVisible()

  within(dialog).getByRole('button', { name: 'Close' }).focus()
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
})

it.each([
  {
    notice: '',
    status: {},
    selected: 'Timeline',
    disabled: 'Notice',
  },
  {
    notice: 'Platform notice.',
    status: { announcements_enabled: false },
    selected: 'Notice',
    disabled: 'Timeline',
  },
])(
  'selects $selected and disables $disabled when only one content source is available',
  async ({ notice, status, selected, disabled }) => {
    const user = userEvent.setup()
    renderNotice({ notice, status })
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('tab', { name: selected })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(within(dialog).getByRole('tab', { name: disabled })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await user.click(within(dialog).getByRole('tab', { name: disabled }))
    expect(within(dialog).getByRole('tab', { name: selected })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(
      within(dialog).getByRole('tabpanel', { name: selected })
    ).toBeVisible()
  }
)

it('keeps the homepage unobstructed when notice is empty and announcements are disabled', () => {
  renderNotice({
    notice: ' \n ',
    status: { announcements_enabled: false },
  })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('keeps a dismissed announcement closed when unrelated status data refreshes', async () => {
  const user = userEvent.setup()
  const client = renderNotice()
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  await act(async () => {
    client.setQueryData(STATUS_QUERY_KEY, (status: StatusData) => ({
      ...status,
      system_name: 'Updated gateway name',
    }))
  })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})
