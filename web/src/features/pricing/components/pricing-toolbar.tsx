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
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { getCatalogGroups } from '../lib/filters'
import type { PriceDisplayMode } from '../types'
import { SearchBar } from './search-bar'

export type PricingToolbarProps = {
  searchInput: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  priceDisplayMode: PriceDisplayMode
  onPriceDisplayModeChange: (value: PriceDisplayMode) => void
  groupFilter: string
  onGroupChange: (value: string) => void
  groups: string[]
  isLoading?: boolean
}

export function PricingToolbar(props: PricingToolbarProps) {
  const { t } = useTranslation()
  const groups = getCatalogGroups(props.groups)
  const selectedGroup = groups.includes(props.groupFilter)
    ? props.groupFilter
    : null

  return (
    <div className='gateway-catalog-toolbar'>
      <SearchBar
        value={props.searchInput}
        onChange={props.onSearchChange}
        onClear={props.onClearSearch}
        placeholder={t('Search model name, provider, endpoint, or tag...')}
        className='gateway-catalog-search'
      />
      <div className='gateway-catalog-toolbar-actions'>
        {groups.length > 0 && (
          <Select
            value={selectedGroup}
            onValueChange={(value) => {
              if (value) {
                props.onGroupChange(value)
              }
            }}
            disabled={props.isLoading}
          >
            <SelectTrigger
              aria-label={t('Group')}
              className='gateway-catalog-mobile-filter border-border bg-card max-w-[min(45vw,14rem)] min-w-32 rounded-full px-3 text-xs font-medium shadow-none xl:hidden'
            >
              <SelectValue
                placeholder={t('Group')}
                className='min-w-0 truncate'
              />
            </SelectTrigger>
            <SelectContent
              align='start'
              alignItemWithTrigger={false}
              className='gateway-home gateway-catalog gateway-catalog-overlay'
            >
              <SelectGroup>
                {groups.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <ToggleGroup
          aria-label={t('Price display mode')}
          value={[props.priceDisplayMode]}
          onValueChange={(values) => {
            const value = values[0]
            if (value === 'site' || value === 'official') {
              props.onPriceDisplayModeChange(value)
            }
          }}
          size='sm'
          spacing={1}
          className='gateway-catalog-price-switch'
        >
          <ToggleGroupItem value='site'>{t('Site price')}</ToggleGroupItem>
          <ToggleGroupItem value='official'>
            {t('Official price')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  )
}
