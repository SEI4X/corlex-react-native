import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectedTypes, mergePrivacyManifest } from '../plugin'
import { SDK_VERSION } from '../version'

describe('config plugin', () => {
  it('declares linkable analytics and user IDs without cross-company tracking', () => {
    const types = collectedTypes(true)
    expect(types.map((t) => t.NSPrivacyCollectedDataType)).toEqual([
      'NSPrivacyCollectedDataTypeProductInteraction',
      'NSPrivacyCollectedDataTypeDeviceID',
      'NSPrivacyCollectedDataTypeUserID',
      'NSPrivacyCollectedDataTypeCrashData',
    ])
    for (const t of types) {
      expect(t.NSPrivacyCollectedDataTypeLinked).toBe(true)
      expect(t.NSPrivacyCollectedDataTypeTracking).toBe(false)
    }
  })

  it('matches the reviewed SDK-only collection baseline', () => {
    const baseline = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures/privacy-baseline.json'), 'utf8'),
    ) as { NSPrivacyCollectedDataTypes: unknown[] }
    expect(collectedTypes(true)).toEqual(baseline.NSPrivacyCollectedDataTypes)
  })

  it('native-only opt-out does not omit the remaining JS crash capability', () => {
    expect(collectedTypes(false)).toHaveLength(4)
  })

  it('upgrades linkability and unions purposes without downgrading host tracking or extras', () => {
    const existing = {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypeTracking: true,
      NSPrivacyCollectedDataTypePurposes: ['host-purpose'],
      custom: 'keep',
    }
    const config = {
      name: 'demo',
      slug: 'demo',
      ios: {
        privacyManifests: { NSPrivacyTracking: true, NSPrivacyCollectedDataTypes: [existing] },
      },
    }
    const merged = mergePrivacyManifest(config, {}).ios?.privacyManifests as Record<string, unknown>
    expect(merged['NSPrivacyTracking']).toBe(true)
    expect((merged['NSPrivacyCollectedDataTypes'] as Record<string, unknown>[])[0]).toMatchObject({
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: true,
      custom: 'keep',
      NSPrivacyCollectedDataTypePurposes: [
        'host-purpose',
        'NSPrivacyCollectedDataTypePurposeAnalytics',
      ],
    })
  })

  it('keeps what the app already declares and adds each type once', () => {
    const existing = {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    }
    const config = {
      name: 'demo',
      slug: 'demo',
      ios: {
        bundleIdentifier: 'app.demo',
        privacyManifests: { NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [existing] },
      },
    }
    const merged = mergePrivacyManifest(config, {})
    const manifest = merged.ios?.privacyManifests as Record<string, unknown>
    const types = manifest['NSPrivacyCollectedDataTypes'] as {
      NSPrivacyCollectedDataType: string
    }[]
    expect(types).toHaveLength(4)
    expect(types[0]).toMatchObject({
      ...existing,
      NSPrivacyCollectedDataTypePurposes: [
        'NSPrivacyCollectedDataTypePurposeAppFunctionality',
        'NSPrivacyCollectedDataTypePurposeAnalytics',
      ],
    })
    expect(manifest['NSPrivacyTracking']).toBe(false)
    expect(merged.ios?.bundleIdentifier).toBe('app.demo')
    expect(mergePrivacyManifest(merged, {}).ios?.privacyManifests).toEqual(manifest)
  })
})

describe('package', () => {
  it('SDK_VERSION equals the version in package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
    ) as {
      version: string
    }
    expect(SDK_VERSION).toBe(pkg.version)
  })
})
