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
import {
  Check,
  Gift,
  ExternalLink,
  Loader2,
  PencilLine,
  Receipt,
  ShoppingBag,
  WalletCards,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatLocalCurrencyAmount } from '@/lib/currency'
import { cn } from '@/lib/utils'

import {
  formatCurrency,
  getDiscountLabel,
  getPaymentIcon,
  getMinTopupAmount,
  calculatePresetPricing,
} from '../lib'
import type {
  PaymentMethod,
  PresetAmount,
  TopupInfo,
  CreemProduct,
  WaffoPayMethod,
} from '../types'
import { CreemProductsSection } from './creem-products-section'

interface RechargeFormCardProps {
  topupInfo: TopupInfo | null
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  calculating: boolean
  onPaymentMethodSelect: (method: PaymentMethod) => void
  paymentLoading: string | null
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  topupLink?: string
  loading?: boolean
  priceRatio?: number
  usdExchangeRate?: number
  onOpenBilling?: () => void
  creemProducts?: CreemProduct[]
  enableCreemTopup?: boolean
  onCreemProductSelect?: (product: CreemProduct) => void
  enableWaffoTopup?: boolean
  waffoPayMethods?: WaffoPayMethod[]
  waffoMinTopup?: number
  onWaffoMethodSelect?: (method: WaffoPayMethod, index: number) => void
  enableWaffoPancakeTopup?: boolean
}

export function RechargeFormCard({
  topupInfo,
  presetAmounts,
  selectedPreset,
  onSelectPreset,
  topupAmount,
  onTopupAmountChange,
  paymentAmount,
  calculating,
  onPaymentMethodSelect,
  paymentLoading,
  redemptionCode,
  onRedemptionCodeChange,
  onRedeem,
  redeeming,
  topupLink,
  loading,
  priceRatio = 1,
  usdExchangeRate = 1,
  onOpenBilling,
  creemProducts,
  enableCreemTopup,
  onCreemProductSelect,
  enableWaffoTopup,
  waffoPayMethods,
  waffoMinTopup,
  onWaffoMethodSelect,
  enableWaffoPancakeTopup,
}: RechargeFormCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [localAmount, setLocalAmount] = useState(topupAmount.toString())
  const [customAmountSelected, setCustomAmountSelected] = useState(false)

  useEffect(() => {
    // Empty string must survive, otherwise the field can never be cleared
    setLocalAmount((prev) =>
      prev === '' && topupAmount === 0 ? prev : topupAmount.toString()
    )
  }, [topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const numValue = Number(value) || 0
    if (numValue >= 0) {
      onTopupAmountChange(numValue)
    }
  }

  const hasConfigurableTopup =
    topupInfo?.enable_online_topup ||
    topupInfo?.enable_stripe_topup ||
    enableWaffoTopup ||
    enableWaffoPancakeTopup
  const hasAnyTopup = hasConfigurableTopup || enableCreemTopup
  const hasStandardPaymentMethods =
    Array.isArray(topupInfo?.pay_methods) && topupInfo.pay_methods.length > 0
  const hasWaffoPaymentMethods =
    Array.isArray(waffoPayMethods) && waffoPayMethods.length > 0
  const minTopup = getMinTopupAmount(topupInfo)
  const redemptionEnabled = topupInfo?.enable_redemption !== false
  const isCustomAmount =
    customAmountSelected ||
    (selectedPreset === null &&
      !presetAmounts.some((preset) => preset.value === topupAmount))
  const activePreset = isCustomAmount ? null : (selectedPreset ?? topupAmount)

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='mt-2 h-4 w-48' />
        </CardHeader>
        <CardContent className='space-y-4 p-3 sm:space-y-6 sm:p-5'>
          <Skeleton className='h-10 w-full rounded-lg sm:w-64' />
          <div className='space-y-4 sm:space-y-6'>
            {/* Preset Amounts Skeleton */}
            <div className='space-y-3'>
              <Skeleton className='h-3 w-16' />
              <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
                {Array.from({ length: 6 }, (_, index) => `preset-${index}`).map(
                  (key) => (
                    <Skeleton key={key} className='h-[72px] rounded-lg' />
                  )
                )}
              </div>
            </div>

            {/* Custom Amount Input Skeleton */}
            <div className='space-y-3'>
              <Skeleton className='h-3 w-28' />
              <Skeleton className='h-[42px] w-full' />
            </div>

            {/* Payment Methods Skeleton */}
            <div className='space-y-3'>
              <Skeleton className='h-3 w-32' />
              <div className='flex flex-wrap gap-3'>
                {['primary', 'secondary', 'tertiary'].map((key) => (
                  <Skeleton key={key} className='h-10 w-24 rounded-lg' />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <TitledCard
      title={t('Add Funds')}
      description={t('Top up online or redeem a code')}
      icon={<WalletCards className='h-4 w-4' />}
      iconTone='success'
      disableHoverEffect
      action={
        onOpenBilling ? (
          <Button
            variant='outline'
            size='sm'
            onClick={onOpenBilling}
            className='w-full gap-2 sm:w-auto'
          >
            <Receipt className='h-4 w-4' />
            {t('Order History')}
          </Button>
        ) : null
      }
      contentClassName='space-y-4 sm:space-y-6'
    >
      <Tabs
        defaultValue={
          hasAnyTopup || !redemptionEnabled ? 'online' : 'redemption'
        }
        className='gap-5 sm:gap-6'
      >
        <TabsList
          aria-label={t('Add Funds')}
          className='grid w-full grid-cols-2 group-data-horizontal/tabs:h-auto sm:w-fit sm:min-w-72'
        >
          <TabsTrigger
            value='online'
            className='min-h-9 gap-2 px-3 py-2 whitespace-normal sm:px-4'
          >
            <WalletCards aria-hidden='true' />
            {t('Online Top-up')}
          </TabsTrigger>
          <TabsTrigger
            value='redemption'
            className='min-h-9 gap-2 px-3 py-2 whitespace-normal sm:px-4'
          >
            <Gift aria-hidden='true' />
            {t('Redemption Code')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='online' className='space-y-5 sm:space-y-6'>
          {/* Online Topup Section */}
          {hasAnyTopup ? (
            <div className='space-y-4 sm:space-y-6'>
              {hasConfigurableTopup && (
                <>
                  {presetAmounts.length > 0 && (
                    <div className='space-y-2.5 sm:space-y-3'>
                      <Label className='text-muted-foreground text-sm font-medium'>
                        {t('Recharge Amount')}
                      </Label>
                      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6'>
                        {presetAmounts.map((preset) => {
                          const discount =
                            preset.discount ||
                            topupInfo?.discount?.[preset.value] ||
                            1.0
                          const {
                            displayValue,
                            actualPrice,
                            savedAmount,
                            hasDiscount,
                          } = calculatePresetPricing(
                            preset.value,
                            priceRatio,
                            discount,
                            usdExchangeRate
                          )
                          return (
                            <Button
                              key={preset.value}
                              variant='outline'
                              aria-pressed={activePreset === preset.value}
                              className={cn(
                                'relative h-auto min-h-24 min-w-0 flex-col items-start justify-center gap-1.5 rounded-xl px-3 py-4 text-left whitespace-normal sm:px-4',
                                activePreset === preset.value &&
                                  'border-primary bg-primary/5 ring-primary/15 ring-1 dark:border-primary dark:bg-primary/10'
                              )}
                              onClick={() => {
                                setCustomAmountSelected(false)
                                onSelectPreset(preset)
                              }}
                            >
                              <div className='flex w-full min-w-0 items-center gap-2'>
                                <div className='text-base font-semibold break-all tabular-nums sm:text-lg'>
                                  {formatLocalCurrencyAmount(displayValue, {
                                    digitsLarge: 2,
                                    digitsSmall: 4,
                                    abbreviate: false,
                                    locale,
                                  })}
                                </div>
                                {activePreset === preset.value && (
                                  <Check
                                    className='text-primary ml-auto size-3.5 shrink-0'
                                    aria-hidden='true'
                                  />
                                )}
                              </div>
                              {hasDiscount && (
                                <div className='text-primary text-xs font-medium'>
                                  {getDiscountLabel(discount, t)}
                                </div>
                              )}
                              {(hasDiscount ||
                                actualPrice !== displayValue) && (
                                <div className='text-muted-foreground w-full text-xs font-normal'>
                                  {hasDiscount && savedAmount > 0 ? (
                                    <Trans
                                      t={t}
                                      i18nKey='Pay {{amount}} <savings>• Save {{saved}}</savings>'
                                      values={{
                                        amount: formatCurrency(actualPrice),
                                        saved: formatCurrency(savedAmount),
                                      }}
                                      components={{
                                        savings: (
                                          <span className='text-primary' />
                                        ),
                                      }}
                                    />
                                  ) : (
                                    t('Pay {{amount}}', {
                                      amount: formatCurrency(actualPrice),
                                    })
                                  )}
                                </div>
                              )}
                            </Button>
                          )
                        })}
                        <Button
                          variant='outline'
                          aria-pressed={isCustomAmount}
                          className={cn(
                            'h-auto min-h-24 min-w-0 flex-col items-start justify-center gap-2 rounded-xl px-3 py-4 text-left sm:px-4',
                            isCustomAmount &&
                              'border-primary bg-primary/5 ring-primary/15 ring-1 dark:border-primary dark:bg-primary/10'
                          )}
                          onClick={() => setCustomAmountSelected(true)}
                        >
                          <PencilLine
                            className='text-muted-foreground size-4'
                            aria-hidden='true'
                          />
                          <span className='text-sm font-medium'>
                            {t('Custom Amount')}
                          </span>
                        </Button>
                      </div>
                    </div>
                  )}

                  {(isCustomAmount || presetAmounts.length === 0) && (
                    <div className='max-w-md space-y-2.5'>
                      <Label
                        htmlFor='topup-amount'
                        className='text-muted-foreground text-sm font-medium'
                      >
                        {t('Custom Amount')}
                      </Label>
                      <Input
                        id='topup-amount'
                        type='number'
                        step='0.01'
                        value={localAmount}
                        onChange={(e) => handleAmountChange(e.target.value)}
                        min={minTopup}
                        placeholder={t('Minimum {{amount}}', {
                          amount: minTopup,
                        })}
                        className='h-11 text-base'
                      />
                    </div>
                  )}

                  <div className='bg-muted/20 flex flex-col gap-5 rounded-xl border p-4 sm:p-5'>
                    <div className='grid grid-cols-2 gap-4'>
                      <div className='flex min-w-0 flex-col gap-1.5'>
                        <span className='text-muted-foreground text-xs'>
                          {t('Topup Amount')}
                        </span>
                        <span className='text-lg font-semibold break-all tabular-nums'>
                          {formatLocalCurrencyAmount(
                            topupAmount * usdExchangeRate,
                            {
                              digitsLarge: 2,
                              digitsSmall: 4,
                              abbreviate: false,
                              locale,
                            }
                          )}
                        </span>
                      </div>
                      <div
                        className='flex min-w-0 flex-col items-end gap-1.5 text-right'
                        aria-live='polite'
                        aria-busy={calculating}
                      >
                        <span className='text-muted-foreground text-xs'>
                          {t('You Pay')}
                        </span>
                        {calculating ? (
                          <Skeleton className='h-7 w-24' />
                        ) : (
                          <span className='text-xl font-semibold break-all tabular-nums'>
                            {formatCurrency(paymentAmount)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                      {(hasStandardPaymentMethods ||
                        !hasWaffoPaymentMethods) && (
                        <Label className='text-muted-foreground text-xs font-medium'>
                          {t('Payment Method')}
                        </Label>
                      )}
                      {hasStandardPaymentMethods ? (
                        <div className='grid gap-2 sm:flex sm:flex-wrap'>
                          {topupInfo?.pay_methods?.map((method) => {
                            const minTopup = Math.max(
                              method.min_topup || 0,
                              getMinTopupAmount(topupInfo)
                            )
                            const disabled = minTopup > topupAmount
                            const disabledReason = disabled
                              ? t('Minimum topup amount: {{amount}}', {
                                  amount: minTopup,
                                })
                              : undefined
                            const disabledLabel = disabled
                              ? `${t('Minimum:')} ${minTopup}`
                              : undefined
                            const paymentLabel = t('Pay with {{method}}', {
                              method: method.name,
                            })

                            const button = (
                              <Button
                                key={method.type}
                                variant='default'
                                onClick={() => onPaymentMethodSelect(method)}
                                disabled={disabled || !!paymentLoading}
                                title={disabledReason}
                                aria-label={
                                  disabledReason
                                    ? `${paymentLabel}. ${disabledReason}`
                                    : paymentLabel
                                }
                                className='h-auto min-h-11 min-w-0 justify-center gap-2 rounded-lg px-5 py-3 sm:min-w-40'
                              >
                                {paymentLoading === method.type ? (
                                  <Loader2 className='h-4 w-4 animate-spin' />
                                ) : (
                                  getPaymentIcon(
                                    method.type,
                                    'h-4 w-4',
                                    method.icon,
                                    method.name
                                  )
                                )}
                                <span className='flex min-w-0 flex-col items-start gap-0.5'>
                                  <span className='max-w-full truncate'>
                                    {paymentLabel}
                                  </span>
                                  {disabledLabel && (
                                    <span className='max-w-full truncate text-[11px] leading-4 font-normal opacity-75'>
                                      {disabledLabel}
                                    </span>
                                  )}
                                </span>
                              </Button>
                            )

                            return disabled ? (
                              <TooltipProvider key={method.type}>
                                <Tooltip>
                                  <TooltipTrigger render={button} />
                                  <TooltipContent>
                                    {disabledReason}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              button
                            )
                          })}
                        </div>
                      ) : null}
                      {!hasStandardPaymentMethods &&
                        !hasWaffoPaymentMethods && (
                          <Alert>
                            <AlertDescription>
                              {t(
                                'No payment methods available. Please contact administrator.'
                              )}
                            </AlertDescription>
                          </Alert>
                        )}
                    </div>

                    {enableWaffoTopup &&
                      hasWaffoPaymentMethods &&
                      onWaffoMethodSelect && (
                        <div className='space-y-2.5 sm:space-y-3'>
                          <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                            {t('Waffo Payment')}
                          </Label>
                          <div className='grid gap-2 sm:flex sm:flex-wrap'>
                            {waffoPayMethods?.map((method, index) => {
                              const loadingKey = `waffo-${index}`
                              const methodKey = `${method.payMethodType ?? 'unknown'}-${method.payMethodName ?? method.name}`
                              const waffoMin = waffoMinTopup || 0
                              const belowMin = waffoMin > topupAmount
                              const disabledReason = belowMin
                                ? t('Minimum topup amount: {{amount}}', {
                                    amount: waffoMin,
                                  })
                                : undefined
                              const disabledLabel = belowMin
                                ? `${t('Minimum:')} ${waffoMin}`
                                : undefined
                              const paymentLabel = t('Pay with {{method}}', {
                                method: method.name,
                              })

                              let methodIcon = getPaymentIcon('waffo')
                              if (paymentLoading === loadingKey) {
                                methodIcon = (
                                  <Loader2 className='h-4 w-4 animate-spin' />
                                )
                              } else if (method.icon) {
                                methodIcon = (
                                  <img
                                    src={method.icon}
                                    alt={method.name}
                                    className='h-4 w-4 object-contain'
                                  />
                                )
                              }

                              const button = (
                                <Button
                                  key={methodKey}
                                  variant='default'
                                  onClick={() =>
                                    onWaffoMethodSelect(method, index)
                                  }
                                  disabled={belowMin || !!paymentLoading}
                                  title={disabledReason}
                                  aria-label={
                                    disabledReason
                                      ? `${paymentLabel}. ${disabledReason}`
                                      : paymentLabel
                                  }
                                  className='h-auto min-h-11 min-w-0 justify-center gap-2 rounded-lg px-5 py-3 sm:min-w-40'
                                >
                                  {methodIcon}
                                  <span className='flex min-w-0 flex-col items-start gap-0.5'>
                                    <span className='max-w-full truncate'>
                                      {paymentLabel}
                                    </span>
                                    {disabledLabel && (
                                      <span className='max-w-full truncate text-[11px] leading-4 font-normal opacity-75'>
                                        {disabledLabel}
                                      </span>
                                    )}
                                  </span>
                                </Button>
                              )

                              return belowMin ? (
                                <TooltipProvider key={methodKey}>
                                  <Tooltip>
                                    <TooltipTrigger render={button} />
                                    <TooltipContent>
                                      {disabledReason}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                button
                              )
                            })}
                          </div>
                        </div>
                      )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                {t(
                  'Online topup is not enabled. Please use redemption code or contact administrator.'
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Creem Products Section */}
          {enableCreemTopup &&
            Array.isArray(creemProducts) &&
            creemProducts.length > 0 &&
            onCreemProductSelect && (
              <div className='space-y-2.5 border-t pt-4 sm:space-y-3 sm:pt-6'>
                <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  {t('Creem Payment')}
                </Label>
                <CreemProductsSection
                  products={creemProducts}
                  onProductSelect={onCreemProductSelect}
                />
              </div>
            )}
        </TabsContent>

        <TabsContent value='redemption'>
          {/* Redemption Code Section */}
          {redemptionEnabled ? (
            <div className='bg-muted/20 flex flex-col gap-5 rounded-xl border p-4 sm:p-6'>
              <div className='flex items-center gap-2'>
                <IconBadge tone='warning' size='xs'>
                  <Gift />
                </IconBadge>
                <Label
                  htmlFor='redemption-code'
                  className='text-sm font-medium'
                >
                  {t('Redemption Code')}
                </Label>
              </div>
              <form
                className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]'
                onSubmit={(event) => {
                  event.preventDefault()
                  if (redemptionCode.trim() && !redeeming) onRedeem()
                }}
              >
                <Input
                  id='redemption-code'
                  value={redemptionCode}
                  onChange={(e) => onRedemptionCodeChange(e.target.value)}
                  placeholder={t('Enter your redemption code')}
                  autoComplete='off'
                  disabled={redeeming}
                  className='h-11 min-w-0'
                />
                <Button
                  type='submit'
                  disabled={redeeming || !redemptionCode.trim()}
                  className='h-11 px-6'
                >
                  {redeeming && (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  )}
                  {t('Redeem')}
                </Button>
              </form>
              {topupLink && (
                <div className='border-primary/20 bg-primary/5 flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between'>
                  <div className='flex min-w-0 items-center gap-3'>
                    <IconBadge tone='primary'>
                      <ShoppingBag />
                    </IconBadge>
                    <p className='text-sm font-medium'>
                      {t('Need a redemption code?')}
                    </p>
                  </div>
                  <Button
                    role='link'
                    className='h-auto min-h-11 w-full gap-2 px-5 py-3 whitespace-normal sm:w-auto'
                    render={
                      <a
                        href={topupLink}
                        target='_blank'
                        rel='noopener noreferrer'
                      />
                    }
                  >
                    <span>{t('Buy a redemption code')}</span>
                    <ExternalLink className='size-4' aria-hidden='true' />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Alert className='border-t'>
              <AlertDescription>
                {t(
                  'Redemption codes are disabled until the administrator confirms compliance terms.'
                )}
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>
    </TitledCard>
  )
}
