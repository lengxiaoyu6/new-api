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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'

import { ChannelGroupModels } from '../channel-group-models'

function Fixture(props: {
  value?: Record<string, string[]>
  models?: string[]
}) {
  const [value, setValue] = useState(props.value ?? {})
  return (
    <>
      <ChannelGroupModels
        groups={['a', 'b']}
        models={props.models ?? ['gpt-4', 'claude-test']}
        value={value}
        onChange={setValue}
      />
      <output aria-label='Restrictions'>{JSON.stringify(value)}</output>
    </>
  )
}

test('keyboard toggling starts with no models and disabling restores unrestricted access', async () => {
  const user = userEvent.setup()
  render(<Fixture />)
  const control = screen.getByRole('switch', { name: 'Limit models for a' })
  control.focus()
  await user.keyboard(' ')
  expect(control).toBeChecked()
  const group = screen.getByRole('group', { name: 'Models for a' })
  expect(
    within(group).getByText(
      'No models selected. This channel will not serve this group.'
    )
  ).toBeVisible()
  expect(screen.getByLabelText('Restrictions')).toHaveTextContent('{"a":[]}')
  await user.keyboard(' ')
  expect(control).not.toBeChecked()
  expect(within(group).getByText('All channel models')).toBeVisible()
  expect(screen.getByLabelText('Restrictions')).toHaveTextContent('{}')
})

test('an empty channel model list keeps an explicit restriction empty', () => {
  render(<Fixture value={{ a: ['deleted-model'] }} models={[]} />)
  const group = screen.getByRole('group', { name: 'Models for a' })
  expect(within(group).getByText('No matching items')).toBeVisible()
  expect(
    within(group).getByText(
      'No models selected. This channel will not serve this group.'
    )
  ).toBeVisible()
  expect(
    screen.getByRole('switch', { name: 'Limit models for a' })
  ).toBeChecked()
})

test('locked settings disable both restriction switches and model selection', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <ChannelGroupModels
      groups={['a']}
      models={['gpt-4']}
      value={{ a: [] }}
      onChange={onChange}
      disabled
    />
  )
  const control = screen.getByRole('switch', { name: 'Limit models for a' })
  const checkbox = screen.getByRole('checkbox', {
    name: 'Select all models in OpenAI',
  })
  expect(control).toHaveAttribute('aria-disabled', 'true')
  expect(checkbox).toHaveAttribute('aria-disabled', 'true')
  await user.click(control)
  await user.click(checkbox)
  expect(onChange).not.toHaveBeenCalled()
})
