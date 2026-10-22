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

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function PaymentTermsNotice() {
  const { t } = useTranslation()

  return (
    <Alert
      role='note'
      aria-label={t('Payment Terms')}
      className='border-primary/20 bg-primary/5 p-4'
    >
      <AlertTitle>{t('Payment Terms')}</AlertTitle>
      <AlertDescription className='mt-2 flex flex-col gap-3 text-left leading-6'>
        <p className='text-foreground'>
          {t(
            'Please read the following carefully. By making a payment, you acknowledge that you have read and agreed to the following terms.'
          )}
        </p>
        <ol className='flex list-decimal flex-col gap-3 pl-5'>
          <li>
            {t(
              'If providers such as OpenAI or Anthropic adjust quotas, prices, or other policies, this site reserves the right to adjust the multipliers, pricing, and service offerings of related products accordingly. Such changes will be communicated through site announcements, community groups, or other channels.'
            )}
          </li>
          <li>
            {t(
              'You agree to use this site lawfully and not for any illegal, prohibited, infringing, fraudulent, or malicious activity, attacks, disruption of network security, or other activities that harm the public interest or the lawful rights and interests of others.'
            )}
          </li>
        </ol>
      </AlertDescription>
    </Alert>
  )
}
