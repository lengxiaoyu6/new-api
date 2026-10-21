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
import { Megaphone } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { translateServerText } from '@/lib/server-error-message'

import '@/styles/gateway-home.css'
import '@/styles/gateway-catalog.css'

import {
  LoadingSkeleton,
  EmptyState,
  PricingTable,
  PricingSidebar,
  PricingToolbar,
  ModelDetailsDrawer,
} from './components'
import { PricingHeader } from './components/pricing-header'
import { FILTER_ALL } from './constants'
import { useFilters } from './hooks/use-filters'
import { usePricingData } from './hooks/use-pricing-data'
import { getCatalogGroups } from './lib/filters'
import type { PriceDisplayMode } from './types'

export function Pricing() {
  const { t } = useTranslation()
  const [selectedModelName, setSelectedModelName] = useState<string | null>(
    null
  )
  const [priceDisplayMode, setPriceDisplayMode] =
    useState<PriceDisplayMode>('site')

  const {
    models,
    vendors,
    groupRatio,
    usableGroup,
    endpointMap,
    autoGroups,
    isLoading,
    priceRate,
    usdExchangeRate,
  } = usePricingData()

  const catalogGroups = useMemo(
    () => getCatalogGroups(Object.keys(usableGroup || {})),
    [usableGroup]
  )

  const {
    searchInput,
    vendorFilter,
    groupFilter,
    tokenUnit,
    viewMode,
    showRechargePrice,
    setSearchInput,
    setVendorFilter,
    setGroupFilter,
    availableGroups,
    filteredModels,
    hasActiveFilters,
    clearFilters,
    clearSearch,
  } = useFilters(models || [], catalogGroups)

  const selectedGroupInfo = usableGroup[groupFilter]
  const groupDescription =
    typeof selectedGroupInfo === 'string'
      ? selectedGroupInfo
      : selectedGroupInfo?.desc

  const catalogVendorCount = useMemo(() => {
    const vendorNames = new Set(
      models.map((model) => model.vendor_name).filter(Boolean)
    )
    return vendors.filter((vendor) => vendorNames.has(vendor.name)).length
  }, [models, vendors])

  const handleModelClick = useCallback((modelName: string) => {
    setSelectedModelName(modelName)
  }, [])

  const selectedModel = useMemo(
    () =>
      selectedModelName
        ? (models || []).find(
            (model) => model.model_name === selectedModelName
          ) || null
        : null,
    [models, selectedModelName]
  )

  const handleClearAll = useCallback(() => {
    clearFilters()
    clearSearch()
  }, [clearFilters, clearSearch])

  const renderPricingContent = () => {
    if (filteredModels.length === 0) {
      return (
        <EmptyState
          searchQuery={searchInput}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={handleClearAll}
        />
      )
    }

    return (
      <PricingTable
        viewMode={viewMode}
        models={filteredModels}
        priceRate={priceRate}
        usdExchangeRate={usdExchangeRate}
        tokenUnit={tokenUnit}
        showRechargePrice={showRechargePrice}
        priceDisplayMode={priceDisplayMode}
        selectedGroup={groupFilter}
        onModelClick={handleModelClick}
      />
    )
  }

  return (
    <div className='gateway-home gateway-catalog'>
      <PublicLayout showMainContainer={false}>
        <PageTransition className='gateway-catalog-surface'>
          <main id='content' className='gateway-catalog-container'>
            <PricingHeader
              modelCount={models.length}
              vendorCount={catalogVendorCount}
              loading={isLoading}
            />
            <div className='gateway-catalog-layout'>
              <PricingSidebar
                vendorFilter={vendorFilter}
                groupFilter={groupFilter}
                onVendorChange={setVendorFilter}
                onGroupChange={setGroupFilter}
                vendors={vendors || []}
                groups={availableGroups}
                groupRatios={groupRatio}
                models={models || []}
                isLoading={isLoading}
                className='gateway-catalog-desktop-filters hover-scrollbar'
              />

              <section
                className='gateway-catalog-results'
                aria-label={t('Models')}
              >
                <PricingToolbar
                  searchInput={searchInput}
                  onSearchChange={setSearchInput}
                  onClearSearch={clearSearch}
                  priceDisplayMode={priceDisplayMode}
                  onPriceDisplayModeChange={setPriceDisplayMode}
                  groupFilter={groupFilter}
                  onGroupChange={setGroupFilter}
                  groups={availableGroups}
                  isLoading={isLoading}
                />

                {!isLoading && groupDescription?.trim() && (
                  <Alert
                    role='status'
                    aria-label={t('Group description')}
                    className='gateway-catalog-group-notice'
                  >
                    <Megaphone className='size-4' aria-hidden />
                    <AlertDescription>
                      {translateServerText(t, groupDescription)}
                    </AlertDescription>
                  </Alert>
                )}

                {isLoading ? (
                  <LoadingSkeleton viewMode={viewMode} />
                ) : (
                  renderPricingContent()
                )}
              </section>
            </div>
          </main>

          {selectedModel && (
            <ModelDetailsDrawer
              open={Boolean(selectedModel)}
              onOpenChange={(open) => {
                if (!open) setSelectedModelName(null)
              }}
              model={selectedModel}
              selectedGroup={
                groupFilter === FILTER_ALL ? undefined : groupFilter
              }
              groupRatio={groupRatio || {}}
              usableGroup={usableGroup || {}}
              endpointMap={
                (endpointMap as Record<
                  string,
                  { path?: string; method?: string }
                >) || {}
              }
              autoGroups={autoGroups || []}
              priceRate={priceRate ?? 1}
              usdExchangeRate={usdExchangeRate ?? 1}
              tokenUnit={tokenUnit}
              showRechargePrice={
                priceDisplayMode === 'site' && showRechargePrice
              }
            />
          )}
        </PageTransition>
      </PublicLayout>
    </div>
  )
}
