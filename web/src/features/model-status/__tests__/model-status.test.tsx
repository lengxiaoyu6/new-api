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

function makeItem(
  overrides: Partial<ModelStatusItem> & { modelName: string }
): ModelStatusItem {
  return {
    providerId: 'alpha',
    provider: 'AlphaAI',
    healthScore: 99,
    fastestTtftMs: 120,
    slowestTtftMs: 800,
    successRate: 99.5,
    requestCount: 120,
    recentSuccessRates: [99, 99.4, 99.5, 99.8],
    groups: [],
    status: 'healthy',
    ...overrides,
  }
}

const statusItems: ModelStatusItem[] = [
  makeItem({
    providerId: 'alpha',
    provider: 'AlphaAI',
    modelName: 'alpha-fast',
  }),
  makeItem({
    providerId: 'alpha',
    provider: 'AlphaAI',
    modelName: 'alpha-reasoner',
    healthScore: 76,
    fastestTtftMs: 880,
    slowestTtftMs: 4200,
    successRate: 92.25,
    recentSuccessRates: [95, 93, 92.5, 91],
    status: 'degraded',
  }),
  makeItem({
    providerId: 'beta',
    provider: 'BetaML',
    modelName: 'beta-offline',
    healthScore: 24,
    fastestTtftMs: 0,
    slowestTtftMs: 0,
    successRate: 48.75,
    recentSuccessRates: [60, 52, 45, 40],
    status: 'down',
  }),
  makeItem({
    providerId: 'gamma',
    provider: 'GammaWorks',
    modelName: 'gamma-lag',
    healthScore: 83,
    fastestTtftMs: 670,
    slowestTtftMs: 3900,
    successRate: 95.2,
    recentSuccessRates: [96, 95, 95, 94],
    status: 'degraded',
  }),
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

function getSortSelect(container: ParentNode): HTMLSelectElement {
  const sortSelect =
    container.querySelector<HTMLSelectElement>('#model-status-sort')
  assert.ok(sortSelect)
  return sortSelect
}

function getButton(container: ParentNode, label: string): HTMLButtonElement {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((candidate) => candidate.textContent === label)
  assert.ok(button, `expected a button labelled "${label}"`)
  return button
}

function getModelRowTexts(container: ParentNode): string[] {
  return [...container.querySelectorAll('article')].map(
    (article) => article.textContent ?? ''
  )
}

function getProviderGroups(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-provider-group]')]
}

function getVerdictTiles(container: ParentNode): HTMLButtonElement[] {
  const verdictCard = container.querySelector('[data-slot="card"]')
  assert.ok(verdictCard)
  return [
    ...verdictCard.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
  ]
}

describe('model status (public page)', () => {
  after(() => {
    domWindow.close()
  })

  test('renders the verdict summary and groups model trends by provider', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const pageText = container.textContent ?? ''
      assert.ok(pageText.includes('Model Status'))
      assert.ok(
        pageText.includes('Live 24h availability trends for all models.')
      )
      assert.ok(pageText.includes('1 models are unavailable'))
      assert.ok(pageText.includes('Overall 24h availability is 83.9%'))

      const tiles = getVerdictTiles(container)
      assert.equal(tiles.length, 4)
      assert.ok(tiles[0].textContent?.includes('Healthy'))
      assert.ok(tiles[1].textContent?.includes('Unstable'))
      assert.ok(tiles[2].textContent?.includes('Unavailable'))
      assert.ok(tiles[3].textContent?.includes('No data yet'))

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 4)
      const providerGroups = getProviderGroups(container)
      assert.equal(providerGroups.length, 3)
      assert.ok(providerGroups[0].textContent?.includes('AlphaAI'))
      assert.ok(providerGroups[0].textContent?.includes('2 models'))
      assert.ok(providerGroups[1].textContent?.includes('BetaML'))
      assert.ok(providerGroups[2].textContent?.includes('GammaWorks'))
      const alphaFastRow = rowTexts.find((rowText) =>
        rowText.includes('alpha-fast')
      )
      assert.ok(alphaFastRow)
      assert.ok(
        rowTexts
          .find((rowText) => rowText.includes('beta-offline'))
          ?.includes('48.8%')
      )
      assert.equal(container.textContent?.includes('models monitored'), false)
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('shows an all-operational verdict when every model is healthy', async () => {
    const { container, root } = await renderModelStatus([
      makeItem({ modelName: 'alpha-fast' }),
      makeItem({ modelName: 'alpha-mini' }),
    ])

    try {
      const pageText = container.textContent ?? ''
      assert.ok(pageText.includes('All systems operational'))
      assert.ok(pageText.includes('Overall 24h availability is 99.5%'))
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('shows an unstable verdict when only degraded models exist', async () => {
    const { container, root } = await renderModelStatus([
      makeItem({
        modelName: 'alpha-fast',
        status: 'degraded',
        successRate: 92,
      }),
      makeItem({ modelName: 'alpha-mini' }),
    ])

    try {
      assert.ok(
        (container.textContent ?? '').includes('Some models are unstable')
      )
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('filters rows by a health status tab', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const allButton = getButton(container, 'All')
      const unstableButton = getButton(container, 'Unstable')
      assert.equal(allButton.getAttribute('aria-pressed'), 'true')
      assert.equal(unstableButton.getAttribute('aria-pressed'), 'false')

      await act(async () => unstableButton.click())

      assert.equal(allButton.getAttribute('aria-pressed'), 'false')
      assert.equal(unstableButton.getAttribute('aria-pressed'), 'true')

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 2)
      assert.ok(rowTexts.some((row) => row.includes('alpha-reasoner')))
      assert.ok(rowTexts.some((row) => row.includes('gamma-lag')))
      assert.equal((container.textContent ?? '').includes('alpha-fast'), false)
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('filters rows by clicking a verdict status tile', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const unavailableTile = getVerdictTiles(container).find((tile) =>
        tile.textContent?.includes('Unavailable')
      )
      assert.ok(unavailableTile)

      await act(async () => unavailableTile.click())

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 1)
      assert.ok(rowTexts[0].includes('beta-offline'))
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
      assert.deepEqual(optionTexts, [
        'All providers',
        'AlphaAI',
        'BetaML',
        'GammaWorks',
      ])

      await act(async () => {
        changeSelectValue(providerSelect, 'beta')
      })

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 1)
      assert.ok(rowTexts[0].includes('beta-offline'))
      const providerGroups = getProviderGroups(container)
      assert.equal(providerGroups.length, 1)
      assert.equal(providerGroups[0].getAttribute('aria-label'), 'BetaML')
      assert.equal((container.textContent ?? '').includes('alpha-fast'), false)
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

      await act(async () => {
        changeInputValue(searchInput, 'AlphaAI')
      })

      // Search matches the provider name too.
      const providerRows = getModelRowTexts(container)
      assert.equal(providerRows.length, 2)
      assert.ok(providerRows.some((row) => row.includes('alpha-fast')))
      assert.ok(providerRows.some((row) => row.includes('alpha-reasoner')))

      await act(async () => {
        changeInputValue(searchInput, 'missing-model')
      })

      assert.equal(getModelRowTexts(container).length, 0)
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('sorts rows by model name in the sort dropdown', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const sortSelect = getSortSelect(container)
      assert.equal(sortSelect.value, 'status')

      await act(async () => {
        changeSelectValue(sortSelect, 'name')
      })

      const rowTexts = getModelRowTexts(container)
      assert.equal(rowTexts.length, 4)
      assert.ok(rowTexts[0].includes('alpha-fast'))
      assert.ok(rowTexts[1].includes('alpha-reasoner'))
      assert.ok(rowTexts[2].includes('beta-offline'))
      assert.ok(rowTexts[3].includes('gamma-lag'))
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('shows a neutral trend state when no model has trend data', async () => {
    const { container, root } = await renderModelStatus([
      makeItem({
        providerId: 'delta',
        provider: 'DeltaAI',
        modelName: 'delta-pending',
        healthScore: Number.NaN,
        fastestTtftMs: Number.NaN,
        slowestTtftMs: Number.NaN,
        successRate: Number.NaN,
        requestCount: 0,
        recentSuccessRates: [],
        status: 'unknown',
      }),
    ])

    try {
      const pageText = container.textContent ?? ''
      assert.ok(pageText.includes('delta-pending'))
      assert.ok(pageText.includes('No data yet'))
      assert.ok(pageText.includes('This model has no data yet'))
      assert.ok(pageText.includes('No data available'))
      assert.equal(pageText.includes('All systems operational'), false)
      assert.ok(pageText.includes('24h trend'))
      assert.equal(container.querySelectorAll('[role="img"]').length, 1)
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('shows the 24h trend column when trend data is present', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const pageText = container.textContent ?? ''
      assert.ok(pageText.includes('24h trend'))
      assert.ok(container.querySelectorAll('[role="img"]').length >= 4)
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('renders one accessible 24h trend per model with the current rate', async () => {
    const { container, root } = await renderModelStatus()

    try {
      const trends = container.querySelectorAll('[role="img"]')
      assert.equal(trends.length, 4)
      const alphaFastRow = [...container.querySelectorAll('article')].find(
        (article) => article.textContent?.includes('alpha-fast')
      )
      assert.ok(alphaFastRow)
      assert.equal(
        alphaFastRow.querySelector('[role="img"]')?.getAttribute('aria-label'),
        '24h trend: 99.5%'
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
      assert.ok(pageText.includes('No matching models'))
      assert.ok(
        pageText.includes('Try a different keyword or clear the filters.')
      )
    } finally {
      await cleanupRendered(root, container)
    }
  })

  test('clears all active filters and restores the default model list', async () => {
    const { container, root } = await renderModelStatus()

    try {
      await act(async () => {
        changeInputValue(getSearchInput(container), 'reasoner')
        changeSelectValue(getProviderSelect(container), 'alpha')
        changeSelectValue(getSortSelect(container), 'name')
        getButton(container, 'Unstable').click()
      })

      assert.equal(getModelRowTexts(container).length, 1)

      await act(async () => getButton(container, 'Clear filters').click())

      assert.equal(getSearchInput(container).value, '')
      assert.equal(getProviderSelect(container).value, 'all')
      assert.equal(getSortSelect(container).value, 'status')
      assert.equal(
        getButton(container, 'All').getAttribute('aria-pressed'),
        'true'
      )
      assert.equal(getModelRowTexts(container).length, 4)
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
