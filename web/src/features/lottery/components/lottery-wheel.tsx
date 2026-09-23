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
import { LoaderCircle } from 'lucide-react'
import type { CSSProperties, TransitionEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { LotteryPrize } from '../types'

const WHEEL_COLORS = [
  '#f43f46',
  '#ff7414',
  '#f2b300',
  '#14a8d8',
  '#162cdd',
  '#dc0bc2',
  '#22c55e',
  '#b6eb00',
]
const WHEEL_LABEL_LIMIT = 10

function wheelBackground(prizeCount: number): string {
  if (prizeCount <= 0) return 'var(--muted)'

  const segmentAngle = 360 / prizeCount
  const separatorAngle = Math.min(2.4, segmentAngle * 0.08)
  const stops: string[] = []
  for (let index = 0; index < prizeCount; index += 1) {
    const start = index * segmentAngle
    const end = (index + 1) * segmentAngle
    stops.push(
      `rgba(255, 255, 255, 0.96) ${start}deg ${start + separatorAngle}deg`,
      `${WHEEL_COLORS[index % WHEEL_COLORS.length]} ${start + separatorAngle}deg ${end}deg`
    )
  }
  return `conic-gradient(${stops.join(', ')})`
}

type LotteryWheelProps = {
  prizes: LotteryPrize[]
  rotation: number
  spinning: boolean
  disabled: boolean
  onSpin: () => void
  onSpinEnd: () => void
}

export function LotteryWheel(props: LotteryWheelProps) {
  const { t } = useTranslation()
  const prizeCount = props.prizes.length
  const segmentAngle = prizeCount > 0 ? 360 / prizeCount : 360
  const showLabels = prizeCount > 0 && prizeCount <= WHEEL_LABEL_LIMIT
  const labelRadius = prizeCount <= 4 ? 32 : 36
  let buttonLabel = 'Draw now'
  if (props.spinning) {
    buttonLabel = 'Loading...'
  } else if (props.disabled) {
    buttonLabel = 'Unavailable'
  }

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (
      event.target === event.currentTarget &&
      event.propertyName === 'transform' &&
      props.spinning
    ) {
      props.onSpinEnd()
    }
  }

  return (
    <div
      data-slot='lottery-wheel'
      className='relative mx-auto box-border aspect-square w-full max-w-[calc(100vw-2rem)] min-w-0 overflow-visible sm:max-w-[34rem]'
    >
      <div
        aria-hidden='true'
        className='absolute inset-0 rounded-full bg-[#fff1a8] shadow-[0_18px_35px_rgba(123,92,13,0.2),0_0_0_1px_rgba(241,196,15,0.24)]'
      />
      <div
        aria-hidden='true'
        className='absolute inset-[1.4%] rounded-full bg-[#fff9d8] shadow-inner'
      />
      <div
        aria-hidden='true'
        className='absolute top-0 left-1/2 z-40 h-[9%] w-[8%] -translate-x-1/2 bg-[#ef3f43] shadow-[0_4px_7px_rgba(127,29,29,0.35)] [clip-path:polygon(0_0,100%_0,50%_100%)]'
      />
      <div
        data-testid='lottery-wheel-disc'
        aria-hidden='true'
        className={cn(
          'absolute inset-[4%] overflow-hidden rounded-full border-[5px] border-white/95 shadow-[0_10px_28px_rgba(15,23,42,0.18)] transition-transform duration-[4200ms] ease-[cubic-bezier(0.12,0.64,0.16,1)] motion-reduce:transition-none',
          props.spinning && 'will-change-transform'
        )}
        style={{
          background: wheelBackground(prizeCount),
          transform: `rotate(${props.rotation}deg)`,
        }}
        onTransitionEnd={handleTransitionEnd}
      >
        {showLabels &&
          props.prizes.map((prize, index) => {
            const angle = -90 + (index + 0.5) * segmentAngle
            const radians = (angle * Math.PI) / 180
            const labelRotation =
              angle < -90 || angle > 90 ? angle + 180 : angle
            return (
              <span
                key={prize.id}
                className='absolute flex w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-center text-sm leading-tight font-bold text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.32)] sm:w-32 sm:text-base'
                style={
                  {
                    left: `${50 + labelRadius * Math.cos(radians)}%`,
                    top: `${50 + labelRadius * Math.sin(radians)}%`,
                    transform: `translate(-50%, -50%) rotate(${labelRotation}deg)`,
                  } as CSSProperties
                }
                title={prize.title}
              >
                <span className='line-clamp-2 max-w-full break-all'>
                  {prize.title}
                </span>
              </span>
            )
          })}
      </div>
      <div
        aria-hidden='true'
        className='absolute top-1/2 left-1/2 z-20 aspect-square w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-[#dce8f1] shadow-[0_5px_15px_rgba(15,23,42,0.25)]'
      />
      <Button
        type='button'
        aria-label={t(buttonLabel)}
        aria-busy={props.spinning}
        disabled={props.disabled || props.spinning || prizeCount === 0}
        onClick={props.onSpin}
        className='absolute top-1/2 left-1/2 z-30 aspect-square w-[17%] -translate-x-1/2 -translate-y-1/2 rounded-full border-0 bg-[#1741d7] p-1 text-white shadow-[0_5px_12px_rgba(15,23,42,0.24)] hover:bg-[#1236bd] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#94a3b8] disabled:text-white disabled:opacity-100 disabled:shadow-none'
      >
        {props.spinning ? (
          <LoaderCircle
            className='size-5 animate-spin motion-reduce:animate-none'
            aria-hidden='true'
          />
        ) : null}
        <span className='max-w-20 text-center text-xs leading-tight font-bold whitespace-normal sm:text-sm'>
          {t(buttonLabel)}
        </span>
      </Button>
    </div>
  )
}
