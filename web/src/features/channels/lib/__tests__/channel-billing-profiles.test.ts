/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  createEmptyChannelBillingProfile,
  normalizeChannelBillingProfile,
  parseChannelBillingProfiles,
  serializeChannelBillingProfiles,
  validateChannelBillingProfileDrafts,
  validateChannelBillingProfilesObject,
} from '../channel-billing-profiles'

describe('channel billing profile editor data', () => {
  test('splits and recombines request rules while preserving profile metadata', () => {
    const parsed = parseChannelBillingProfiles({
      'gpt-test': {
        key: 'fast',
        label: { zh: '快速', en: 'Fast' },
        billing_mode: 'tiered_expr',
        billing_expr:
          'tier("base", p * 2 + c * 8) * (param("service_tier") == "fast" ? 2 : 1)',
      },
    })

    assert.equal(parsed[0]?.billing_expr, 'tier("base", p * 2 + c * 8)')
    assert.equal(
      parsed[0]?.requestRuleExpr,
      '(param("service_tier") == "fast" ? 2 : 1)'
    )

    const serialized = serializeChannelBillingProfiles(parsed)
    assert.equal(serialized['gpt-test']?.key, 'fast')
    assert.match(serialized['gpt-test']?.billing_expr ?? '', /service_tier/)
  })

  test('creates a usable zero-price draft for a selected model', () => {
    const profile = createEmptyChannelBillingProfile('provider/gpt:test')
    assert.equal(profile.modelName, 'provider/gpt:test')
    assert.equal(profile.key, 'provider-gpt-test-profile')
    assert.equal(profile.billing_mode, 'tiered_expr')
    assert.ok(profile.billing_expr.includes('tier('))
  })

  test('trims labels and combines the visual expression with request rules', () => {
    const profile = normalizeChannelBillingProfile({
      ...createEmptyChannelBillingProfile('gpt-test'),
      key: ' fast ',
      label: { zh: ' 快速 ', en: '' },
      billing_expr: 'tier("base", p * 2 + c * 8)',
      requestRuleExpr: '(header("x-tier") == "fast" ? 2 : 1)',
    })

    assert.equal(profile.key, 'fast')
    assert.equal(profile.label?.zh, '快速')
    assert.equal(profile.label?.en, undefined)
    assert.match(profile.billing_expr, /x-tier/)
  })

  test('keeps malformed JSON profile values editable so visual validation can report them', () => {
    const parsed = parseChannelBillingProfiles({ 'gpt-test': null })

    assert.equal(parsed[0]?.modelName, 'gpt-test')
    assert.equal(
      validateChannelBillingProfileDrafts(parsed),
      'Every billing profile needs a profile key.'
    )
  })

  test('rejects non-tiered billing profiles in JSON mode', () => {
    assert.equal(
      validateChannelBillingProfilesObject({
        'gpt-test': {
          key: 'standard',
          label: { en: 'Standard' },
          billing_mode: 'ratio',
          billing_expr: 'tier("base", p * 2 + c * 8)',
        },
      }),
      'The model must already use tiered expression pricing at the model level.'
    )
  })
})
