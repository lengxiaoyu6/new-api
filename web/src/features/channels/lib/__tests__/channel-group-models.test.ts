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
import { describe, expect, test } from 'vitest'

import { channelSchema } from '../../types'
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  channelFormSchema,
  transformChannelToFormDefaults,
  transformFormDataToCreatePayload,
  transformFormDataToUpdatePayload,
} from '../channel-form'

describe('channel group models', () => {
  test('existing restrictions survive loading and saving alongside other settings', () => {
    const defaults = transformChannelToFormDefaults(
      channelSchema.parse({
        id: 42,
        key: '',
        status: 1,
        created_time: 0,
        test_time: 0,
        response_time: 0,
        balance_updated_time: 0,
        name: 'Shared upstream',
        type: 1,
        models: 'gpt-4,claude-test',
        group: 'a,b',
        settings: JSON.stringify({
          group_models: { a: ['gpt-4'], b: [] },
          tool_loss_policy: 'strict',
        }),
      })
    )
    expect(defaults.group_models).toEqual({ a: ['gpt-4'], b: [] })
    const result = channelFormSchema.safeParse(defaults)
    expect(result.success).toBe(true)
    const settings = JSON.parse(
      transformFormDataToUpdatePayload(defaults, 42).settings ?? '{}'
    )
    expect(settings).toMatchObject({
      group_models: { a: ['gpt-4'], b: [] },
      tool_loss_policy: 'strict',
    })
  })

  test('saving removes unbound groups and deleted models while preserving explicit empty restrictions', () => {
    const form = {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      name: 'Shared upstream',
      models: 'gpt-4,claude-test',
      group: ['a', 'b', 'c'],
      group_models: {
        a: ['gpt-4', 'gpt-4', 'deleted-model'],
        b: ['deleted-model'],
        removed: ['claude-test'],
      },
    }
    const settings = JSON.parse(
      transformFormDataToCreatePayload(form).channel.settings ?? '{}'
    )
    expect(settings.group_models).toEqual({ a: ['gpt-4'], b: [] })
  })

  test('disabling all restrictions clears the saved setting', () => {
    const form = {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      name: 'Shared upstream',
      models: 'gpt-4',
      settings: '{"group_models":{"default":["gpt-4"]}}',
      group_models: {},
    }
    expect(
      JSON.parse(transformFormDataToUpdatePayload(form, 42).settings ?? '{}')
    ).not.toHaveProperty('group_models')
  })

  test('legacy settings inherit all models and null group lists stay restricted to none', () => {
    const legacy = channelSchema.parse({
      id: 42,
      key: '',
      status: 1,
      created_time: 0,
      test_time: 0,
      response_time: 0,
      balance_updated_time: 0,
      name: 'Legacy',
      type: 1,
      models: 'gpt-4',
      group: 'default',
    })
    expect(transformChannelToFormDefaults(legacy).group_models).toEqual({})
    const restricted = transformChannelToFormDefaults({
      ...legacy,
      settings: '{"group_models":{"default":null}}',
    })
    expect(restricted.group_models).toEqual({ default: [] })
  })
})
