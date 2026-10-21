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
import { ChevronDown } from 'lucide-react'
import { memo, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { FILTER_ALL } from '../constants'
import { getCatalogGroups } from '../lib/filters'
import type { PricingModel, PricingVendor } from '../types'

type FilterOption = {
  value: string
  label: string
  count?: number
  suffix?: string
  icon?: ReactNode
}

type FilterSectionProps = {
  title: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}

export interface PricingSidebarProps {
  vendorFilter: string
  groupFilter: string
  onVendorChange: (value: string) => void
  onGroupChange: (value: string) => void
  vendors: PricingVendor[]
  groups: string[]
  groupRatios?: Record<string, number>
  models: PricingModel[]
  isLoading?: boolean
  className?: string
}

function formatGroupRatio(ratio: number | undefined): string | undefined {
  if (ratio == null) return undefined
  const formatted = Number.isInteger(ratio)
    ? ratio.toString()
    : ratio.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `x${formatted}`
}

function FilterChip(props: {
  option: FilterOption
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      type='button'
      variant={props.active ? 'secondary' : 'outline'}
      size='sm'
      onClick={props.onClick}
      aria-pressed={props.active}
      className='gateway-catalog-filter-chip h-auto w-full max-w-full justify-start gap-1.5 px-2.5 py-1.5 text-xs'
      title={props.option.label}
    >
      {props.option.icon && (
        <span className='shrink-0'>{props.option.icon}</span>
      )}
      <span className='min-w-0 flex-1 text-left [overflow-wrap:anywhere]'>
        {props.option.label}
      </span>
      {(props.option.suffix || props.option.count != null) && (
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
            props.active
              ? 'bg-background text-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {props.option.suffix ?? props.option.count}
        </span>
      )}
    </Button>
  )
}

function FilterSection(props: FilterSectionProps) {
  return (
    <Collapsible
      defaultOpen
      className='gateway-catalog-filter-section border-border/70 border-b pb-4 last:border-b-0'
    >
      <CollapsibleTrigger className='group flex w-full items-center justify-between py-2.5 text-left'>
        <span className='text-foreground text-sm font-semibold'>
          {props.title}
        </span>
        <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='gateway-catalog-filter-options'>
          {props.options.map((option) => (
            <FilterChip
              key={option.value}
              option={option}
              active={props.value === option.value}
              onClick={() => props.onChange(option.value)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export const PricingSidebar = memo(function PricingSidebar(
  props: PricingSidebarProps
) {
  const { t } = useTranslation()
  const vendorCounts = useMemo(() => {
    const vendors = new Map<string, number>()
    for (const model of props.models) {
      if (model.vendor_name) {
        vendors.set(
          model.vendor_name,
          (vendors.get(model.vendor_name) ?? 0) + 1
        )
      }
    }
    return vendors
  }, [props.models])

  const vendorOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Vendors'),
      count: props.models.length,
    },
    ...props.vendors
      .map((vendor) => ({
        value: vendor.name,
        label: vendor.name,
        count: vendorCounts.get(vendor.name) ?? 0,
        icon: vendor.icon ? getLobeIcon(vendor.icon, 14) : undefined,
      }))
      .filter((vendor) => vendor.count > 0),
  ]

  const groupOptions: FilterOption[] = getCatalogGroups(props.groups).map(
    (group) => ({
      value: group,
      label: group,
      suffix: formatGroupRatio(props.groupRatios?.[group]),
    })
  )

  return (
    <aside
      aria-busy={props.isLoading || undefined}
      className={cn(
        'gateway-catalog-filters bg-card rounded-2xl border p-4',
        props.className
      )}
    >
      {props.isLoading ? (
        <div className='space-y-4'>
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className='space-y-3 py-3'>
              <Skeleton className='h-4 w-28' />
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-7 w-full' />
                <Skeleton className='h-7 w-full' />
                <Skeleton className='h-7 w-full' />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className='space-y-1'>
          {groupOptions.length > 0 && (
            <FilterSection
              title={t('Groups')}
              value={props.groupFilter}
              options={groupOptions}
              onChange={(group) =>
                props.onGroupChange(
                  group === props.groupFilter ? FILTER_ALL : group
                )
              }
            />
          )}
          <FilterSection
            title={t('All Vendors')}
            value={props.vendorFilter}
            options={vendorOptions}
            onChange={props.onVendorChange}
          />
        </div>
      )}
    </aside>
  )
})
