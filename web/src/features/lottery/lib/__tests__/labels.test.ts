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
import { describe, expect, it } from 'vitest'

import { getLotteryWheelLabel } from '../wheel'

const PRIZE_COUNTS = [3, 4, 5, 6, 8, 10]
/** Matches the disc in the component: it insets the wheel by 4% and clips 5px of border. */
const DISC_RADIUS = 45.5
const LABEL_HEIGHT = 7

/** Angle on screen of a point expressed as a percentage of the wheel diameter. */
function screenAngle(x: number, y: number): number {
  return ((Math.atan2(x - 50, 50 - y) * 180) / Math.PI + 360) % 360
}

/** Keeps a rotation in (-180, 180] so upright-ness can be asserted directly. */
function normalizeDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180
}

function cornerPoints(label: ReturnType<typeof getLotteryWheelLabel>) {
  const radians = ((label.rotation - 90) * Math.PI) / 180
  const halfWidth = label.width / 2
  const halfHeight = LABEL_HEIGHT / 2
  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [-halfWidth, halfHeight],
    [halfWidth, halfHeight],
  ].map(([cornerX, cornerY]) => [
    label.x + cornerX * Math.cos(radians) - cornerY * Math.sin(radians),
    label.y + cornerX * Math.sin(radians) + cornerY * Math.cos(radians),
  ])
}

describe('getLotteryWheelLabel', () => {
  it.each(PRIZE_COUNTS)(
    'centres every label inside the wedge painted for its own prize when there are %i prizes',
    (prizeCount) => {
      const segmentAngle = 360 / prizeCount

      for (let index = 0; index < prizeCount; index += 1) {
        const label = getLotteryWheelLabel(index, prizeCount)
        const start = index * segmentAngle

        expect(label.angle).toBeCloseTo(start + segmentAngle / 2)
        expect(screenAngle(label.x, label.y)).toBeGreaterThanOrEqual(start)
        expect(screenAngle(label.x, label.y)).toBeLessThanOrEqual(
          start + segmentAngle
        )
      }
    }
  )

  it.each(PRIZE_COUNTS)(
    'keeps every label box inside the clipped disc when there are %i prizes',
    (prizeCount) => {
      for (let index = 0; index < prizeCount; index += 1) {
        const label = getLotteryWheelLabel(index, prizeCount)

        for (const [x, y] of cornerPoints(label)) {
          expect(Math.hypot(x - 50, y - 50)).toBeLessThanOrEqual(DISC_RADIUS)
        }
      }
    }
  )

  it.each(PRIZE_COUNTS)(
    'turns every label radially without letting a prize name hang upside down when there are %i prizes',
    (prizeCount) => {
      for (let index = 0; index < prizeCount; index += 1) {
        const label = getLotteryWheelLabel(index, prizeCount)
        const textDirection = screenAngle(label.x, label.y)

        // The box's width axis follows the radius: either pointing at the rim or, for the
        // lower half, at the hub. Nothing sits at a tangent.
        const offset = normalizeDegrees(label.rotation - textDirection)
        expect(Math.abs(Math.abs(offset) - 90)).toBeLessThan(1e-6)
        // Upright: a rotation past vertical is what mirrors the text.
        expect(Math.abs(normalizeDegrees(label.rotation))).toBeLessThanOrEqual(
          90
        )
      }
    }
  )

  it('gives a narrow prize only as much width as its wedge can hold', () => {
    // Ten prizes leave a slim wedge, so the width must be driven by the wedge angle
    // rather than the flat maximum used for wide wheels.
    expect(getLotteryWheelLabel(0, 10).width).toBeLessThan(
      getLotteryWheelLabel(0, 3).width
    )
    expect(getLotteryWheelLabel(0, 10).width).toBeGreaterThan(0)
  })

  it('keeps the label box wide enough for a short prize name', () => {
    // The box is a percentage of the wheel; at the 34rem maximum this is the pixel width.
    const wheelWidth = 544

    for (const prizeCount of PRIZE_COUNTS) {
      expect(
        (getLotteryWheelLabel(0, prizeCount).width / 100) * wheelWidth
      ).toBeGreaterThan(96)
    }
  })

  it('centres the first prize in the upper right instead of a quarter turn away', () => {
    // Regression: label angles used to start from a canvas-style -90 degrees, which put
    // every name 90 degrees counter-clockwise from its wedge — the first prize name was
    // pushed out of the disc and onto a neighbouring slice.
    const label = getLotteryWheelLabel(0, 5)

    expect(label.angle).toBe(36)
    expect(label.x).toBeGreaterThan(50)
    expect(label.y).toBeLessThan(50)
  })
})
