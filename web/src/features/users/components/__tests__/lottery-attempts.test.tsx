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
import type { Row } from '@tanstack/react-table'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { User } from '../../types'
import { DataTableRowActions } from '../data-table-row-actions'
import { UsersProvider } from '../users-provider'

const target: User = {
  id: 2,
  username: 'lottery-recipient',
  display_name: 'Lottery recipient',
  role: 1,
  status: 1,
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
}

function renderRow(user = target) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <UsersProvider>
        <DataTableRowActions row={{ original: user } as Row<User>} />
      </UsersProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('adds the requested draw attempts from the user menu and closes the dialog', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  renderRow()

  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  await user.click(screen.getByRole('menuitem', { name: 'Add draw attempts' }))
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
    'Add draw attempts for lottery-recipient.'
  )
  const count = screen.getByRole('spinbutton', { name: 'Draw attempts' })
  await user.clear(count)
  await user.type(count, '3')
  await user.type(
    screen.getByRole('textbox', { name: 'Reason' }),
    'Support gift'
  )
  await user.click(screen.getByRole('button', { name: 'Confirm' }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/lottery/admin/users/2/attempts', {
      count: 3,
      reason: 'Support gift',
      request_id: expect.any(String),
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it.each(['0', '-1', '1.5', '1000001'])(
  'rejects the invalid draw count %s before sending a request',
  async (value) => {
    const post = vi.spyOn(api, 'post')
    const user = userEvent.setup()
    renderRow()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(
      screen.getByRole('menuitem', { name: 'Add draw attempts' })
    )
    const count = screen.getByRole('spinbutton', { name: 'Draw attempts' })
    await user.clear(count)
    await user.type(count, value)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByText(
        'Draw attempts must be an integer between 1 and 1000000'
      )
    ).toBeVisible()
    expect(count).toHaveAttribute('aria-invalid', 'true')
    expect(post).not.toHaveBeenCalled()
  }
)

it('keeps form values and reuses the request identifier when retrying a failed grant', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'The user has too many unused granted draw attempts',
      },
    })
    .mockResolvedValueOnce({ data: { success: true } })
  const user = userEvent.setup()
  renderRow()
  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  await user.click(screen.getByRole('menuitem', { name: 'Add draw attempts' }))

  for (const attempt of [1, 2]) {
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(attempt))
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeEnabled()
    expect(
      screen.getByRole('spinbutton', { name: 'Draw attempts' })
    ).toHaveValue(1)
  }
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
  expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1])
  expect(post.mock.calls[2][1]).toEqual(post.mock.calls[0][1])
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it('prevents repeated submission and dismissal while a grant is pending', async () => {
  const response = Promise.withResolvers<void>()
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    await response.promise
    return { data: { success: true } }
  })
  const user = userEvent.setup()
  renderRow()
  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  await user.click(screen.getByRole('menuitem', { name: 'Add draw attempts' }))
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(
    await screen.findByRole('button', { name: 'Processing...' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(
    screen.getByRole('spinbutton', { name: 'Draw attempts' })
  ).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(post).toHaveBeenCalledTimes(1)
  await act(async () => response.resolve())
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it.each([
  { permission: false, targetRole: 1, visible: false },
  { permission: true, targetRole: 1, visible: true },
  { permission: true, targetRole: 10, visible: false },
  { permission: true, targetRole: 100, visible: false },
])(
  'shows the grant action only with permission and a lower target role (%j)',
  async ({ permission, targetRole, visible }) => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'admin',
      role: 10,
      permissions: { admin_permissions: { lottery: { operate: permission } } },
    })
    renderRow({ ...target, role: targetRole })
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const action = screen.queryByRole('menuitem', { name: 'Add draw attempts' })
    if (visible) {
      expect(action).toBeVisible()
    } else {
      expect(action).not.toBeInTheDocument()
    }
  }
)
