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
const WHEEL_SPIN_TURNS = 5

const LABEL_CENTER_RADIUS = 32
const LABEL_MAX_WIDTH = 28
/**
 * The label box is centred on its segment midline and rotated so the text runs radially
 * outward. Two widths must hold at once, both as percentages of the wheel diameter:
 *
 * - the wedge: the chord at this radius is `2 * r * sin(segmentAngle / 2)`, and a box wider
 *   than that paints over a neighbouring prize;
 * - the disc: the clipped disc ends at 45.5%, and the box's outer edge sits at
 *   `r + width / 2`, so it may not reach past the rim.
 *
 * The height is not constrained here because it is tangential, and a two-line label is
 * only about 7% of the diameter tall.
 */
const LABEL_DISC_RADIUS = 45.5
const LABEL_WIDTH_MARGIN = 0.94
/** A two-line label at `text-sm`/`leading-tight` is about 7% of the wheel diameter tall. */
const LABEL_HEIGHT = 7

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360
}

/** Rotation equivalent in (-180, 180], so an angle can be checked for uprightness. */
function uprightDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180
}

export type LotteryWheelLabel = {
  /** Angle from 12 o'clock, clockwise — the convention of `conic-gradient` and `rotate()`. */
  angle: number
  x: number
  y: number
  rotation: number
  width: number
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Places the label of one segment. `angle` is the segment centre measured from
 * 12 o'clock, matching the `conic-gradient` stops that paint the wheel, so a label and
 * its wedge always share one coordinate system. `x`/`y` are percentages of the wheel
 * diameter; `width` is the widest box that stays inside both the wedge and the clipped disc.
 */
export function getLotteryWheelLabel(
  index: number,
  prizeCount: number
): LotteryWheelLabel {
  const segmentAngle = 360 / prizeCount
  const angle = normalizedDegrees((index + 0.5) * segmentAngle)
  const radians = toRadians(angle)
  const width = Math.min(
    // The chord across the wedge at this radius.
    2 *
      LABEL_CENTER_RADIUS *
      Math.sin(toRadians(segmentAngle) / 2) *
      LABEL_WIDTH_MARGIN,
    LABEL_MAX_WIDTH,
    // Upstream of the rim, leaving the box's inner edge outside the centre button.
    2 *
      (Math.sqrt(
        Math.max(0, LABEL_DISC_RADIUS ** 2 - (LABEL_HEIGHT / 2) ** 2)
      ) -
        LABEL_CENTER_RADIUS)
  )
  // A radial baseline is `angle - 90`. Half the wedges would stand their prize name on its
  // head at that angle, so those read hub-ward instead: an upright label always beats one
  // that faces the rim.
  const radial = angle - 90
  const rotation = uprightDegrees(
    Math.abs(uprightDegrees(radial)) <= 90 ? radial : radial + 180
  )

  return {
    angle,
    x: 50 + LABEL_CENTER_RADIUS * Math.sin(radians),
    y: 50 - LABEL_CENTER_RADIUS * Math.cos(radians),
    rotation,
    width,
  }
}

export function getLotteryWheelRotation(
  currentRotation: number,
  prizeIndex: number,
  prizeCount: number
): number {
  if (prizeCount <= 0 || prizeIndex < 0 || prizeIndex >= prizeCount) {
    return currentRotation + WHEEL_SPIN_TURNS * 360
  }

  const segmentAngle = 360 / prizeCount
  const targetRotation = normalizedDegrees(-(prizeIndex + 0.5) * segmentAngle)
  const currentPosition = normalizedDegrees(currentRotation)
  const finalTurn = normalizedDegrees(targetRotation - currentPosition)
  return currentRotation + WHEEL_SPIN_TURNS * 360 + finalTurn
}
