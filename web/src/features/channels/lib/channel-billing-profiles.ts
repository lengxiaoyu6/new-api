/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
import {
  combineBillingExpr,
  splitBillingExprAndRequestRules,
} from '@/features/pricing/lib/billing-expr'

import type { ChannelBillingProfile } from '../types'

export type ChannelBillingProfileDraft = ChannelBillingProfile & {
  modelName: string
  requestRuleExpr: string
}

const PROFILE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getLabel(value: unknown): { zh: string; en: string } {
  if (!isRecord(value)) return { zh: '', en: '' }
  return {
    zh: getString(value.zh),
    en: getString(value.en),
  }
}

function getDefaultProfileKey(modelName: string): string {
  const suffix = '-profile'
  const normalizedModelName = modelName
    .trim()
    .replaceAll(/[^A-Za-z0-9_.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64 - suffix.length)
  return `${normalizedModelName || 'model'}${suffix}`
}

export function parseChannelBillingProfilesJson(
  value: string | undefined
): Record<string, unknown> | null {
  if (!value?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function createEmptyChannelBillingProfile(
  modelName: string
): ChannelBillingProfileDraft {
  return {
    modelName,
    key: getDefaultProfileKey(modelName),
    label: { zh: '', en: '' },
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", p * 0 + c * 0)',
    requestRuleExpr: '',
  }
}

export function parseChannelBillingProfiles(
  profiles: Record<string, unknown>
): ChannelBillingProfileDraft[] {
  return Object.entries(profiles).map(([modelName, profile]) => {
    const profileValue = isRecord(profile) ? profile : {}
    const label = getLabel(profileValue.label)
    const split = splitBillingExprAndRequestRules(
      getString(profileValue.billing_expr)
    )
    return {
      modelName,
      key: getString(profileValue.key),
      label,
      billing_mode: 'tiered_expr',
      billing_expr: split.billingExpr,
      requestRuleExpr: split.requestRuleExpr,
    }
  })
}

export function validateChannelBillingProfileDrafts(
  entries: ChannelBillingProfileDraft[]
): string | null {
  const modelNames = new Set<string>()
  for (const entry of entries) {
    const modelName = entry.modelName.trim()
    if (!modelName || /[*?]/.test(modelName)) {
      return 'Every billing profile needs a model name.'
    }
    if (modelNames.has(modelName)) {
      return 'Each model can have only one channel billing profile.'
    }
    modelNames.add(modelName)

    const key = entry.key.trim()
    if (!key) return 'Every billing profile needs a profile key.'
    if (!PROFILE_KEY_PATTERN.test(key)) {
      return 'Profile keys may contain only letters, numbers, dots, hyphens, and underscores.'
    }
    if (!entry.label?.zh?.trim() && !entry.label?.en?.trim()) {
      return 'Every billing profile needs a Chinese or English label.'
    }
    if (!entry.billing_expr.trim()) {
      return 'Every billing profile needs a billing expression.'
    }
  }
  return null
}

export function validateChannelBillingProfilesObject(
  value: unknown
): string | null {
  if (!isRecord(value)) return 'Please fix JSON errors before saving'

  for (const modelName of Object.keys(value)) {
    if (!modelName.trim() || /[*?]/.test(modelName)) {
      return 'Every billing profile needs a model name.'
    }
  }

  for (const profileValue of Object.values(value)) {
    if (!isRecord(profileValue)) {
      return 'Every billing profile needs a profile key.'
    }
    if (profileValue.billing_mode !== 'tiered_expr') {
      return 'The model must already use tiered expression pricing at the model level.'
    }
  }

  return validateChannelBillingProfileDrafts(parseChannelBillingProfiles(value))
}

export function normalizeChannelBillingProfilesObject(
  value: Record<string, unknown>
): Record<string, ChannelBillingProfile> {
  return Object.fromEntries(
    Object.entries(value).map(([modelName, profileValue]) => {
      const profile = isRecord(profileValue) ? profileValue : {}
      const label = getLabel(profile.label)
      const normalizedProfile: ChannelBillingProfile = {
        key: getString(profile.key).trim(),
        ...(label.zh.trim() || label.en.trim()
          ? {
              label: {
                ...(label.zh.trim() ? { zh: label.zh.trim() } : {}),
                ...(label.en.trim() ? { en: label.en.trim() } : {}),
              },
            }
          : {}),
        billing_mode: 'tiered_expr',
        billing_expr: getString(profile.billing_expr).trim(),
      }
      return [modelName.trim(), normalizedProfile] as const
    })
  )
}

export function normalizeChannelBillingProfile(
  profile: ChannelBillingProfileDraft
): ChannelBillingProfile {
  const zhLabel = profile.label?.zh?.trim() || ''
  const enLabel = profile.label?.en?.trim() || ''
  const label = {
    ...(zhLabel ? { zh: zhLabel } : {}),
    ...(enLabel ? { en: enLabel } : {}),
  }
  return {
    key: profile.key.trim(),
    ...(zhLabel || enLabel ? { label } : {}),
    billing_mode: 'tiered_expr',
    billing_expr: combineBillingExpr(
      profile.billing_expr.trim(),
      profile.requestRuleExpr.trim()
    ),
  }
}

export function serializeChannelBillingProfiles(
  entries: ChannelBillingProfileDraft[]
): Record<string, ChannelBillingProfile> {
  return Object.fromEntries(
    entries
      .map(
        (entry) =>
          [
            entry.modelName.trim(),
            normalizeChannelBillingProfile(entry),
          ] as const
      )
      .filter(([modelName]) => Boolean(modelName))
  )
}
