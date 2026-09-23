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

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360
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
