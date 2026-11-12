import { byteLength } from '#core'

export const STATE_MAX_BYTES = 8 * 1024 * 1024
const LIMITS: Record<string, number> = {
  corlex_aid: 4096,
  corlex_uid: 4096,
  corlex_consent: 16,
  corlex_queue: 2 * 1024 * 1024,
  corlex_cfg: 1024 * 1024 + 1024,
}
export function stateValueAllowed(key: string, value: string): boolean {
  const max = Object.hasOwn(LIMITS, key) ? LIMITS[key] : undefined
  return max !== undefined && value.length <= max && byteLength(value) <= max
}
export function readState(raw: string): Record<string, string> {
  if (raw.length > STATE_MAX_BYTES || byteLength(raw) > STATE_MAX_BYTES) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    const rows = Object.entries(value)
    return rows.every(([key, item]) => typeof item === 'string' && stateValueAllowed(key, item))
      ? Object.fromEntries(rows)
      : {}
  } catch {
    return {}
  }
}
