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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PricingSidebar,
  type PricingSidebarProps,
} from '../components/pricing-sidebar'
import { PricingTable } from '../components/pricing-table'
import {
  PricingToolbar,
  type PricingToolbarProps,
} from '../components/pricing-toolbar'
import type { PricingModel } from '../types'

let style: HTMLStyleElement
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  client.setQueryData(['perf-metrics-summary', 24], {
    success: true,
    data: { models: [] },
  })
  style = document.createElement('style')
  style.textContent =
    readFileSync('src/styles/gateway-home.css', 'utf8') +
    readFileSync('src/styles/gateway-catalog.css', 'utf8')
  document.head.append(style)
})

afterEach(() => {
  client.clear()
  style.remove()
  document.documentElement.classList.remove('dark')
})

function toolbarProps(): PricingToolbarProps {
  return {
    searchInput: '',
    onSearchChange: vi.fn(),
    onClearSearch: vi.fn(),
    priceDisplayMode: 'site',
    onPriceDisplayModeChange: vi.fn(),
    groupFilter: 'premium',
    onGroupChange: vi.fn(),
    groups: ['default', 'premium'],
  }
}

function catalogSidebarProps(): PricingSidebarProps {
  return {
    vendorFilter: 'all',
    groupFilter: 'all',
    onVendorChange: vi.fn(),
    onGroupChange: vi.fn(),
    vendors: [],
    groups: ['default', 'premium'],
    groupRatios: { default: 1, premium: 3 },
    models: [],
  }
}

describe('pricing controls', () => {
  it('keeps search and price mode available while catalog filters are loading', () => {
    render(<PricingToolbar {...toolbarProps()} isLoading />)

    expect(screen.getByRole('textbox', { name: 'Search models' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Group' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Site price' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Official price' })).toBeEnabled()
  })

  it('uses the same fixed height for the group selector and price switch', () => {
    render(
      <main className='gateway-home gateway-catalog'>
        <PricingToolbar {...toolbarProps()} />
      </main>
    )

    expect(getComputedStyle(screen.getByRole('combobox')).height).toBe('2.5rem')
    expect(
      getComputedStyle(
        screen.getByRole('group', { name: 'Price display mode' })
      ).height
    ).toBe('2.5rem')
  })

  it('keeps page-size options inside the catalog theme and applies a selected page size', async () => {
    const user = userEvent.setup()
    const models: PricingModel[] = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      model_name: `model-${index + 1}`,
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 1,
      enable_groups: ['default'],
    }))
    render(
      <QueryClientProvider client={client}>
        <main className='gateway-home gateway-catalog'>
          <PricingTable models={models} />
        </main>
      </QueryClientProvider>
    )
    await user.click(screen.getByRole('combobox'))
    const options = await screen.findByRole('listbox')
    expect(screen.getByRole('main')).toContainElement(options)
    await user.click(within(options).getByRole('option', { name: '10' }))
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(
      11
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('10')
  })

  it('shows only the available groups in the mobile selector', async () => {
    const user = userEvent.setup()
    render(
      <main className='gateway-home gateway-catalog'>
        <PricingToolbar
          {...toolbarProps()}
          groups={['default', 'premium', 'az-gpt']}
          groupFilter='az-gpt'
        />
      </main>
    )

    const selector = screen.getByRole('combobox', { name: 'Group' })
    expect(selector).toHaveTextContent('az-gpt')
    await user.click(selector)
    const options = await screen.findByRole('listbox')
    expect(
      within(options)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['az-gpt', 'premium'])
    expect(
      within(options).queryByRole('option', { name: 'default' })
    ).toBeNull()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Filter/ })
    ).not.toBeInTheDocument()
  })

  it.each([
    ['light', false],
    ['dark', false],
    ['light', true],
    ['dark', true],
  ] as const)(
    'keeps group options in the homepage %s theme when rendered inline: %s',
    async (theme, inline) => {
      document.documentElement.classList.toggle('dark', theme === 'dark')
      if (inline) {
        const original = window.matchMedia
        vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
          ...original(query),
          matches: query === '(max-width: 640px)' || original(query).matches,
        }))
      }
      const user = userEvent.setup()
      render(
        <main className='gateway-home gateway-catalog'>
          <PricingToolbar {...toolbarProps()} />
        </main>
      )
      const main = screen.getByRole('main')
      await user.click(screen.getByRole('combobox', { name: 'Group' }))
      const listbox = await screen.findByRole('listbox')
      expect(main.contains(listbox)).toBe(inline)
      for (const token of [
        '--background',
        '--foreground',
        '--card',
        '--primary',
      ]) {
        expect(getComputedStyle(listbox).getPropertyValue(token)).toBe(
          getComputedStyle(main).getPropertyValue(token)
        )
      }
    }
  )

  it('stacks group and vendor options in a single column in the sidebar', () => {
    const model: PricingModel = {
      id: 1,
      model_name: 'vendor-model',
      vendor_name: 'Vendor A',
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 1,
      enable_groups: ['premium'],
    }
    const props = {
      ...catalogSidebarProps(),
      groups: ['premium', 'az-gpt'],
      vendors: [
        { id: 1, name: 'Vendor A' },
        { id: 2, name: 'Vendor B' },
      ],
      models: [model, { ...model, id: 2, vendor_name: 'Vendor B' }],
    }
    render(<PricingSidebar {...props} />)

    for (const name of [/^premium/, /^Vendor A/]) {
      const option = screen.getByRole('button', { name })
      const list = option.parentElement
      assert(list)
      expect(getComputedStyle(list).display).toBe('grid')
      expect(getComputedStyle(list).gridTemplateColumns).toBe('minmax(0, 1fr)')
    }
  })

  it('shows only groups and vendors without the filter summary or reset in the sidebar', () => {
    const props = {
      ...catalogSidebarProps(),
      groupFilter: 'premium',
    }
    render(<PricingSidebar {...props} />)

    const filters = within(screen.getByRole('complementary'))
    expect(
      filters
        .getAllByRole('button', { expanded: true })
        .map((button) => button.textContent)
    ).toEqual(['Groups', 'All Vendors'])
    expect(filters.queryByRole('heading', { name: 'Filter' })).toBeNull()
    expect(
      filters.queryByText('Refine models by provider, group, type, and tags.')
    ).toBeNull()
    expect(filters.queryByText('Filters active')).toBeNull()
    expect(filters.queryByRole('button', { name: 'Reset' })).toBeNull()
  })

  it('hides all and default groups and sorts the remaining groups alphabetically in the sidebar', () => {
    const props = {
      ...catalogSidebarProps(),
      groups: [
        'GLM',
        'codex-pro-10',
        'default',
        'az-gpt',
        'codex-pro-2',
        'deepseek',
        'gemini-ultra',
      ],
      groupRatios: { GLM: 0.5, 'az-gpt': 0.6 },
    }
    render(<PricingSidebar {...props} />)

    const trigger = screen.getByRole('button', { name: 'Groups' })
    const panel = document.querySelector<HTMLElement>(
      `[id="${trigger.getAttribute('aria-controls')}"]`
    )
    assert(panel)
    const groups = within(panel)
    expect(groups.queryByRole('button', { name: 'All Groups' })).toBeNull()
    expect(groups.queryByRole('button', { name: /^default\b/ })).toBeNull()
    expect(groups.getAllByRole('button').map((button) => button.title)).toEqual(
      [
        'az-gpt',
        'codex-pro-2',
        'codex-pro-10',
        'deepseek',
        'gemini-ultra',
        'GLM',
      ]
    )
    expect(groups.getByRole('button', { name: /^GLM\s*x0\.5$/ })).toBeVisible()
  })

  it('omits the group section when default is the only available group', () => {
    render(<PricingSidebar {...catalogSidebarProps()} groups={['default']} />)

    expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'All Groups' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^default\b/ })).toBeNull()
    expect(
      screen.getByRole('button', { name: /^All Vendors\s*0$/ })
    ).toBeVisible()
  })

  it('counts models per vendor and updates counts when the catalog changes', () => {
    const props = catalogSidebarProps()
    const base: PricingModel = {
      id: 1,
      model_name: 'text-model',
      vendor_name: 'Vendor A',
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 1,
      enable_groups: ['default'],
    }
    const models: PricingModel[] = [
      base,
      {
        ...base,
        id: 2,
        model_name: 'image-model',
      },
      {
        ...base,
        id: 3,
        model_name: 'task-model',
        vendor_name: 'Vendor B',
      },
    ]
    const sidebarProps = {
      ...props,
      vendors: [
        { id: 1, name: 'Vendor A' },
        { id: 2, name: 'Vendor B' },
      ],
    }
    const { rerender } = render(
      <PricingSidebar {...sidebarProps} models={models} />
    )

    expect(
      screen.getByRole('button', { name: /^All Vendors\s*3$/ })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /^Vendor A\s*2$/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Vendor B\s*1$/ })).toBeVisible()

    rerender(<PricingSidebar {...sidebarProps} models={[models[1]]} />)
    expect(
      screen.getByRole('button', { name: /^All Vendors\s*1$/ })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /^Vendor A\s*1$/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Vendor B\s*1$/ })).toBeNull()
  })

  it('selects a group from the mobile selector', async () => {
    const props = toolbarProps()
    const user = userEvent.setup()
    const { rerender } = render(
      <PricingToolbar
        {...props}
        groups={['default', 'premium', 'az-gpt']}
        groupFilter='premium'
      />
    )
    const selector = screen.getByRole('combobox', { name: 'Group' })
    expect(selector).toHaveTextContent('premium')
    selector.focus()
    await user.keyboard('{Enter}')
    const options = await screen.findByRole('listbox')
    expect(
      within(options).getByRole('option', { name: 'premium' })
    ).toHaveAttribute('aria-selected', 'true')
    await user.click(within(options).getByRole('option', { name: 'az-gpt' }))
    expect(props.onGroupChange).toHaveBeenCalledWith('az-gpt')
    rerender(
      <PricingToolbar
        {...props}
        groups={['default', 'premium', 'az-gpt']}
        groupFilter='az-gpt'
      />
    )
    expect(selector).toHaveTextContent('az-gpt')
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(selector).toHaveAttribute('aria-expanded', 'false')
      expect(selector).toHaveFocus()
    })
  })

  it.each([{ groups: [] }, { groups: ['default'] }])(
    'omits the mobile group selector when $groups contains no public groups',
    (testCase) => {
      render(<PricingToolbar {...toolbarProps()} groups={testCase.groups} />)

      expect(screen.queryByRole('combobox', { name: 'Group' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Site price' })).toBeEnabled()
    }
  )

  it.each(['all', 'missing'])(
    'shows a placeholder instead of a different group when the selected group is %s',
    (groupFilter) => {
      render(<PricingToolbar {...toolbarProps()} groupFilter={groupFilter} />)

      expect(screen.getByRole('combobox', { name: 'Group' })).toHaveTextContent(
        'Group'
      )
    }
  )
})
