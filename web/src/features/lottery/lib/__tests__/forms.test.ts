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

import { lotteryVersionFormToPayload } from '../forms'

describe('lottery configuration payload', () => {
  test('keeps business dates server-owned', () => {
    const payload = lotteryVersionFormToPayload(
      {
        thresholdAmount: 10,
        title: 'Evening draw',
        ruleText: 'Spend and draw.',
        prizes: [
          {
            code: 'balance-2',
            type: 'balance',
            balanceAmount: 2,
            totalStock: 10,
            dailyLimit: 0,
            probability: 20,
            title: '2 balance',
            description: '',
          },
          {
            code: 'thanks',
            type: 'thanks',
            balanceAmount: 0,
            totalStock: 0,
            dailyLimit: 0,
            probability: 80,
            title: 'Thanks',
            description: '',
          },
        ],
      },
      'en'
    )

    expect(payload).not.toHaveProperty('business_date')
    expect(payload.prizes.map((prize) => prize.weight)).toEqual([
      200_000, 800_000,
    ])
  })
})
