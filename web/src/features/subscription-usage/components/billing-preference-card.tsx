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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TitledCard } from '@/components/ui/titled-card'

interface BillingPreferenceCardProps {
  value: string
  hasActive: boolean
  pending: boolean
  onChange: (value: string) => void
}

export function BillingPreferenceCard(props: BillingPreferenceCardProps) {
  const { t } = useTranslation()
  const options = [
    { value: 'subscription_first', label: t('Subscription First') },
    { value: 'wallet_first', label: t('Wallet First') },
    { value: 'subscription_only', label: t('Subscription Only') },
    { value: 'wallet_only', label: t('Wallet Only') },
  ]
  const explanations: Record<string, string> = {
    subscription_first: t(
      'Subscription quota is used first. Wallet fallback follows the plan settings.'
    ),
    wallet_first: t(
      'Wallet balance is used first, followed by subscription quota.'
    ),
    subscription_only: t(
      'Subscription quota is required for covered groups. Other groups use wallet balance.'
    ),
    wallet_only: t('Requests use wallet balance only.'),
  }
  let description = explanations[props.value]
  if (!props.hasActive && props.value === 'subscription_first') {
    description = t(
      'Preference saved as {{pref}}, but no active subscription. Wallet will be used automatically.',
      { pref: t('Subscription First') }
    )
  } else if (!props.hasActive && props.value === 'subscription_only') {
    description = t(
      'No active subscription covers requests. Wallet balance will be used.'
    )
  }

  return (
    <TitledCard
      title={t('Billing preference')}
      titleClassName='text-sm sm:text-base'
      disableHoverEffect
      action={
        <Select
          items={options}
          value={props.value}
          disabled={props.pending}
          onValueChange={(value) => value !== null && props.onChange(value)}
        >
          <SelectTrigger
            aria-label={t('Billing preference')}
            className='w-full sm:w-48'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={
                  !props.hasActive &&
                  (option.value === 'subscription_first' ||
                    option.value === 'subscription_only')
                }
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <p className='text-muted-foreground text-sm'>{description}</p>
    </TitledCard>
  )
}
