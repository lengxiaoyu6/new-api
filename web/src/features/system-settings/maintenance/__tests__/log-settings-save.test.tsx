/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { assert, describe, test, vi } from 'vitest'

const { updateOptionCalls } = vi.hoisted(() => ({
  updateOptionCalls: [] as Array<{
    key: string
    value: string | boolean | number
  }>,
}))

vi.mock('@/features/system-settings/api', () => ({
  getSystemOptions: async () => ({ success: true, message: '', data: [] }),
  updateSystemOption: async (request: {
    key: string
    value: string | boolean | number
  }) => {
    updateOptionCalls.push(request)
    return { success: true, message: '' }
  },
  getCurrentLogCleanupTask: async () => ({
    success: true,
    message: '',
    data: null,
  }),
  getSystemTask: async () => ({ success: true, message: '', data: null }),
  startLogCleanupTask: async () => ({ success: true, message: '', data: null }),
  listSystemTasks: async () => ({ success: true, message: '', data: [] }),
}))

vi.mock('@/components/datetime-picker', () => ({
  DateTimePicker: () => null,
}))

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { SettingsPageProvider } =
  await import('@/features/system-settings/components/settings-page-context')
const { LogSettingsSection } =
  await import('@/features/system-settings/maintenance/log-settings-section')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Record quota usage': 'Record quota usage',
        'Save log settings': 'Save log settings',
      },
    },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

async function importToastSpy() {
  const sonner = await import('sonner')
  const calls: Array<{ type: string; message: string }> = []
  const originalInfo = sonner.toast.info
  const originalError = sonner.toast.error
  const originalSuccess = sonner.toast.success
  sonner.toast.info = ((message: unknown) => {
    calls.push({ type: 'info', message: String(message) })
  }) as typeof sonner.toast.info
  sonner.toast.error = ((message: unknown) => {
    calls.push({ type: 'error', message: String(message) })
  }) as typeof sonner.toast.error
  sonner.toast.success = ((message: unknown) => {
    calls.push({ type: 'success', message: String(message) })
  }) as typeof sonner.toast.success
  return {
    calls,
    restore: () => {
      sonner.toast.info = originalInfo
      sonner.toast.error = originalError
      sonner.toast.success = originalSuccess
    },
  }
}

async function renderSection(defaultEnabled: boolean) {
  const container = document.createElement('div')
  const actionsContainer = document.createElement('div')
  document.body.append(container)
  document.body.append(actionsContainer)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <SettingsPageProvider actionsContainer={actionsContainer}>
            <LogSettingsSection defaultEnabled={defaultEnabled} />
          </SettingsPageProvider>
        </I18nextProvider>
      </QueryClientProvider>
    )
  })

  return {
    root,
    container,
    actionsContainer,
    queryClient,
    findSaveButton: () =>
      [...actionsContainer.querySelectorAll('button')].find(
        (button) => button.textContent === 'Save log settings'
      ),
    findSwitch: () => container.querySelector<HTMLElement>('[role="switch"]'),
  }
}

describe('log settings save', () => {
  test('clicking save without changes shows feedback and sends no request', async () => {
    updateOptionCalls.length = 0
    const toastSpy = await importToastSpy()
    const fixture = await renderSection(false)

    const saveButton = fixture.findSaveButton()
    assert.ok(saveButton, 'save button should render in the actions area')

    await act(async () => {
      saveButton.click()
    })

    assert.strictEqual(
      updateOptionCalls.length,
      0,
      'updateOption should not be called when nothing changed'
    )
    assert.strictEqual(
      toastSpy.calls.some((c) => c.message === 'No changes to save'),
      true,
      'a no-changes toast should be shown'
    )

    await act(async () => fixture.root.unmount())
    fixture.container.remove()
    fixture.actionsContainer.remove()
    fixture.queryClient.clear()
    toastSpy.restore()
  })

  test('clicking save after toggling the switch calls updateOption', async () => {
    updateOptionCalls.length = 0
    const fixture = await renderSection(false)

    const saveButton = fixture.findSaveButton()
    assert.ok(saveButton, 'save button should render in the actions area')

    const recordSwitch = fixture.findSwitch()
    assert.ok(recordSwitch, 'record switch should render')

    await act(async () => {
      recordSwitch.click()
    })

    await act(async () => {
      saveButton.click()
    })

    assert.strictEqual(
      updateOptionCalls.length,
      1,
      'updateOption should be called once after toggling and saving'
    )
    assert.deepEqual(updateOptionCalls[0], {
      key: 'LogConsumeEnabled',
      value: true,
    })

    await act(async () => fixture.root.unmount())
    fixture.container.remove()
    fixture.actionsContainer.remove()
    fixture.queryClient.clear()
  })
})
