import { MAX_EVENT_BYTES, MAX_ID, MAX_NAME, NAME_PATTERN } from './limits'
import type { WireEvent } from './types'
import { byteLength, isRecord } from './util'

export const MAX_QUEUE_BYTES = 2 * 1024 * 1024
/** A queue has its own budget: a valid 1000-event cache can exceed the config's key count. */
function bounded(text: string): boolean {
  if (text.length > MAX_QUEUE_BYTES || byteLength(text) > MAX_QUEUE_BYTES) return false
  let quoted = false,
    escaped = false,
    depth = 0
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') {
      if (++depth > 8) return false
    } else if (char === '}' || char === ']') {
      if (--depth < 0) return false
    }
  }
  return depth === 0 && !quoted
}
function text(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
function event(value: unknown): value is WireEvent {
  if (!isRecord(value) || !text(value.event_id) || !text(value.name, MAX_NAME)) return false
  if (
    !NAME_PATTERN.test(value.name) ||
    !text(value.timestamp, 128) ||
    !Number.isFinite(Date.parse(value.timestamp))
  )
    return false
  if (!isRecord(value.properties) || !isRecord(value.context) || !text(value.context.platform))
    return false
  if (
    !isRecord(value.context.sdk) ||
    !text(value.context.sdk.name) ||
    !text(value.context.sdk.version)
  )
    return false
  for (const key of ['anonymous_id', 'user_id'])
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || byteLength(value[key]) > MAX_ID)
    )
      return false
  return byteLength(JSON.stringify(value)) <= MAX_EVENT_BYTES
}
export function readQueue(text: string): WireEvent[] | undefined {
  if (!bounded(text)) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) && value.every(event) ? value : undefined
  } catch {
    return undefined
  }
}
export function eventBytes(event: WireEvent): number {
  return byteLength(JSON.stringify(event))
}
export function queueBytes(items: readonly WireEvent[]): number {
  return 2 + items.reduce((sum, item) => sum + eventBytes(item), 0) + Math.max(0, items.length - 1)
}
