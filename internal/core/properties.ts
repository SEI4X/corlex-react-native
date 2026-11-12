import {
  MAX_ARRAY,
  MAX_DEPTH,
  MAX_PROPERTIES,
  MAX_PROPERTY_KEY,
  MAX_PROPERTY_STRING,
} from './limits'
import { isRecord, truncateBytes } from './util'
import type { Properties } from './types'

/**
 * Makes a value fit the protocol: long strings are cut, what cannot be
 * represented (functions, symbols, too deep nesting) is dropped.
 * `depth` follows the Go validator: `properties` itself is level 1, and an
 * array counts as a level.
 */
function clean(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return truncateBytes(value, MAX_PROPERTY_STRING)
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (Array.isArray(value)) return cleanArray(value, depth)
  if (isRecord(value)) return depth + 1 > MAX_DEPTH ? undefined : cleanObject(value, depth + 1)
  return undefined
}

function cleanArray(items: unknown[], depth: number): unknown[] | undefined {
  if (depth + 1 > MAX_DEPTH) return undefined
  return items
    .slice(0, MAX_ARRAY)
    .map((item) => clean(item, depth + 1))
    .map((item) => (item === undefined ? null : item))
}

function cleanObject(obj: Record<string, unknown>, depth: number): Properties {
  const out: Properties = {}
  let count = 0
  for (const [rawKey, raw] of Object.entries(obj)) {
    const key = truncateBytes(rawKey, MAX_PROPERTY_KEY)
    if (key === '' || count >= MAX_PROPERTIES) continue
    const value = clean(raw, depth)
    if (value === undefined) continue
    out[key] = value
    count += 1
  }
  return out
}

/** Properties the protocol accepts, from anything a caller may pass. */
export function sanitizeProperties(input: unknown): Properties {
  return isRecord(input) ? cleanObject(input, 1) : {}
}
