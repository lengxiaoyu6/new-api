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
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

export function PricingHeader(props: {
  modelCount: number
  vendorCount: number
  loading: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <header className='gateway-catalog-hero'>
      <div className='gateway-grid-decoration' aria-hidden='true' />
      <div className='gateway-catalog-intro'>
        <Badge variant='outline' className='gateway-badge'>
          <Sparkles className='size-3' aria-hidden='true' />
          {t('Explore models')}
        </Badge>
        <h1 className='gateway-catalog-title'>{t('Model Square')}</h1>
        <p className='gateway-catalog-description'>
          {t(
            'Discover curated AI models, compare pricing and capabilities, and choose the right model for every scenario.'
          )}
        </p>
      </div>
      <dl className='gateway-catalog-summary' aria-busy={props.loading}>
        <div>
          <dt>{t('Models')}</dt>
          <dd>
            {props.loading ? (
              <Skeleton className='h-10 w-20' />
            ) : (
              formatNumber(props.modelCount, locale)
            )}
          </dd>
        </div>
        <div>
          <dt>{t('Providers')}</dt>
          <dd>
            {props.loading ? (
              <Skeleton className='h-10 w-14' />
            ) : (
              formatNumber(props.vendorCount, locale)
            )}
          </dd>
        </div>
      </dl>
    </header>
  )
}
