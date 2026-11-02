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
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { createRenameGroupSchema } from '../lib/rename-group-schema'

type RenameGroupDialogProps = {
  groupName: string
  groupNames: string[]
  onRename: (oldName: string, newName: string) => Promise<void>
  onClose: () => void
}

export function RenameGroupDialog(props: RenameGroupDialogProps) {
  const { t } = useTranslation()
  const form = useForm({
    defaultValues: { name: '' },
    mode: 'onChange',
    resolver: zodResolver(
      createRenameGroupSchema(t, props.groupName, props.groupNames)
    ),
  })
  const submitting = form.formState.isSubmitting
  const submit = form.handleSubmit(async (values) => {
    try {
      await props.onRename(props.groupName, values.name)
      props.onClose()
    } catch (error) {
      form.setError('name', {
        message: getServerErrorMessage(error, t('Failed to rename group')),
      })
    }
  })

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) props.onClose()
      }}
      title={t('Rename group')}
      desc={t(
        'Rename "{{group}}" and update users, API keys, channels, subscriptions and group settings together. The previous name remains reserved for compatibility.',
        { group: props.groupName }
      )}
      isLoading={submitting}
      disabled={!form.formState.isValid}
      confirmText={submitting ? t('Renaming...') : t('Rename')}
      handleConfirm={() => void submit()}
    >
      <Form {...form}>
        <form onSubmit={submit}>
          <FormField
            control={form.control}
            name='name'
            render={({ field, fieldState }) => (
              <FormItem data-invalid={fieldState.invalid}>
                <FormLabel>{t('New group name')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoFocus
                    disabled={submitting}
                    aria-invalid={fieldState.invalid}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </ConfirmDialog>
  )
}
