/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ChannelBillingProfileDialog } from '../channel-billing-profile-dialog'

vi.mock('@/components/json-code-editor', () => ({
  JsonCodeEditor: (props: {
    value: string
    onChange: (value: string) => void
  }) => (
    <textarea
      aria-label='Billing profiles JSON'
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/features/system-settings/models/tiered-pricing-editor', () => ({
  TieredPricingEditor: (props: { modelName?: string }) => (
    <div data-testid='tiered-pricing-editor'>{props.modelName}</div>
  ),
}))

const existingProfile = {
  'gpt-test': {
    key: 'standard',
    label: { zh: '标准', en: 'Standard' },
    billing_mode: 'tiered_expr' as const,
    billing_expr: 'tier("base", p * 2 + c * 8)',
  },
}

describe('channel billing profile dialog', () => {
  test('saves an existing visual profile and exposes the selected model editor', async () => {
    const onSave = vi.fn()

    render(
      <ChannelBillingProfileDialog
        open
        onOpenChange={vi.fn()}
        modelOptions={['gpt-test', 'claude-test']}
        value={existingProfile}
        onSave={onSave}
      />
    )

    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByTestId('tiered-pricing-editor')).toHaveTextContent(
      'gpt-test'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onSave).toHaveBeenCalledWith(existingProfile)
  })

  test('selects the next available model when adding a profile', async () => {
    render(
      <ChannelBillingProfileDialog
        open
        onOpenChange={vi.fn()}
        modelOptions={['gpt-test', 'claude-test']}
        value={existingProfile}
        onSave={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    expect(screen.getByTestId('tiered-pricing-editor')).toHaveTextContent(
      'claude-test'
    )
    expect(screen.getByDisplayValue('claude-test-profile')).toBeVisible()
  })

  test('switches to visual mode for valid JSON before profile metadata is complete', () => {
    render(
      <ChannelBillingProfileDialog
        open
        onOpenChange={vi.fn()}
        modelOptions={['gpt-test']}
        value={existingProfile}
        onSave={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'JSON editor' }))
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Billing profiles JSON' }),
      {
        target: {
          value: JSON.stringify({
            'gpt-test': {
              key: 'gpt-6-profile',
              billing_mode: 'tiered_expr',
              billing_expr: 'tier("base", p * 0 + c * 0)',
            },
          }),
        },
      }
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Visual editor' }))

    expect(screen.getByTestId('tiered-pricing-editor')).toHaveTextContent(
      'gpt-test'
    )
    expect(screen.getByLabelText('Chinese label')).toHaveValue('')
  })
})
