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
import { Code2, KeyRound, Layers3, BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { CopyButton } from '@/components/copy-button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

import { GatewayPreview } from './gateway-preview'
import { HeroButtons } from './hero-buttons'

interface GatewaySectionsProps {
  isAuthenticated: boolean
  baseUrl: string
}

export function GatewaySections(props: GatewaySectionsProps) {
  const { t } = useTranslation()
  const features = [
    {
      title: t('Multi-protocol Compatible'),
      description: t(
        'Connect through OpenAI, Claude, Gemini, and other compatible API routes'
      ),
      icon: Code2,
    },
    {
      title: t('Model Access'),
      description: t(
        'Explore the model catalog to find available models, supported endpoints, and current prices.'
      ),
      icon: Layers3,
    },
    {
      title: t('Cost Tracking'),
      description: t(
        'Track usage, costs and performance with real-time analytics'
      ),
      icon: BarChart3,
    },
    {
      title: t('API Key Management'),
      description: t(
        'Create API keys and manage application access from the console.'
      ),
      icon: KeyRound,
    },
  ]
  const steps = [
    {
      title: t('Create Account'),
      description: t('Sign in to access the console and account settings.'),
    },
    {
      title: t('Create API Key'),
      description: t(
        'Create API keys and manage application access from the console.'
      ),
    },
    {
      title: t('Start building'),
      description: t(
        'Connect an application, choose a model, and start creating.'
      ),
    },
  ]
  const questions = [
    {
      id: 'clients',
      question: t('Can existing API clients connect?'),
      answer: t(
        'Use a compatible client with this site as the base URL and an API key created here. Check the model catalog for supported endpoints.'
      ),
    },
    {
      id: 'models',
      question: t('Which models can be used?'),
      answer: t(
        'The model catalog lists the models and prices configured for this site. Availability can vary by account group.'
      ),
    },
    {
      id: 'capabilities',
      question: t('Where can model capabilities be found?'),
      answer: t(
        'Open a model in the catalog to see its configured capabilities, supported formats, and API endpoints.'
      ),
    },
    {
      id: 'start',
      question: t('How can an application get started?'),
      answer: t(
        'Sign in, create an API key in the console, then configure the base URL and a supported model in the application.'
      ),
    },
  ]

  return (
    <>
      <section
        className='gateway-section gateway-onboarding'
        aria-labelledby='gateway-start-title'
      >
        <div className='gateway-container'>
          <AnimateInView>
            <p className='gateway-eyebrow'>{t('Start building')}</p>
            <h2 id='gateway-start-title' className='gateway-section-title'>
              {t('From account to first request.')}
            </h2>
            <div className='gateway-step-grid mt-8'>
              {steps.map((step, index) => (
                <div className='gateway-step' key={step.title}>
                  <span className='gateway-step-number' aria-hidden='true'>
                    0{index + 1}
                  </span>
                  <h3 className='mt-6 text-base font-semibold'>{step.title}</h3>
                  <p className='text-muted-foreground mt-2 text-xs leading-6'>
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </AnimateInView>
        </div>
      </section>

      <section
        className='gateway-section'
        aria-labelledby='gateway-developer-title'
      >
        <div className='gateway-container'>
          <AnimateInView className='gateway-developer-panel'>
            <div className='gateway-developer-grid'>
              <div className='min-w-0'>
                <p className='gateway-eyebrow'>{t('Built on New API')}</p>
                <h2
                  id='gateway-developer-title'
                  className='gateway-section-title'
                >
                  {t('One gateway. Every possibility.')}
                </h2>
                <p className='text-muted-foreground mt-5 text-sm leading-7'>
                  {t(
                    'Bring AI models together through one gateway. Connect familiar tools and build with the API that fits.'
                  )}
                </p>
                <div className='gateway-capability-tags mt-6 flex flex-wrap gap-2'>
                  {['OpenAI', 'Claude', 'Gemini', 'Responses'].map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </div>
                <div className='gateway-actions mt-8 flex flex-wrap gap-3'>
                  <HeroButtons
                    isAuthenticated={props.isAuthenticated}
                    secondaryAction='pricing'
                  />
                </div>
                <div className='gateway-base-url mt-7 flex items-center gap-2 rounded-lg border p-3'>
                  <code className='text-muted-foreground min-w-0 flex-1 text-xs break-all'>
                    {props.baseUrl}
                  </code>
                  <CopyButton
                    value={props.baseUrl}
                    aria-label={t('Copy Base URL')}
                  />
                </div>
              </div>
              <GatewayPreview baseUrl={props.baseUrl} />
            </div>
            <div className='gateway-capability-grid'>
              {features.map((feature, index) => (
                <div key={feature.title} className='gateway-capability'>
                  <div className='text-primary mb-4 flex items-center justify-between'>
                    <span className='font-mono text-[10px]'>0{index + 1}</span>
                    <feature.icon className='size-4' aria-hidden='true' />
                  </div>
                  <h3 className='text-xs font-semibold'>{feature.title}</h3>
                  <p className='text-muted-foreground mt-2 text-[11px] leading-5'>
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </AnimateInView>
        </div>
      </section>

      <section className='gateway-section' aria-labelledby='gateway-faq-title'>
        <div className='gateway-container'>
          <p className='gateway-eyebrow'>{t('FAQ')}</p>
          <h2 id='gateway-faq-title' className='gateway-section-title'>
            {t('Before the first request.')}
          </h2>
          <p className='text-muted-foreground mt-3 text-sm'>
            {t('A few things to know before connecting an application.')}
          </p>
          <Accordion className='gateway-faq mt-8'>
            {questions.map((question) => (
              <AccordionItem key={question.id} value={question.id}>
                <AccordionTrigger className='gap-4 px-5 py-5 text-sm'>
                  {question.question}
                </AccordionTrigger>
                <AccordionContent className='text-muted-foreground px-5 pb-5 leading-7'>
                  {question.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>
    </>
  )
}
