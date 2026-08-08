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
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'
import type { Root } from 'react-dom/client'

import type { ModelStatusItem } from '../types'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const reducedMotionMediaQuery = domWindow.matchMedia('(prefers-reduced-motion)')
Object.defineProperty(reducedMotionMediaQuery, 'matches', {
  configurable: true,
  value: true,
})
Object.defineProperty(domWindow, 'matchMedia', {
  configurable: true,
  value: () => reducedMotionMediaQuery,
})

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { ModelStatusContent } = await import('../index')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: false,
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const statusItems: ModelStatusItem[] = [
  {
    providerId: 'alpha',
    provider: 'AlphaAI',
    modelName: 'alpha-fast',
    healthScore: 99,
    fastestTtftMs: 120,
    slowestTtftMs: 800,
    successRate: 99.5,
    requestCount: 120,
    groups: [
      {
        group: 'default',
        healthScore: 99,
        fastestTtftMs: 120,
        slowestTtftMs: 800,
        successRate: 99.5,
        requestCount: 100,
        status: 'healthy',
      },
      {
        group: 'vip',
        healthScore: 100,
        fastestTtftMs: 100,
        slowestTtftMs: 700,
        successRate: 100,
        requestCount: 20,
        status: 'healthy',
      },
    ],
    status: 'healthy',
  },
  {
    providerId: 'alpha',
    provider: 'AlphaAI',
    modelName: 'alpha-reasoner',
    healthScore: 76,
    fastestTtftMs: 880,
    slowestTtftMs: 4200,
    successRate: 92.25,
    requestCount: 80,
    groups: [
      {
        group: 'default',
        healthScore: 76,
        fastestTtftMs: 880,
        slowestTtftMs: 4200,
        successRate: 92.25,
        requestCount: 80,
        status: 'degraded',
      },
    ],
    status: 'degraded',
  },
  {
    providerId: 'beta',
    provider: 'BetaML',
    modelName: 'beta-offline',
    healthScore: 24,
    fastestTtftMs: 0,
    slowestTtftMs: 0,
    successRate: 48.75,
    requestCount: 40,
    groups: [
      {
        group: 'default',
        healthScore: 24,
        fastestTtftMs: 0,
        slowestTtftMs: 0,
        successRate: 48.75,
        requestCount: 40,
        status: 'down',
      },
    ],
    status: 'down',
  },
  {
    providerId: 'gamma',
    provider: 'GammaWorks',
    modelName: 'gamma-lag',
    healthScore: 83,
    fastestTtftMs: 670,
    slowestTtftMs: 3900,
    successRate: 95.2,
    requestCount: 60,
    groups: [
      {
        group: 'vip',
        healthScore: 83,
        fastestTtftMs: 670,
        slowestTtftMs: 3900,
        successRate: 95.2,
        requestCount: 60,
        status: 'degraded',
      },
    ],
    status: 'degraded',
  },
]

async function renderModelStatus(
  items: ModelStatusItem[] = statusItems,
  props: { lastUpdated?: string | number } = {}
) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <ModelStatusContent items={items} {...props} />
      </I18nextProvider>
    )
  })

  return { container, root }
}

async function cleanupRendered(root: Root, container: HTMLElement) {
  await act(async () => root.unmount())
  container.remove()
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    domWindow.HTMLInputElement.prototype,
    'value'
  )?.set
  assert.ok(valueSetter)
  valueSetter.call(input, value)
  input.dispatchEvent(
    new domWindow.Event('input', { bubbles: true }) as unknown as Event
  )
}

function changeSelectValue(select: HTMLSelectElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    domWindow.HTMLSelectElement.prototype,
    'value'
  )?.set
  assert.ok(valueSetter)
  valueSetter.call(select, value)
  select.dispatchEvent(
    new domWindow.Event('change', { bubbles: true }) as unknown as Event
  )
}

function getSearchInput(container: ParentNode): HTMLInputElement {
  const searchInput = container.querySelector<HTMLInputElement>(
    '#model-status-search'
  )
  assert.ok(searchInput)
  return searchInput
}

function getProviderSelect(container: ParentNode): HTMLSelectElement {
  const providerSelect = container.querySelector<HTMLSelectElement>(
    '#model-status-provider'
  )
  assert.ok(providerSelect)
  return providerSelect
}

function getButton(container: ParentNode, label: string): HTMLButtonElement {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((candidate) => candidate.textContent === label)
  assert.ok(button)
  return button
}

function getModelRowTexts(container: ParentNode): string[] {
  return [...container.querySelectorAll('article')].map(
    (article) => article.textContent ?? ''
  )
}

describe('model status', () => {
  after(() => {
    domWindow.close()
  })

  test('groups models by provider and renders the requested health metrics', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const pageText = container.textContent ?? ''
      assert.ok(pageText.includes('Model Status'))
      assert.ok(
        pageText.includes(
          'Monitor model availability and first-token performance by provider.'
        )
      )

      const providerCards = [
        ...container.querySelectorAll<HTMLElement>('[data-slot="card"]'),
      ].filter((card) => card.textContent?.includes('models monitored'))
      assert.equal(providerCards.length, 3)
      assert.ok(providerCards[0].textContent?.includes('AlphaAI'))
      assert.ok(providerCards[0].textContent?.includes('2 models monitored'))
      assert.ok(providerCards[1].textContent?.includes('BetaML'))
      assert.ok(providerCards[2].textContent?.includes('GammaWorks'))

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 4)
      const alphaFastRow = rowTexts.find((rowText) =>
        rowText.includes('alpha-fast')
      )
      assert.ok(alphaFastRow)
      assert.ok(alphaFastRow.includes('99%'))
      assert.ok(alphaFastRow.includes('120ms'))
      assert.ok(alphaFastRow.includes('800ms'))
      assert.ok(alphaFastRow.includes('99.50%'))
      assert.ok(alphaFastRow.includes('Groups'))
      assert.ok(alphaFastRow.includes('default'))
      assert.ok(alphaFastRow.includes('vip'))
      assert.ok(alphaFastRow.includes('Requests'))
      assert.ok(pageText.includes('Fastest first token'))
      assert.ok(pageText.includes('Slowest first token'))
      assert.ok(pageText.includes('Success rate'))
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('omits the summary cards while keeping provider groups visible', async () => {
    const { container, root } = await renderModelStatus()

    try {
      assert.equal(
        container.querySelector('section[aria-label="Model status summary"]'),
        null
      )
      const pageText = container.textContent ?? ''
      assert.equal(pageText.includes('Average health'), false)
      assert.equal(pageText.includes('Average success rate'), false)
      const providerCards = [
        ...container.querySelectorAll<HTMLElement>('[data-slot="card"]'),
      ].filter((card) => card.textContent?.includes('models monitored'))
      assert.equal(providerCards.length, 3)
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('filters rows by selected provider in the provider dropdown', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const providerSelect = getProviderSelect(container)
      assert.equal(providerSelect.value, 'all')
      const optionTexts = [
        ...providerSelect.querySelectorAll<HTMLOptionElement>('option'),
      ].map((option) => option.textContent)
      assert.deepEqual(optionTexts, ['All', 'AlphaAI', 'BetaML', 'GammaWorks'])

      await act(async () => {
        changeSelectValue(providerSelect, 'beta')
      })

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 1)
      assert.ok(rowTexts[0].includes('beta-offline'))
      assert.equal((container.textContent ?? '').includes('alpha-fast'), false)
      assert.equal((container.textContent ?? '').includes('gamma-lag'), false)
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('filters rows by model name keyword entered in the search field', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const searchInput = getSearchInput(container)
      assert.equal(searchInput.placeholder, 'Search model name...')

      await act(async () => {
        changeInputValue(searchInput, 'reasoner')
      })

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 1)
      assert.ok(rowTexts[0].includes('alpha-reasoner'))
      assert.equal((container.textContent ?? '').includes('alpha-fast'), false)
      assert.equal((container.textContent ?? '').includes('gamma-lag'), false)

      await act(async () => {
        changeInputValue(searchInput, 'AlphaAI')
      })

      assert.equal(getModelRowTexts(container).length, 0)
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('filters rows by selected health status and exposes the active filter state', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const allButton = getButton(container, 'All')
      const degradedButton = getButton(container, 'Degraded')
      assert.equal(allButton.getAttribute('aria-pressed'), 'true')
      assert.equal(degradedButton.getAttribute('aria-pressed'), 'false')

      await act(async () => degradedButton.click())

      assert.equal(allButton.getAttribute('aria-pressed'), 'false')
      assert.equal(degradedButton.getAttribute('aria-pressed'), 'true')

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 2)
      assert.ok(rowTexts.some((rowText) => rowText.includes('alpha-reasoner')))
      assert.ok(rowTexts.some((rowText) => rowText.includes('gamma-lag')))
      assert.equal((container.textContent ?? '').includes('alpha-fast'), false)
      assert.equal(
        (container.textContent ?? '').includes('beta-offline'),
        false
      )
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('shows the empty state when filters match no model', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const searchInput = getSearchInput(container)

      await act(async () => {
        changeInputValue(searchInput, 'missing-model')
      })

      assert.equal(getModelRowTexts(container).length, 0)
      const pageText = container.textContent ?? ''
      assert.ok(
        pageText.includes('No model status matches the current filters')
      )
      assert.ok(
        pageText.includes('Adjust the search keyword or health status filter.')
      )
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('shows unknown status and placeholder metrics when model has no samples', async () => {
    const { container, root } = await renderModelStatus([
      {
        providerId: 'delta',
        provider: 'DeltaAI',
        modelName: 'delta-pending',
        healthScore: Number.NaN,
        fastestTtftMs: Number.NaN,
        slowestTtftMs: Number.NaN,
        successRate: Number.NaN,
        requestCount: 0,
        groups: [],
        status: 'unknown',
      },
    ])

    try {
      const pageText = container.textContent ?? ''
      assert.ok(pageText.includes('DeltaAI'))
      assert.ok(pageText.includes('Unknown'))
      assert.ok(pageText.includes('Current model has no request data'))

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 1)
      assert.ok(rowTexts[0].includes('delta-pending'))
      assert.ok(rowTexts[0].includes('—'))
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('renders group metrics when a group has no samples', async () => {
    const { container, root } = await renderModelStatus([
      {
        providerId: 'epsilon',
        provider: 'EpsilonAI',
        modelName: 'epsilon-live',
        healthScore: 95,
        fastestTtftMs: 240,
        slowestTtftMs: 900,
        successRate: 99,
        requestCount: 10,
        groups: [
          {
            group: 'default',
            healthScore: 95,
            fastestTtftMs: 240,
            slowestTtftMs: 900,
            successRate: 99,
            requestCount: 10,
            status: 'healthy',
          },
          {
            group: 'vip',
            healthScore: Number.NaN,
            fastestTtftMs: Number.NaN,
            slowestTtftMs: Number.NaN,
            successRate: Number.NaN,
            requestCount: 0,
            status: 'unknown',
          },
        ],
        status: 'healthy',
      },
    ])

    try {
      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 1)
      assert.ok(rowTexts[0].includes('epsilon-live'))
      assert.ok(rowTexts[0].includes('default'))
      assert.ok(rowTexts[0].includes('vip'))
      assert.ok(rowTexts[0].includes('No data available'))
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('shows the all-groups message when every group has no samples', async () => {
    const { container, root } = await renderModelStatus([
      {
        providerId: 'zeta',
        provider: 'ZetaAI',
        modelName: 'zeta-empty',
        healthScore: Number.NaN,
        fastestTtftMs: Number.NaN,
        slowestTtftMs: Number.NaN,
        successRate: Number.NaN,
        requestCount: 0,
        groups: [
          {
            group: 'default',
            healthScore: Number.NaN,
            fastestTtftMs: Number.NaN,
            slowestTtftMs: Number.NaN,
            successRate: Number.NaN,
            requestCount: 0,
            status: 'unknown',
          },
          {
            group: 'vip',
            healthScore: Number.NaN,
            fastestTtftMs: Number.NaN,
            slowestTtftMs: Number.NaN,
            successRate: Number.NaN,
            requestCount: 0,
            status: 'unknown',
          },
        ],
        status: 'unknown',
      },
    ])

    try {
      const pageText = container.textContent ?? ''
      assert.ok(pageText.includes('All groups have no request data yet.'))
      assert.equal(
        pageText.includes('No data available'),
        false
      )
      assert.equal(
        container.querySelectorAll('article').length,
        1
      )
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('formats the last update time when the active language is zhCN', async () => {
    await i18n.changeLanguage('zhCN')
    const { container, root } = await renderModelStatus(statusItems, {
      lastUpdated: 1_704_067_200,
    })

    try {
      const pageText = container.textContent ?? ''
      assert.ok(pageText.includes('Last updated:'))
      assert.ok(pageText.includes('2024'))
    } finally {
      await cleanupRendered(root, container)
      await i18n.changeLanguage('en')
    }
  })

  test('omits the last update text when the update value is empty', async () => {
    const { container, root } = await renderModelStatus(statusItems, {
      lastUpdated: '',
    })

    try {
      assert.equal(
        (container.textContent ?? '').includes('Last updated:'),
        false
      )
    } finally {
      await cleanupRendered(root, container)
    }
  })
})
