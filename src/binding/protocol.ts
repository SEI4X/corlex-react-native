import { byteLength, isRecord } from '#core'
import type { ConsentState, PrivacyRead } from '#core'
import { STATE_MAX_BYTES, stateValueAllowed } from '../state-budget'

export interface StateModule {
  sdkCapabilities(): { protectedStorage?: number; crashBinding?: number }
  currentSdkPrivacy(): string
  readBoundSdkState(owner: string): Promise<string>
  exchangeSdkState(command: string): Promise<string>
  revokeSdkPrivacy(expected: string, record: string): string
  observeSdkCeiling(expected: string, ceiling: ConsentState): string
  selectSdkScope(owner: string, generation: string): void
}
export function stateModule(value: unknown): StateModule | undefined {
  try {
    if (!isRecord(value)) return undefined
    const methods = [
      'sdkCapabilities',
      'currentSdkPrivacy',
      'readBoundSdkState',
      'exchangeSdkState',
      'revokeSdkPrivacy',
      'selectSdkScope',
      'observeSdkCeiling',
    ]
    if (!methods.every((name) => typeof value[name] === 'function')) return undefined
    const module = value as unknown as StateModule
    return module.sdkCapabilities().protectedStorage === 2 ? module : undefined
  } catch {
    return undefined
  }
}
export const choice = (v: unknown): ConsentState | undefined =>
  v === 'pending' || v === 'granted' || v === 'denied' ? v : undefined
export function privacyOf(raw: unknown): PrivacyRead {
  if (raw === '') return { kind: 'missing' }
  if (typeof raw !== 'string' || raw.length > 256 || byteLength(raw) > 256)
    return { kind: 'unavailable' }
  try {
    const v: unknown = JSON.parse(raw)
    if (
      !isRecord(v) ||
      (Object.keys(v).length !== 2 && Object.keys(v).length !== 3) ||
      typeof v.generation !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.generation)
    )
      return { kind: 'unavailable' }
    const state = choice(v.state),
      sdk = Object.hasOwn(v, 'sdkChoice')
        ? choice(v.sdkChoice)
        : Object.keys(v).length === 2
          ? state
          : undefined
    const rank = { denied: 0, pending: 1, granted: 2 }
    if (!state || !sdk || rank[state] > rank[sdk]) return { kind: 'unavailable' }
    return state ? { kind: 'valid', generation: v.generation, state } : { kind: 'unavailable' }
  } catch {
    return { kind: 'unavailable' }
  }
}
export function sdkChoiceOf(raw: string | undefined): ConsentState | undefined {
  if (privacyOf(raw).kind !== 'valid' || !raw) return undefined
  const value = JSON.parse(raw)
  return choice(value.sdkChoice ?? value.state)
}
export interface Snapshot {
  raw: string
  privacy: PrivacyRead
  rows: Record<string, string>
  legacyChoice?: ConsentState
  explicitChoice?: ConsentState
}
export function snapshotOf(raw: string, owner: string): Snapshot {
  if (raw.length > STATE_MAX_BYTES + 1024 || byteLength(raw) > STATE_MAX_BYTES + 1024)
    throw new Error('state_invalid')
  let quoted = false,
    escaped = false,
    depth = 0
  for (const char of raw) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') {
      if (++depth > 2) throw new Error('state_invalid')
    } else if (char === '}') {
      if (--depth < 0) throw new Error('state_invalid')
    } else if (char === '[' || char === ']') throw new Error('state_invalid')
  }
  if (depth !== 0 || quoted) throw new Error('state_invalid')
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || typeof value.privacy !== 'string' || !isRecord(value.rows))
    throw new Error('state_invalid')
  const privacy = privacyOf(value.privacy),
    rows: Record<string, string> = {}
  const entries = Object.entries(value.rows)
  if (entries.length > 5) throw new Error('state_invalid')
  const prefix = privacy.kind === 'valid' ? `s:${owner}:${privacy.generation}:` : ''
  for (const [physical, item] of entries) {
    const key = physical.slice(prefix.length)
    if (
      !prefix ||
      !physical.startsWith(prefix) ||
      typeof item !== 'string' ||
      !stateValueAllowed(key, item) ||
      privacy.kind !== 'valid' ||
      privacy.state !== 'granted'
    )
      throw new Error('state_invalid')
    rows[key] = item
  }
  const legacy = choice(value.legacyChoice)
  return {
    raw: value.privacy,
    privacy,
    rows,
    ...(choice(value.explicitChoice)
      ? { explicitChoice: choice(value.explicitChoice) as ConsentState }
      : {}),
    ...(legacy === 'denied' || legacy === 'pending' ? { legacyChoice: legacy } : {}),
  }
}
