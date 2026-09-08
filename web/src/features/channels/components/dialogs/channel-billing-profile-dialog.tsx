/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { Check, Code2, Eye, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { JsonCodeEditor } from '@/components/json-code-editor'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TieredPricingEditor } from '@/features/system-settings/models/tiered-pricing-editor'

import {
  createEmptyChannelBillingProfile,
  normalizeChannelBillingProfile,
  normalizeChannelBillingProfilesObject,
  parseChannelBillingProfiles,
  parseChannelBillingProfilesJson,
  serializeChannelBillingProfiles,
  validateChannelBillingProfileDrafts,
  validateChannelBillingProfilesObject,
  type ChannelBillingProfileDraft,
} from '../../lib/channel-billing-profiles'
import type { ChannelBillingProfile } from '../../types'

type ChannelBillingProfileDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelOptions: string[]
  value: Record<string, unknown>
  onSave: (value: Record<string, ChannelBillingProfile>) => void
}

type ProfileEditorMode = 'visual' | 'json'

function parseProfileJson(
  value: string
): Record<string, ChannelBillingProfile> {
  const parsed = parseChannelBillingProfilesJson(value)
  if (!parsed) throw new Error('invalid')
  const profileObject = parsed as Record<string, unknown>
  const validationError = validateChannelBillingProfilesObject(profileObject)
  if (validationError) throw new Error(validationError)
  return normalizeChannelBillingProfilesObject(profileObject)
}

function parseProfileJsonObject(value: string): Record<string, unknown> {
  const parsed = parseChannelBillingProfilesJson(value)
  if (!parsed) throw new Error('invalid')
  return parsed
}

function getProfileJsonError(error: unknown, fallback: string): string {
  if (
    error instanceof Error &&
    error.name !== 'SyntaxError' &&
    error.message !== 'invalid'
  ) {
    return error.message
  }
  return fallback
}

export function ChannelBillingProfileDialog(
  props: ChannelBillingProfileDialogProps
) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<
    ReturnType<typeof parseChannelBillingProfiles>
  >([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<ProfileEditorMode>('visual')
  const [rawJson, setRawJson] = useState('{}')

  const modelOptions = useMemo(
    () =>
      [
        ...new Set(
          props.modelOptions.map((model) => model.trim()).filter(Boolean)
        ),
      ].sort(),
    [props.modelOptions]
  )
  const profileModelOptions = useMemo(
    () =>
      [
        ...new Set([
          ...modelOptions,
          ...entries.map((entry) => entry.modelName.trim()).filter(Boolean),
        ]),
      ].sort(),
    [entries, modelOptions]
  )
  const selected = entries[selectedIndex]

  useEffect(() => {
    if (!props.open) return
    const nextEntries = parseChannelBillingProfiles(props.value)
    setEntries(nextEntries)
    setSelectedIndex(0)
    setMode('visual')
    setRawJson(JSON.stringify(props.value || {}, null, 2))
  }, [props.open, props.value])

  const updateSelected = (patch: Partial<ChannelBillingProfileDraft>) => {
    setEntries((current) =>
      current.map((entry, index) =>
        index === selectedIndex ? { ...entry, ...patch } : entry
      )
    )
  }

  const addProfile = () => {
    const unusedModel = modelOptions.find(
      (model) => !entries.some((entry) => entry.modelName === model)
    )
    if (!unusedModel) {
      toast.error(t('Select a model that is not already configured.'))
      return
    }
    setEntries((current) => [
      ...current,
      createEmptyChannelBillingProfile(unusedModel),
    ])
    setSelectedIndex(entries.length)
    setMode('visual')
  }

  const removeProfile = () => {
    if (!selected) return
    setEntries((current) =>
      current.filter((_, index) => index !== selectedIndex)
    )
    setSelectedIndex(Math.max(0, Math.min(selectedIndex, entries.length - 2)))
  }

  const switchMode = (nextMode: ProfileEditorMode) => {
    if (nextMode === 'json') {
      const nextValue: Record<string, ChannelBillingProfile> = {}
      for (const entry of entries) {
        if (entry.modelName.trim()) {
          nextValue[entry.modelName.trim()] =
            normalizeChannelBillingProfile(entry)
        }
      }
      setRawJson(JSON.stringify(nextValue, null, 2))
    } else {
      try {
        const parsed = parseProfileJsonObject(rawJson)
        setEntries(parseChannelBillingProfiles(parsed))
        setSelectedIndex(0)
      } catch (error) {
        toast.error(
          t(
            getProfileJsonError(
              error,
              'Please fix JSON errors before switching to visual mode.'
            )
          )
        )
        return
      }
    }
    setMode(nextMode)
  }

  const save = () => {
    let nextValue: Record<string, ChannelBillingProfile> = {}
    if (mode === 'json') {
      try {
        nextValue = parseProfileJson(rawJson)
      } catch (error) {
        toast.error(
          t(getProfileJsonError(error, 'Please fix JSON errors before saving'))
        )
        return
      }
    } else {
      const validationError = validateChannelBillingProfileDrafts(entries)
      if (validationError) {
        toast.error(t(validationError))
        return
      }
      nextValue = serializeChannelBillingProfiles(entries)
    }
    props.onSave(nextValue)
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Channel Billing Profiles')}
      description={t(
        'Configure channel-specific prices with the same visual editor used for model pricing.'
      )}
      contentClassName='flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-6xl'
      headerClassName='border-b px-6 py-4'
      footerClassName='border-t px-6 py-4'
      contentHeight='74vh'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={save}>
            <Check data-icon='inline-start' />
            {t('Save changes')}
          </Button>
        </>
      }
    >
      <Tabs
        value={mode}
        onValueChange={(value) => switchMode(value as ProfileEditorMode)}
        className='min-w-0 gap-0'
      >
        <div className='border-b px-4 py-3'>
          <TabsList className='grid h-auto w-full grid-cols-2 gap-1 sm:w-96'>
            <TabsTrigger value='visual'>
              <Eye className='size-4' aria-hidden='true' />
              {t('Visual editor')}
            </TabsTrigger>
            <TabsTrigger value='json'>
              <Code2 className='size-4' aria-hidden='true' />
              {t('JSON editor')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value='visual'
          className='grid min-w-0 gap-4 p-4 lg:grid-cols-[15rem_minmax(0,1fr)]'
        >
          <div className='flex min-w-0 flex-col gap-2'>
            <div className='flex items-center justify-between gap-2'>
              <div>
                <p className='font-medium'>{t('Profiles')}</p>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Each profile overrides one exact model name on this channel.'
                  )}
                </p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='icon-sm'
                onClick={addProfile}
                aria-label={t('Add profile')}
              >
                <Plus className='size-4' />
              </Button>
            </div>
            <div className='flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border p-1 lg:max-h-[calc(74vh-10rem)]'>
              {entries.length === 0 ? (
                <p className='text-muted-foreground px-3 py-4 text-xs'>
                  {t('No channel profiles configured.')}
                </p>
              ) : (
                entries.map((entry, index) => (
                  <button
                    type='button'
                    key={entry.modelName || `profile-${index}`}
                    onClick={() => setSelectedIndex(index)}
                    aria-pressed={index === selectedIndex}
                    className={`focus-visible:ring-ring flex min-h-11 items-center rounded-md px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 ${index === selectedIndex ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'}`}
                  >
                    <span className='min-w-0 truncate'>
                      {entry.modelName || t('Unnamed model')}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {selected ? (
            <div className='min-w-0 space-y-4'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <h3 className='font-medium'>{t('Profile details')}</h3>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Prices use USD per 1M tokens. The channel profile applies only to this exact model name.'
                    )}
                  </p>
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  onClick={removeProfile}
                  aria-label={t('Remove profile')}
                >
                  <Trash2 className='size-4' />
                </Button>
              </div>
              <FieldGroup className='grid gap-4 sm:grid-cols-2'>
                <Field className='gap-1.5'>
                  <FieldLabel htmlFor='channel-billing-profile-model'>
                    {t('Model name')}
                  </FieldLabel>
                  <Combobox
                    id='channel-billing-profile-model'
                    aria-label={t('Model name')}
                    options={profileModelOptions.map((model) => ({
                      value: model,
                      label: model,
                    }))}
                    value={selected.modelName}
                    onValueChange={(value) =>
                      value && updateSelected({ modelName: value })
                    }
                    placeholder={t('Select model')}
                    className='w-full'
                  />
                  <FieldDescription>
                    {t(
                      'Each profile overrides one exact model name on this channel.'
                    )}
                  </FieldDescription>
                </Field>
                <Field className='gap-1.5'>
                  <FieldLabel htmlFor='channel-billing-profile-key'>
                    {t('Profile key')}
                  </FieldLabel>
                  <Input
                    id='channel-billing-profile-key'
                    value={selected.key}
                    onChange={(event) =>
                      updateSelected({ key: event.target.value })
                    }
                    placeholder='long-context'
                  />
                  <FieldDescription>
                    {t(
                      'Letters, numbers, dots, hyphens, and underscores only.'
                    )}
                  </FieldDescription>
                </Field>
                <Field className='gap-1.5'>
                  <FieldLabel htmlFor='channel-billing-profile-label-zh'>
                    {t('Chinese label')}
                  </FieldLabel>
                  <Input
                    id='channel-billing-profile-label-zh'
                    value={selected.label?.zh || ''}
                    onChange={(event) =>
                      updateSelected({
                        label: { ...selected.label, zh: event.target.value },
                      })
                    }
                    placeholder='长上下文价格'
                  />
                </Field>
                <Field className='gap-1.5'>
                  <FieldLabel htmlFor='channel-billing-profile-label-en'>
                    {t('English label')}
                  </FieldLabel>
                  <Input
                    id='channel-billing-profile-label-en'
                    value={selected.label?.en || ''}
                    onChange={(event) =>
                      updateSelected({
                        label: { ...selected.label, en: event.target.value },
                      })
                    }
                    placeholder='Long-context pricing'
                  />
                </Field>
              </FieldGroup>
              <Alert>
                <AlertDescription className='text-xs'>
                  {t(
                    'The visual editor writes the billing expression automatically. Switch to JSON editor for advanced request rules or custom expressions.'
                  )}
                </AlertDescription>
              </Alert>
              <TieredPricingEditor
                key={`${selected.modelName}-${selectedIndex}`}
                modelName={selected.modelName}
                billingExpr={selected.billing_expr}
                requestRuleExpr={selected.requestRuleExpr}
                onBillingExprChange={(billing_expr) =>
                  updateSelected({ billing_expr })
                }
                onRequestRuleExprChange={(requestRuleExpr) =>
                  updateSelected({ requestRuleExpr })
                }
              />
            </div>
          ) : (
            <div className='bg-muted/20 flex min-h-64 items-center justify-center rounded-md border p-6 text-center'>
              <div className='space-y-2'>
                <p className='font-medium'>
                  {t('No channel profiles configured.')}
                </p>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Add a profile to customize the price for a model on this channel.'
                  )}
                </p>
                <Button type='button' variant='outline' onClick={addProfile}>
                  <Plus data-icon='inline-start' />
                  {t('Add profile')}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value='json' className='p-4'>
          <Field className='gap-2'>
            <FieldLabel>{t('Billing profiles JSON')}</FieldLabel>
            <FieldDescription>
              {t('Use JSON mode for importing or editing advanced profiles.')}
            </FieldDescription>
            <JsonCodeEditor
              value={rawJson}
              onChange={setRawJson}
              heightClassName='h-[calc(74vh-11rem)] min-h-80 max-h-[calc(74vh-11rem)]'
              ariaLabel={t('Billing profiles JSON')}
            />
          </Field>
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
