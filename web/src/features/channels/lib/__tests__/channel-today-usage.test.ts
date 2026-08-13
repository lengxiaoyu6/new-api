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
import { describe, test } from 'node:test'

import type { Channel } from '../../types'
import { resolveChannelTodayUsage, type TagRow } from '../channel-utils'

function channel(id: number): Channel {
  return { id } as Channel
}

describe('channel today usage resolution', () => {
  test('returns the quota mapped to the channel id', () => {
    assert.equal(
      resolveChannelTodayUsage(channel(7), { '7': 123, '8': 456 }),
      123
    )
  })

  test('returns zero when the channel has no usage entry', () => {
    assert.equal(resolveChannelTodayUsage(channel(7), { '8': 456 }), 0)
  })

  test('returns zero when the usage map is missing', () => {
    assert.equal(resolveChannelTodayUsage(channel(7), undefined), 0)
  })

  test('sums the children usage for tag aggregate rows', () => {
    const tagRow = {
      id: 1 as unknown as number,
      tag: 'gpu',
      children: [channel(11), channel(12), channel(13)],
    } as TagRow

    assert.equal(
      resolveChannelTodayUsage(tagRow, { '11': 10, '12': 25, '13': 5 }),
      40
    )
  })

  test('treats missing children entries as zero when summing a tag row', () => {
    const tagRow = {
      id: 1 as unknown as number,
      tag: 'gpu',
      children: [channel(11), channel(12)],
    } as TagRow

    assert.equal(resolveChannelTodayUsage(tagRow, { '11': 10 }), 10)
  })

  test('returns zero for an empty tag row with no usage data', () => {
    const tagRow = {
      id: 1 as unknown as number,
      tag: 'gpu',
      children: [] as Channel[],
    } as TagRow

    assert.equal(resolveChannelTodayUsage(tagRow, undefined), 0)
  })
})
