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
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

interface HeroButtonsProps {
  isAuthenticated: boolean
  secondaryAction?: 'sign-in' | 'pricing'
}

/**
 * Hero section action buttons
 */
export function HeroButtons(props: HeroButtonsProps) {
  const { t } = useTranslation()
  if (props.isAuthenticated) {
    return (
      <Button size='lg' role='link' render={<Link to='/dashboard' />}>
        {t('Go to Dashboard')} <ArrowRight className='ml-2 h-5 w-5' />
      </Button>
    )
  }

  return (
    <>
      <Button size='lg' role='link' render={<Link to='/sign-up' />}>
        {t('Get Started')}
        <ArrowRight className='ml-2 h-5 w-5' />
      </Button>
      <Button
        size='lg'
        variant='outline'
        role='link'
        render={
          <Link
            to={props.secondaryAction === 'pricing' ? '/pricing' : '/sign-in'}
          />
        }
      >
        {props.secondaryAction === 'pricing' ? t('View Pricing') : t('Sign In')}
      </Button>
    </>
  )
}
