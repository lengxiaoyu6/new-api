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
import { LoaderCircle, Sparkles, Triangle } from 'lucide-react'
import type { CSSProperties, TransitionEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { LotteryPrize } from '../types'

const WHEEL_COLORS = [
  '#b83a3a',
  '#147a6e',
  '#9a6700',
  '#2864a6',
  '#7b4f9d',
  '#a63d63',
  '#3f7d3a',
  '#a5541a',
]
const WHEEL_LIGHT_COUNT = 20
const WHEEL_LABEL_LIMIT = 10

function wheelBackground(prizeCount: number): string {
  if (prizeCount <= 0) return 'var(--muted)'

  const segmentAngle = 360 / prizeCount
  const separatorAngle = Math.min(0.8, segmentAngle * 0.12)
  const stops: string[] = []
  for (let index = 0; index < prizeCount; index += 1) {
    const start = index * segmentAngle
    const end = (index + 1) * segmentAngle
    stops.push(
      `var(--background) ${start}deg ${start + separatorAngle}deg`,
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
  const labelRadius = prizeCount <= 4 ? 31 : 36

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
      className='relative mx-auto aspect-square w-full max-w-[22rem] min-w-0'
    >
      <div
        aria-hidden='true'
        className='bg-foreground/5 absolute inset-[1%] rounded-full shadow-inner'
      />
      {Array.from({ length: WHEEL_LIGHT_COUNT }, (_, index) => {
        const angle = (index / WHEEL_LIGHT_COUNT) * Math.PI * 2 - Math.PI / 2
        return (
          <span
            key={index}
            aria-hidden='true'
            className='bg-background ring-foreground/15 absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm ring-1 sm:size-3'
            style={{
              left: `${50 + 46.5 * Math.cos(angle)}%`,
              top: `${50 + 46.5 * Math.sin(angle)}%`,
            }}
          />
        )
      })}
      <div
        aria-hidden='true'
        className='bg-background ring-foreground/10 absolute top-0 left-1/2 z-30 flex size-10 -translate-x-1/2 items-center justify-center rounded-full shadow-md ring-1'
      >
        <Triangle className='size-5 rotate-180 fill-amber-500 text-amber-600' />
      </div>
      <div
        data-testid='lottery-wheel-disc'
        aria-hidden='true'
        className={cn(
          'border-background absolute inset-[5%] overflow-hidden rounded-full border-[6px] shadow-[0_18px_45px_rgba(15,23,42,0.22)] transition-transform duration-[4200ms] ease-[cubic-bezier(0.12,0.64,0.16,1)] motion-reduce:transition-none',
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
            return (
              <span
                key={prize.id}
                className='absolute flex w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-center text-xs leading-tight font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] transition-transform duration-[4200ms] ease-[cubic-bezier(0.12,0.64,0.16,1)] motion-reduce:transition-none sm:w-24'
                style={
                  {
                    left: `${50 + labelRadius * Math.cos(radians)}%`,
                    top: `${50 + labelRadius * Math.sin(radians)}%`,
                    transform: `translate(-50%, -50%) rotate(${-props.rotation}deg)`,
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
        <div className='border-background/70 absolute inset-[17%] rounded-full border shadow-inner' />
      </div>
      <div
        aria-hidden='true'
        className='bg-background ring-foreground/10 absolute top-1/2 left-1/2 z-20 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_8px_24px_rgba(15,23,42,0.24)] ring-1'
      />
      <Button
        type='button'
        aria-label={t('Draw now')}
        aria-busy={props.spinning}
        disabled={props.disabled || props.spinning || prizeCount === 0}
        onClick={props.onSpin}
        className='bg-foreground text-background hover:bg-foreground/90 absolute top-1/2 left-1/2 z-30 size-24 -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-full border-4 border-transparent p-2 shadow-lg focus-visible:ring-offset-2'
      >
        {props.spinning ? (
          <LoaderCircle
            className='size-5 animate-spin motion-reduce:animate-none'
            aria-hidden='true'
          />
        ) : (
          <Sparkles className='size-5' aria-hidden='true' />
        )}
        <span className='max-w-16 text-center text-xs leading-tight whitespace-normal'>
          {t(props.spinning ? 'Loading...' : 'Draw now')}
        </span>
      </Button>
    </div>
  )
}
