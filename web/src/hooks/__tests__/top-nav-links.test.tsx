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
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { useTopNavLinks } from '../use-top-nav-links'

const useStatusMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-status', () => ({
  useStatus: useStatusMock,
}))

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
  vi.clearAllMocks()
})

beforeEach(() => {
  useStatusMock.mockReturnValue({
    status: {
      HeaderNavModules: {
        modelStatus: { enabled: true, requireAuth: false },
      },
    },
  })
})

describe('top navigation links', () => {
  it('does not include the model status entry', () => {
    const { result } = renderHook(() => useTopNavLinks())

    expect(result.current.map((link) => link.href)).not.toContain(
      '/model-status'
    )
    expect(result.current.map((link) => link.title)).not.toContain(
      'Model Status'
    )
  })
})
