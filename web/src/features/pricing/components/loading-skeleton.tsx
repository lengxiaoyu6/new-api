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
import { Skeleton } from '@/components/ui/skeleton'
import { useMediaQuery } from '@/hooks/use-media-query'

import { VIEW_MODES, type ViewMode } from '../constants'

export interface LoadingSkeletonProps {
  viewMode?: ViewMode
}

export function LoadingSkeleton(props: LoadingSkeletonProps) {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const cardView = isMobile || props.viewMode === VIEW_MODES.CARD
  return (
    <div aria-busy='true'>
      {!cardView ? (
        <div className='gateway-catalog-table bg-card overflow-hidden rounded-2xl border'>
          {Array.from({ length: 10 }, (_, index) => (
            <div
              key={index}
              className='grid grid-cols-[2fr_repeat(4,1fr)_2fr] gap-4 border-b p-4 last:border-0'
            >
              {Array.from({ length: 6 }, (_, column) => (
                <Skeleton key={column} className='h-5' />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className='bg-card space-y-4 rounded-2xl border p-5'
            >
              <div className='flex items-center gap-2'>
                <Skeleton className='size-5 shrink-0' />
                <Skeleton className='h-4 w-40 max-w-full' />
              </div>
              <div className='grid grid-cols-2 gap-4'>
                {Array.from({ length: 4 }, (_, field) => (
                  <div key={field} className='space-y-2'>
                    <Skeleton className='h-3 w-4/5' />
                    <Skeleton className='h-4 w-12' />
                  </div>
                ))}
              </div>
              <Skeleton className='h-6 w-full' />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
