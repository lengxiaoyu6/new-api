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
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { UpstreamModelSelection } from './upstream-model-selection'

type ChannelGroupModelsProps = {
  groups: string[]
  models: string[]
  value: Record<string, string[]>
  onChange: (value: Record<string, string[]>) => void
  disabled?: boolean
}

export function ChannelGroupModels(props: ChannelGroupModelsProps) {
  const { t } = useTranslation()
  const id = useId()

  return (
    <fieldset disabled={props.disabled} className='min-w-0 space-y-4'>
      <legend className='mb-2 text-sm font-medium'>
        {t('Group model access')}
      </legend>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Choose models for each group. Unrestricted groups use all channel models.'
        )}
      </p>
      {props.groups.map((group, index) => {
        const restricted = Object.hasOwn(props.value, group)
        const selected = (restricted ? props.value[group] : []).filter(
          (model) => props.models.includes(model)
        )
        const switchId = `${id}-${index}`
        return (
          <div
            key={group}
            role='group'
            aria-label={t('Models for {{group}}', { group })}
            className='min-w-0 space-y-3 rounded-lg border p-3'
          >
            <div className='flex items-center justify-between gap-3'>
              <Label htmlFor={switchId} className='min-w-0 break-all'>
                {t('Limit models for {{group}}', { group })}
              </Label>
              <Switch
                id={switchId}
                disabled={props.disabled}
                checked={restricted}
                onCheckedChange={(checked) => {
                  if (checked) {
                    props.onChange({ ...props.value, [group]: [] })
                    return
                  }
                  const next = { ...props.value }
                  delete next[group]
                  props.onChange(next)
                }}
              />
            </div>
            {restricted ? (
              <>
                {selected.length === 0 && (
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'No models selected. This channel will not serve this group.'
                    )}
                  </p>
                )}
                <UpstreamModelSelection
                  models={props.models}
                  selected={selected}
                  existingModels={props.models}
                  showChanges={false}
                  disabled={props.disabled}
                  summaryText={t('Select models')}
                  onChange={(models) =>
                    props.onChange({ ...props.value, [group]: models })
                  }
                />
              </>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('All channel models')}
              </p>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
