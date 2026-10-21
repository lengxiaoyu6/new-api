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
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkIsActive } from '@/components/layout/lib/url-utils'
import {
  parseSidebarModulesAdmin,
  serializeSidebarModulesAdmin,
} from '@/features/system-settings/maintenance/config'
import { useAuthStore } from '@/stores/auth-store'

import { useSidebarConfig } from '../use-sidebar-config'
import { useSidebarData } from '../use-sidebar-data'

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function sidebarFor(admin?: object, user?: object, canConfigure = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    SidebarModulesAdmin: admin ? JSON.stringify(admin) : '',
  })
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'alice',
    role: 1,
    permissions: { sidebar_settings: canConfigure },
    sidebar_modules: user ? JSON.stringify(user) : '',
  })
  function Wrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  const result = renderHook(
    () => useSidebarConfig(useSidebarData().navGroups),
    { wrapper: Wrapper }
  )
  return result
}

describe('sidebar navigation groups', () => {
  it('shows Chat first, followed by the five personal management groups in order', () => {
    const { result } = sidebarFor()

    expect(
      result.current
        .filter((group) => group.id !== 'admin')
        .map((group) => ({
          title: group.title,
          items: group.items.map((item) => item.title),
        }))
    ).toEqual([
      { title: 'Chat', items: ['Playground', 'Chat'] },
      { title: 'Dashboards', items: ['Overview', 'Dashboard'] },
      { title: 'API Management', items: ['API Keys'] },
      { title: 'Logs', items: ['Usage Logs', 'Audit Logs', 'Task Logs'] },
      {
        title: 'Account & Assets',
        items: ['Subscription Usage', 'Wallet', 'Lottery', 'Referral'],
      },
      { title: 'Account Settings', items: ['Profile', 'Security & Access'] },
    ])
  })

  it('keeps the administrator group and its entries in the existing order', () => {
    const { result } = sidebarFor()
    const adminGroup = result.current.find((group) => group.id === 'admin')

    expect(adminGroup?.title).toBe('Admin')
    expect(
      adminGroup?.items.map((item) => ({ title: item.title, url: item.url }))
    ).toEqual([
      { title: 'Channels', url: '/channels' },
      { title: 'Models', url: '/models/metadata' },
      { title: 'Users', url: '/users' },
      { title: 'Redemption Codes', url: '/redemption-codes' },
      { title: 'Subscription Management', url: '/subscriptions' },
      { title: 'Lottery management', url: '/lottery-admin' },
      { title: 'System Info', url: '/system-info' },
      { title: 'Task Plugins', url: '/task-plugins' },
      { title: 'System Settings', url: '/system-settings/site' },
    ])
  })

  it('honors the legacy console section switch across the new groups', () => {
    const { result } = sidebarFor({ console: { enabled: false } })
    const groupIds = result.current.map((group) => group.id)

    expect(groupIds).not.toContain('dashboard')
    expect(groupIds).not.toContain('api-management')
    expect(groupIds).not.toContain('logs')
    expect(
      result.current
        .find((group) => group.id === 'chat')
        ?.items.map((item) => item.title)
    ).toEqual(['Playground', 'Chat'])
  })

  it('hides API Management when tokens are disabled and keeps Chat visible', () => {
    const { result } = sidebarFor({ console: { token: false } })

    expect(result.current.some((group) => group.id === 'api-management')).toBe(
      false
    )
    expect(result.current.some((group) => group.id === 'chat')).toBe(true)
    expect(result.current.some((group) => group.id === 'dashboard')).toBe(true)
  })

  it('hides Chat when its section is disabled and keeps API Management visible', () => {
    const { result } = sidebarFor(undefined, { chat: { enabled: false } })

    expect(result.current.some((group) => group.id === 'chat')).toBe(false)
    expect(
      result.current
        .find((group) => group.id === 'api-management')
        ?.items.map((item) => item.title)
    ).toEqual(['API Keys'])
  })

  it('hides Account Settings when both profile and security are disabled', () => {
    const { result } = sidebarFor(undefined, {
      personal: { personal: false, security: false },
    })

    expect(
      result.current.some((group) => group.id === 'account-settings')
    ).toBe(false)
    expect(result.current.some((group) => group.id === 'account-assets')).toBe(
      true
    )
  })
})

describe('security sidebar visibility', () => {
  it('old configurations show Security & Access immediately after Profile and keep Referral and API Keys', () => {
    const { result } = sidebarFor(
      { personal: { enabled: true, personal: true, topup: true } },
      { personal: { enabled: true, personal: true } }
    )
    expect(
      result.current
        .find((group) => group.id === 'account-settings')
        ?.items.map((item) => item.title)
    ).toEqual(['Profile', 'Security & Access'])
    expect(
      result.current
        .find((group) => group.id === 'account-assets')
        ?.items.some((item) => item.title === 'Referral')
    ).toBe(true)
    expect(
      result.current
        .flatMap((group) => group.items)
        .some((item) => item.title === 'API Keys')
    ).toBe(true)
  })
  it.each([
    [{ personal: { enabled: true, security: false } }, undefined],
    [{ personal: { enabled: false } }, { personal: { security: true } }],
    [undefined, { personal: { enabled: true, security: false } }],
    [undefined, { personal: { enabled: false } }],
  ])(
    'admin or user disablement hides Security & Access (%j, %j)',
    (admin, user) => {
      const { result } = sidebarFor(admin, user)
      expect(
        result.current
          .flatMap((group) => group.items)
          .some((item) => item.title === 'Security & Access')
      ).toBe(false)
    }
  )
  it('users without sidebar configuration permission retain the admin view', () => {
    const { result } = sidebarFor(
      undefined,
      { personal: { security: false } },
      false
    )
    expect(
      result.current
        .flatMap((group) => group.items)
        .some((item) => item.title === 'Security & Access')
    ).toBe(true)
  })
})

describe('subscription usage sidebar entry', () => {
  it('defaults the personal subscription entry to visible for old configurations', () => {
    const config = parseSidebarModulesAdmin(
      '{"personal":{"enabled":true,"topup":false}}'
    )
    expect(config.personal.subscription).toBe(true)
    const { result } = sidebarFor(config)
    const items =
      result.current.find((group) => group.id === 'account-assets')?.items ?? []
    expect(items).toContainEqual(
      expect.objectContaining({
        title: 'Subscription Usage',
        url: '/subscription-usage',
      })
    )
    expect(items.some((item) => item.title === 'Wallet')).toBe(false)
  })

  it.each([
    [{ personal: { enabled: true, subscription: false } }, undefined],
    [{ personal: { enabled: false } }, undefined],
    [undefined, { personal: { enabled: true, subscription: false } }],
  ])(
    'honors admin and personal subscription visibility settings (%j, %j)',
    (admin, user) => {
      const { result } = sidebarFor(admin, user)
      expect(
        result.current
          .flatMap((group) => group.items)
          .some((item) => item.title === 'Subscription Usage')
      ).toBe(false)
    }
  )
})

describe('audit log sidebar entry', () => {
  it('admin settings default Audit Logs to visible and preserve its independent toggle when saved', () => {
    const config = parseSidebarModulesAdmin(
      '{"console":{"enabled":true,"log":true}}'
    )
    expect(config.console.audit).toBe(true)
    config.console.audit = false
    const saved = parseSidebarModulesAdmin(serializeSidebarModulesAdmin(config))
    const { result } = sidebarFor(saved)
    const titles = result.current
      .flatMap((group) => group.items)
      .map((item) => item.title)
    expect(titles).not.toContain('Audit Logs')
    expect(titles).toContain('Usage Logs')
  })

  it('legacy configurations show a separate Audit Logs link immediately after Usage Logs', () => {
    const { result } = sidebarFor(
      { console: { enabled: true, log: true } },
      { console: { enabled: true, log: true } }
    )
    const items =
      result.current.find((group) => group.id === 'logs')?.items ?? []
    const usageIndex = items.findIndex((item) => item.title === 'Usage Logs')
    expect(items[usageIndex + 1]).toMatchObject({
      title: 'Audit Logs',
      url: '/usage-logs/audit',
    })
    const selected = items.filter((item) =>
      checkIsActive('/usage-logs/audit', item)
    )
    expect(selected.map((item) => item.title)).toEqual(['Audit Logs'])
  })

  it.each([
    [{ console: { enabled: true, audit: false } }, undefined],
    [{ console: { enabled: false } }, { console: { audit: true } }],
    [undefined, { console: { enabled: true, audit: false } }],
    [undefined, { console: { enabled: false } }],
  ])(
    'admin and personal visibility rules can hide Audit Logs (%j, %j)',
    (admin, user) => {
      const { result } = sidebarFor(admin, user)
      expect(
        result.current
          .flatMap((group) => group.items)
          .some((item) => item.title === 'Audit Logs')
      ).toBe(false)
    }
  )

  it('hiding Usage Logs does not hide the independently configured Audit Logs entry', () => {
    const { result } = sidebarFor({ console: { enabled: true, log: false } })
    const titles = result.current
      .flatMap((group) => group.items)
      .map((item) => item.title)
    expect(titles).not.toContain('Usage Logs')
    expect(titles).toContain('Audit Logs')
  })
})
