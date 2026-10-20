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
  createMemoryHistory,
  createRootRoute,
  createRoute,
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
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { PricingData } from '@/features/pricing/types'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY, type StatusData } from '@/lib/status-query'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { GatewayLanding } from '../components/gateway-landing'

const catalog: PricingData = {
  success: true,
  data: [
    {
      id: 1,
      model_name: 'gpt-example',
      vendor_id: 1,
      quota_type: 0,
      model_ratio: 1.25,
      completion_ratio: 4,
      enable_groups: ['default', 'discount'],
      capabilities: ['streaming', 'vision'],
    },
    {
      id: 2,
      model_name: 'claude-example',
      vendor_id: 2,
      quota_type: 0,
      model_ratio: 99,
      completion_ratio: 99,
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("base", p * 3 + c * 15)',
      channel_pricing: [
        {
          profile_key: 'model',
          source: 'model',
          channel_count: 1,
          groups: ['default'],
          billing_mode: 'tiered_expr',
          billing_expr: 'tier("base", p * 3 + c * 15)',
          expr_hash: 'flat',
        },
      ],
      enable_groups: ['default'],
      capabilities: ['reasoning', 'function_calling'],
    },
    {
      id: 3,
      model_name: 'free-example',
      vendor_id: 1,
      quota_type: 0,
      model_ratio: 0,
      completion_ratio: 1,
      enable_groups: ['default'],
    },
    {
      id: 4,
      model_name: 'image-example',
      vendor_id: 2,
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.04,
      completion_ratio: 0,
      enable_groups: ['default'],
    },
    {
      id: 5,
      model_name: 'tiered-example',
      vendor_id: 2,
      quota_type: 0,
      model_ratio: 99,
      completion_ratio: 99,
      billing_mode: 'tiered_expr',
      billing_expr:
        'len <= 200000 ? tier("standard", p * 3 + c * 15) : tier("long", p * 6 + c * 30)',
      enable_groups: ['default'],
    },
  ],
  vendors: [
    { id: 1, name: 'OpenAI' },
    { id: 2, name: 'Anthropic' },
  ],
  group_ratio: { default: 1, discount: 0.5 },
  usable_group: {},
  supported_endpoint: {},
  auto_groups: [],
}

const initialConfig = useSystemConfigStore.getState()
const clients: QueryClient[] = []

beforeEach(() => {
  localStorage.clear()
  useSystemConfigStore.getState().setConfig({
    systemName: 'Example Gateway',
    logo: '',
    currency: { ...DEFAULT_CURRENCY_CONFIG },
  })
})

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  useSystemConfigStore.setState(initialConfig)
  localStorage.clear()
})

async function renderLanding(
  options: {
    isAuthenticated?: boolean
    status?: StatusData
    pricing?: PricingData | null
  } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  })
  clients.push(client)
  client.setQueryData(
    STATUS_QUERY_KEY,
    options.status ?? {
      docs_link: 'https://docs.example.com/start',
      server_address: 'https://api.example.com/gateway/v1/',
    }
  )
  if (options.pricing !== null) {
    client.setQueryData(['pricing'], options.pricing ?? catalog)
  }
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en, zh },
  })
  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <div className='gateway-home'>
        <GatewayLanding isAuthenticated={options.isAuthenticated ?? false} />
      </div>
    ),
  })
  const pricing = createRoute({
    getParentRoute: () => root,
    path: '/pricing',
    validateSearch: (search) => ({
      vendor: typeof search.vendor === 'string' ? search.vendor : undefined,
    }),
    component: () => <h1>Model catalog</h1>,
  })
  const router = createRouter({
    routeTree: root.addChildren([home, pricing]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByRole('main')
  return { i18n, router, client }
}

it('shows configured branding and account actions without a starting price or documentation link in the hero', async () => {
  await renderLanding()

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Example Gateway'
  )
  for (const link of screen.getAllByRole('link', { name: 'Get Started' })) {
    expect(link).toHaveAttribute('href', '/sign-up')
  }
  for (const link of screen.getAllByRole('link', { name: 'View Pricing' })) {
    expect(link).toHaveAttribute('href', '/pricing')
  }
  const hero = screen.getByRole('region', {
    name: /Example Gateway\s*Every model\. One API\./,
  })
  expect(
    within(hero).queryByRole('link', { name: 'Docs' })
  ).not.toBeInTheDocument()
  expect(within(hero).queryByText('Input from')).not.toBeInTheDocument()
  expect(within(hero).queryByText('/ 1M tokens')).not.toBeInTheDocument()
  expect(
    within(hero).getByRole('link', { name: 'Explore models' })
  ).toHaveAttribute('href', '/pricing')
})

it('omits the homepage model price cards while retaining the ticker and onboarding section', async () => {
  await renderLanding()

  expect(
    screen.queryByRole('region', { name: 'Live model prices' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'gpt-example' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Model ticker' })).toBeVisible()
  expect(
    screen.getByRole('heading', { name: 'From account to first request.' })
  ).toBeVisible()
})

it('shows the dashboard action when an account is signed in', async () => {
  await renderLanding({ isAuthenticated: true })

  for (const link of screen.getAllByRole('link', { name: 'Go to Dashboard' })) {
    expect(link).toHaveAttribute('href', '/dashboard')
  }
  expect(
    screen.queryByRole('link', { name: 'Get Started' })
  ).not.toBeInTheDocument()
})

it.each([false, true])(
  'omits the subscription promotion and closing card when isAuthenticated is %s',
  async (isAuthenticated) => {
    await renderLanding({ isAuthenticated })

    expect(
      screen.queryByText('Explore subscription options in the console.')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Subscription Plans' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        name: 'The next idea starts with one request.',
      })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'From account to first request.' })
    ).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'Before the first request.' })
    ).toBeVisible()
    expect(
      screen.getAllByRole('link', {
        name: isAuthenticated ? 'Go to Dashboard' : 'Get Started',
      })
    ).toHaveLength(2)
  }
)

it('switches request formats with pointer and keyboard input and copies the selected example', async () => {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, 'writeText')
  await renderLanding()

  await user.click(screen.getByRole('tab', { name: 'Claude' }))
  expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByRole('tabpanel', { name: 'Claude' })).toHaveTextContent(
    'anthropic-version: 2023-06-01'
  )

  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Gemini' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('tab', { name: 'Gemini' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const panel = screen.getByRole('tabpanel', { name: 'Gemini' })
  expect(panel).toHaveTextContent(
    'https://api.example.com/gateway/v1beta/models/YOUR_MODEL:generateContent'
  )
  expect(panel).toHaveTextContent('x-goog-api-key: $NEW_API_KEY')
  expect(panel).not.toHaveTextContent('anthropic-version')
  const request = panel.querySelector('pre')?.textContent
  expect(request).toContain('"contents"')

  await user.click(
    within(panel).getByRole('button', { name: 'Copy request example' })
  )
  expect(writeText).toHaveBeenCalledWith(request)
  expect(
    await within(panel).findByRole('button', { name: 'Copied' })
  ).toBeVisible()
})

it('uses the current origin for request examples when the configured server address is empty', async () => {
  await renderLanding({ status: { docs_link: '', server_address: ' ' } })

  expect(screen.getByRole('tabpanel', { name: 'OpenAI' })).toHaveTextContent(
    `${window.location.origin}/v1/chat/completions`
  )
})

it('preserves a configured gateway prefix in request examples', async () => {
  await renderLanding({
    status: {
      server_address: 'https://api.example.com/proxy/',
      docs_link: '/about',
    },
  })

  expect(screen.getByRole('tabpanel', { name: 'OpenAI' })).toHaveTextContent(
    'https://api.example.com/proxy/v1/chat/completions'
  )
})

it('expands and collapses a FAQ answer with the keyboard while updating its accessible state', async () => {
  const user = userEvent.setup()
  await renderLanding()
  const question = screen.getByRole('button', {
    name: 'Which models can be used?',
  })
  const answer =
    'The model catalog lists the models and prices configured for this site. Availability can vary by account group.'

  expect(question).toHaveAttribute('aria-expanded', 'false')
  question.focus()
  await user.keyboard('{Enter}')
  expect(question).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(answer)).toBeVisible()

  await user.keyboard('{Enter}')
  expect(question).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(answer)).not.toBeInTheDocument()
})

it('updates text after a language change and keeps the selected API format', async () => {
  const user = userEvent.setup()
  const { i18n } = await renderLanding()
  await user.click(screen.getByRole('tab', { name: 'Responses' }))

  await act(async () => {
    await i18n.changeLanguage('zh')
  })

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    zh.translation['Every model. One API.']
  )
  expect(screen.getByRole('tab', { name: 'Responses' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(
    screen.getByRole('button', { name: zh.translation['Copy request example'] })
  ).toBeVisible()
  expect(
    screen.getByRole('tablist', {
      name: zh.translation['API request examples'],
    })
  ).toBeVisible()
  expect(
    screen.getByRole('region', { name: zh.translation['Model ticker'] })
  ).toBeVisible()
  expect(
    screen.getByRole('button', {
      name: zh.translation['Pause model ticker'],
    })
  ).toBeVisible()
})

it('clips hero decoration without creating a scroll container that can shift content on keyboard focus', async () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/styles/gateway-home.css', 'utf8')
  document.head.append(style)

  try {
    await renderLanding()
    const hero = screen.getByRole('region', {
      name: 'Example Gateway Every model. One API.',
    })
    expect(getComputedStyle(hero).overflow).toBe('clip')
  } finally {
    style.remove()
  }
})

it('shows only the site hub and configured providers in the hero diagram', async () => {
  await renderLanding()
  const network = screen.getByRole('region', { name: 'Model network' })
  expect(within(network).getByRole('link', { name: 'OpenAI' })).toHaveAttribute(
    'href',
    '/pricing?vendor=OpenAI'
  )
  expect(
    within(network).getByRole('link', { name: 'Anthropic' })
  ).toHaveAttribute('href', '/pricing?vendor=Anthropic')
  expect(within(network).getByText('Example Gateway')).toBeVisible()
  expect(within(network).queryByRole('button')).not.toBeInTheDocument()
  expect(within(network).queryByText('gpt-example')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('group', { name: 'Vendors' })
  ).not.toBeInTheDocument()
})

it.each(['pointer', 'keyboard'])(
  'opens the corresponding vendor in the model catalog from the diagram with %s input',
  async (input) => {
    const user = userEvent.setup()
    const { router } = await renderLanding()
    const network = screen.getByRole('region', { name: 'Model network' })
    const provider = within(network).getByRole('link', { name: 'Anthropic' })
    if (input === 'keyboard') {
      provider.focus()
      await user.keyboard('{Enter}')
    } else {
      await user.click(provider)
    }

    await screen.findByRole('heading', { name: 'Model catalog' })
    expect(router.state.location.pathname).toBe('/pricing')
    expect(router.state.location.search).toEqual({ vendor: 'Anthropic' })
  }
)

it('shows only the configured provider when the catalog contains a single provider', async () => {
  await renderLanding({ pricing: { ...catalog, data: [catalog.data[2]] } })
  const network = screen.getByRole('region', { name: 'Model network' })
  expect(within(network).getByRole('link', { name: 'OpenAI' })).toBeVisible()
  expect(
    within(network).queryByRole('link', { name: 'Anthropic' })
  ).not.toBeInTheDocument()
  expect(within(network).getAllByRole('link')).toHaveLength(1)
})

it('reserves extra diagram height when eight configured providers need space around the hub', async () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/styles/gateway-home.css', 'utf8')
  document.head.append(style)
  try {
    const vendors = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      name: `Provider ${index + 1}`,
    }))
    await renderLanding({
      pricing: {
        ...catalog,
        vendors,
        data: vendors.map((vendor) => ({
          ...catalog.data[0],
          id: vendor.id,
          vendor_id: vendor.id,
          model_name: `model-${vendor.id}`,
        })),
      },
    })
    const network = screen.getByRole('region', { name: 'Model network' })
    expect(within(network).getAllByRole('link')).toHaveLength(8)
    const map = network.querySelector('.gateway-network-map')
    if (!map) throw new Error('The provider diagram is missing')
    expect(getComputedStyle(map).minHeight).toBe('280px')
  } finally {
    style.remove()
  }
})

it('shows model icons and names for every billing type without prices or token units in the ticker', async () => {
  await renderLanding()
  const ticker = screen.getByRole('region', { name: 'Model ticker' })
  const items = within(ticker).getAllByRole('listitem')

  const names = [
    'gpt-example',
    'claude-example',
    'free-example',
    'image-example',
    'tiered-example',
  ]
  expect(items).toHaveLength(names.length)
  for (const [index, name] of names.entries()) {
    expect(within(items[index]).getByText(name, { exact: true })).toBeVisible()
    expect(
      items[index].querySelector('[aria-hidden="true"]')
    ).not.toBeEmptyDOMElement()
  }
  expect(ticker).not.toHaveTextContent('$')
  expect(ticker).not.toHaveTextContent('1M')
  expect(ticker).not.toHaveTextContent('Input')
})

it('retains the full accessible provider name when its visible diagram label is shortened', async () => {
  const providerName = `Example ${'long-provider-name-'.repeat(15)}`
  await renderLanding({
    pricing: {
      ...catalog,
      data: [catalog.data[0]],
      vendors: [{ id: 1, name: providerName }],
    },
  })
  const network = screen.getByRole('region', { name: 'Model network' })
  expect(
    within(network).getByRole('link', { name: providerName })
  ).toHaveAccessibleName(providerName)
})

it('allows the model strip to shrink while reserving space for its pause control', async () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/styles/gateway-home.css', 'utf8')
  document.head.append(style)
  try {
    await renderLanding()
    const ticker = screen.getByRole('region', { name: 'Model ticker' })
    const strip = ticker.querySelector('.gateway-ticker-window')
    if (!strip) throw new Error('The model strip is missing')
    expect(getComputedStyle(strip).minWidth).toBe('0px')
    expect(getComputedStyle(strip).flexGrow).toBe('1')
    expect(
      getComputedStyle(
        within(ticker).getByRole('button', { name: 'Pause model ticker' })
      ).flexShrink
    ).toBe('0')
  } finally {
    style.remove()
  }
})

it('pauses and resumes the model ticker with an accessible control', async () => {
  const user = userEvent.setup()
  await renderLanding()
  await user.click(screen.getByRole('button', { name: 'Pause model ticker' }))
  expect(
    screen.getByRole('button', { name: 'Resume model ticker' })
  ).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'Resume model ticker' }))
  expect(
    screen.getByRole('button', { name: 'Pause model ticker' })
  ).toHaveAttribute('aria-pressed', 'false')
})

it('keeps the homepage actions available without provider links or a model ticker when the catalog is empty', async () => {
  await renderLanding({ pricing: { ...catalog, data: [], vendors: [] } })
  const network = screen.getByRole('region', { name: 'Model network' })
  expect(within(network).queryByRole('link')).not.toBeInTheDocument()
  expect(
    within(network).queryByRole('list', { name: 'Featured models' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Explore models' })).toHaveAttribute(
    'href',
    '/pricing'
  )
  expect(
    screen.queryByLabelText('Input estimated cost')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Model ticker' })
  ).not.toBeInTheDocument()
})

it('shows provider links and the model ticker only after the catalog data arrives', async () => {
  let complete: (value: { data: PricingData }) => void = () => {}
  const request = new Promise<{ data: PricingData }>((resolve) => {
    complete = resolve
  })
  vi.spyOn(api, 'get').mockReturnValue(request)
  await renderLanding({ pricing: null })
  const network = screen.getByRole('region', { name: 'Model network' })
  expect(within(network).queryByRole('link')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Model ticker' })
  ).not.toBeInTheDocument()
  await act(async () => {
    complete({ data: catalog })
  })
  expect(
    await within(network).findByRole('link', { name: 'OpenAI' })
  ).toHaveAttribute('href', '/pricing?vendor=OpenAI')
  expect(screen.getByRole('region', { name: 'Model ticker' })).toBeVisible()
})

it('keeps homepage navigation available when loading the catalog fails', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Offline'))
  const { client } = await renderLanding({ pricing: null })

  await waitFor(() =>
    expect(client.getQueryState(['pricing'])?.status).toBe('error')
  )
  expect(
    within(screen.getByRole('region', { name: 'Model network' })).queryByRole(
      'link'
    )
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Model ticker' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Explore models' })).toHaveAttribute(
    'href',
    '/pricing'
  )
})

it.each([
  { enabled: true, requireAuth: true },
  { enabled: false, requireAuth: false },
])(
  'keeps cached pricing private and avoids fetching when catalog access is restricted: %j',
  async (pricingAccess) => {
    const get = vi.spyOn(api, 'get')
    await renderLanding({
      status: {
        HeaderNavModules: JSON.stringify({ pricing: pricingAccess }),
      },
    })
    expect(
      within(screen.getByRole('region', { name: 'Model network' })).queryByRole(
        'link'
      )
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Model ticker' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-example')).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
  }
)

it('preserves vendor destinations and translates the diagram label when the language changes', async () => {
  const { i18n } = await renderLanding()
  const network = screen.getByRole('region', { name: 'Model network' })
  await act(async () => {
    await i18n.changeLanguage('zh')
  })
  expect(
    within(network).getByRole('link', { name: 'Anthropic' })
  ).toHaveAttribute('href', '/pricing?vendor=Anthropic')
  expect(network).toHaveAccessibleName(zh.translation['Model network'])
})
