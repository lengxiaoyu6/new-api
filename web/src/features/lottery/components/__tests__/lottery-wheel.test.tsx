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
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LotteryPrize } from '../../types'
import { LotteryWheel } from '../lottery-wheel'

const prizes = [
  { id: 1, title: 'First' },
  { id: 2, title: 'Second' },
  { id: 3, title: 'Third' },
  { id: 4, title: 'Fourth' },
].map(
  (prize) =>
    ({
      ...prize,
      code: `prize-${prize.id}`,
      type: 'balance',
      balance_amount: 1,
      balance_quota: 1,
      description: '',
      available: true,
    }) as LotteryPrize
)

function renderWheel(
  overrides: Partial<React.ComponentProps<typeof LotteryWheel>> = {}
) {
  return render(
    <LotteryWheel
      prizes={prizes}
      rotation={0}
      spinning={false}
      disabled={false}
      onSpin={() => {}}
      onSpinEnd={() => {}}
      {...overrides}
    />
  )
}

/** The rotating layer: the element that carries the transform transition. */
function spinner() {
  const disc = screen.getByTestId('lottery-wheel-disc')
  const layer = disc.parentElement
  if (!layer) throw new Error('the disc is missing its rotation layer')
  return layer
}

describe('LotteryWheel', () => {
  it('keeps the painted disc on a child so rotation only composites a transform', () => {
    renderWheel({ rotation: 90 })

    const layer = spinner()
    // The animated layer must stay free of the gradient, border and shadow: repainting
    // them on every frame is what made the spin stutter.
    expect(layer.style.transform).toBe('rotate(90deg)')
    expect(layer.style.background).toBe('')
    expect(layer.className).toContain('transition-transform')
    expect(layer.className).toContain('will-change-transform')

    // Exactly one painted child: the disc that carries the fixed decoration.
    expect(layer.children).toHaveLength(1)
    const disc = screen.getByTestId('lottery-wheel-disc')
    expect(disc.parentElement).toBe(layer)
    expect(disc.style.background).toContain('conic-gradient')
  })

  it('paints prize sections edge to edge without white gaps', () => {
    renderWheel()

    const background = screen.getByTestId('lottery-wheel-disc').style.background

    expect(background).not.toContain('255, 255, 255')
  })

  it('reports the end of the spin when the rotating layer finishes its transform', () => {
    const onSpinEnd = vi.fn()
    renderWheel({ spinning: true, onSpinEnd })

    spinner().dispatchEvent(
      new TransitionEvent('transitionend', {
        bubbles: true,
        propertyName: 'transform',
      })
    )

    expect(onSpinEnd).toHaveBeenCalledTimes(1)
  })

  it('ignores transitions of other properties and transitions while idle', () => {
    const onSpinEnd = vi.fn()
    const { unmount } = renderWheel({ spinning: true, onSpinEnd })

    spinner().dispatchEvent(
      new TransitionEvent('transitionend', {
        bubbles: true,
        propertyName: 'opacity',
      })
    )
    expect(onSpinEnd).not.toHaveBeenCalled()

    unmount()
    renderWheel({ spinning: false, onSpinEnd })
    spinner().dispatchEvent(
      new TransitionEvent('transitionend', {
        bubbles: true,
        propertyName: 'transform',
      })
    )
    expect(onSpinEnd).not.toHaveBeenCalled()
  })

  it('hides the disc labels from assistive technology', () => {
    renderWheel()

    expect(screen.getByTestId('lottery-wheel-disc')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
  })
})
