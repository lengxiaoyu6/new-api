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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'

import { GatewayTicker } from '../components/gateway-ticker'

const models = [
  { model_name: 'gpt-4o', icon: 'OpenAI' },
  { model_name: 'claude-sonnet', icon: 'Anthropic' },
  { model_name: 'gemini-flash', icon: 'Gemini' },
]

afterEach(() => {
  cleanup()
})

it.each([
  { name: 'multiple models', items: models },
  { name: 'one model', items: models.slice(0, 1) },
])(
  'keeps the pause control available for a short list with $name',
  ({ items }) => {
    render(<GatewayTicker models={items} />)

    expect(
      screen.getByRole('button', { name: 'Pause model ticker' })
    ).toBeVisible()
  }
)

it('renders each full model name once even when repeated entries have different icons', () => {
  render(
    <GatewayTicker
      models={[
        models[0],
        { ...models[0], icon: 'CustomIcon' },
        models[1],
        models[0],
        models[2],
      ]}
    />
  )

  for (const model of models) {
    expect(screen.getAllByText(model.model_name, { exact: true })).toHaveLength(
      1
    )
  }
})

it('keeps all unique model names when the catalog has more than twelve models', () => {
  const catalog = Array.from({ length: 16 }, (_, index) => ({
    model_name: `model-${index}`,
  }))
  render(<GatewayTicker models={[...catalog, catalog[0], catalog[15]]} />)

  expect(
    screen.getAllByRole('listitem').map((item) => item.textContent)
  ).toEqual(catalog.map((model) => expect.stringContaining(model.model_name)))
})

it('pauses and resumes a short model list through the accessible control', async () => {
  const user = userEvent.setup()
  render(<GatewayTicker models={models} />)

  await user.click(screen.getByRole('button', { name: 'Pause model ticker' }))
  expect(
    screen.getByRole('button', { name: 'Resume model ticker' })
  ).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'Resume model ticker' }))
  expect(
    screen.getByRole('button', { name: 'Pause model ticker' })
  ).toHaveAttribute('aria-pressed', 'false')
})
