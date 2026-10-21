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
import { useQuery } from '@tanstack/react-query'
import type { Row, PaginationState } from '@tanstack/react-table'
import {
  Fragment,
  useId,
  useState,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  DataTableCardGrid,
  DataTableRow,
  DataTableView,
  MobileCardList,
  useDataTable,
} from '@/components/data-table'
import { PortalContainerContext } from '@/components/ui/portal-container'
import { TableCell, TableRow } from '@/components/ui/table'
import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import { useMediaQuery } from '@/hooks/use-media-query'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  DEFAULT_PRICING_PAGE_SIZE,
  DEFAULT_TOKEN_UNIT,
  FILTER_ALL,
  type ViewMode,
} from '../constants'
import {
  getDynamicPricingTiers,
  hasDynamicRequestRules,
} from '../lib/dynamic-price'
import type { PriceDisplayMode, PricingModel, TokenUnit } from '../types'
import type { ModelPerfBadgeData } from './model-perf-badge'
import {
  ModelTierPricing,
  type ModelPricingDetails,
} from './model-tier-pricing'
import { usePricingColumns } from './pricing-columns'

export interface PricingTableProps {
  models: PricingModel[]
  isLoading?: boolean
  priceRate?: number
  usdExchangeRate?: number
  tokenUnit?: TokenUnit
  showRechargePrice?: boolean
  priceDisplayMode?: PriceDisplayMode
  selectedGroup?: string
  onModelClick?: (modelName: string) => void
  viewMode?: ViewMode
}

export function PricingTable(props: PricingTableProps) {
  const { t } = useTranslation()
  const portalContainer = useRef<HTMLDivElement>(null)
  const isMobile = useMediaQuery('(max-width: 767px)')
  const tierPanelPrefix = useId()
  const {
    models,
    isLoading = false,
    priceRate = 1,
    usdExchangeRate = 1,
    tokenUnit = DEFAULT_TOKEN_UNIT,
    showRechargePrice = false,
    selectedGroup,
    onModelClick,
  } = props
  const showBasePrice = props.priceDisplayMode === 'official'
  const performanceGroup =
    selectedGroup && selectedGroup !== FILTER_ALL ? selectedGroup : undefined

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PRICING_PAGE_SIZE,
  })
  const performanceQuery = useQuery({
    queryKey: performanceGroup
      ? ['perf-metrics-summary', 24, { group: performanceGroup }]
      : ['perf-metrics-summary', 24],
    queryFn: async () =>
      requireServerSuccess(
        await getPerfMetricsSummary(24, undefined, performanceGroup)
      ),
    enabled: models.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
    meta: { errorToast: false },
  })
  const performance = useMemo(() => {
    const data = performanceQuery.data?.data
    return new Map<string, ModelPerfBadgeData>(
      (data?.models ?? []).map((model) => [
        model.model_name,
        {
          ...model,
          window_start: data?.window_start,
          window_end: data?.window_end,
        },
      ])
    )
  }, [performanceQuery.data])

  const pricingDetails = useMemo(
    () =>
      new Map<string, ModelPricingDetails>(
        models.flatMap((model) => {
          if (model.billing_plugin_variants?.length) return []
          const modelTiers = getDynamicPricingTiers(model)
          const hasRequestRules = hasDynamicRequestRules(model)
          if (
            !modelTiers.length ||
            (modelTiers.length === 1 && !hasRequestRules)
          ) {
            return []
          }
          return [
            [model.model_name, { tiers: modelTiers, hasRequestRules }] as const,
          ]
        })
      ),
    [models]
  )
  const columnOptions = useMemo(
    () => ({
      tokenUnit,
      priceRate,
      usdExchangeRate,
      showRechargePrice: showRechargePrice && !showBasePrice,
      groupRatioMultiplier: showBasePrice ? 1 : undefined,
      selectedGroup,
      onModelClick,
      performance,
      cardView: isMobile || props.viewMode === 'card',
      mobileView: isMobile,
      pricingDetails,
      tierPanelPrefix,
    }),
    [
      tokenUnit,
      priceRate,
      usdExchangeRate,
      showRechargePrice,
      showBasePrice,
      selectedGroup,
      onModelClick,
      performance,
      isMobile,
      props.viewMode,
      pricingDetails,
      tierPanelPrefix,
    ]
  )
  const columns = usePricingColumns(columnOptions)

  const { table } = useDataTable({
    data: models,
    columns,
    pageCount: Math.ceil(models.length / pagination.pageSize),
    pagination,
    onPaginationChange: setPagination,
    manualPagination: false,
    withFilteredRowModel: false,
    withSortedRowModel: false,
    withFacetedRowModel: false,
    getRowId: (model) => model.model_name,
    getRowCanExpand: (row) => pricingDetails.has(row.original.model_name),
  })

  let content: ReactNode
  if (isMobile) {
    content = (
      <div className='gateway-catalog-mobile-list'>
        <MobileCardList table={table} isLoading={isLoading} />
      </div>
    )
  } else if (props.viewMode === 'card') {
    content = (
      <DataTableCardGrid
        table={table}
        isLoading={isLoading}
        gridClassName='gateway-catalog-card-grid grid grid-cols-2 gap-4 xl:grid-cols-3'
      />
    )
  } else {
    content = (
      <DataTableView
        containerClassName='gateway-catalog-table bg-card'
        table={table}
        isLoading={isLoading}
        emptyTitle={t('No Models Found')}
        emptyDescription={t('No models match your current filters.')}
        skeletonKeyPrefix='pricing-skeleton'
        applyHeaderSize
        tableClassName='gateway-catalog-pricing-table'
        getColumnClassName={(_columnId, kind) =>
          kind === 'header' ? 'text-muted-foreground font-medium' : undefined
        }
        renderRow={(row: Row<PricingModel>) => {
          const details = pricingDetails.get(row.original.model_name)
          return (
            <Fragment key={row.id}>
              <DataTableRow
                row={row}
                cellRenderColumns={columns}
                className={
                  row.getIsExpanded()
                    ? 'gateway-catalog-expanded-model hover:bg-muted/30 transition-colors'
                    : 'hover:bg-muted/30 transition-colors'
                }
              />
              {details && row.getIsExpanded() && (
                <TableRow className='gateway-catalog-tier-row'>
                  <TableCell colSpan={row.getVisibleCells().length}>
                    <ModelTierPricing
                      id={`${tierPanelPrefix}-${encodeURIComponent(row.original.model_name)}`}
                      model={row.original}
                      details={details}
                      options={columnOptions}
                    />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        }}
      />
    )
  }

  return (
    <div ref={portalContainer} className='gateway-catalog-data space-y-4'>
      {content}
      {!isLoading && models.length > 0 && (
        <PortalContainerContext.Provider value={portalContainer}>
          <DataTablePagination table={table} compact={isMobile} />
        </PortalContainerContext.Provider>
      )}
    </div>
  )
}
