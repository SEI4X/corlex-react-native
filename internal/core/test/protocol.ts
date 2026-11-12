// An independent TypeScript copy of the rules in
// services/ingest/internal/event/validate.go. If the Go limits change, update
// this file together with docs/protocol.md; the SDK tests then fail on drift.

const PLATFORMS = ['ios', 'android', 'web', 'react-native', 'flutter']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME = /^[a-z0-9_.:-]{1,128}$/
const bytes = (s: string): number => new TextEncoder().encode(s).length

function validValue(v: unknown, depth: number): boolean {
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return true
  if (typeof v === 'string') return bytes(v) <= 1024
  if (Array.isArray(v)) {
    if (v.length > 100 || depth + 1 > 4) return false
    return v.every((e) => validValue(e, depth + 1))
  }
  if (typeof v === 'object') return validObject(v as Record<string, unknown>, depth + 1)
  return false
}

function validObject(obj: Record<string, unknown>, depth: number): boolean {
  if (depth > 4) return false
  return Object.entries(obj).every(([k, v]) => k !== '' && bytes(k) <= 128 && validValue(v, depth))
}

function validContext(c: Record<string, unknown>): boolean {
  if (c['platform'] !== undefined && !PLATFORMS.includes(String(c['platform']))) return false
  const sdk = (c['sdk'] ?? {}) as Record<string, unknown>
  const fields = [c['app_version'], c['os'], c['os_version'], c['device_model'], c['locale']]
  fields.push(sdk['name'], sdk['version'])
  return fields.every((f) => f === undefined || (typeof f === 'string' && bytes(f) <= 128))
}

/** The rejection reason ingest would give, or '' when the event is valid. */
export function rejectionReason(e: Record<string, unknown>, now = new Date()): string {
  const id = e['event_id']
  if (id !== undefined && !(typeof id === 'string' && id.length === 36 && UUID.test(id))) {
    return 'event_id_invalid'
  }
  if (typeof e['name'] !== 'string' || !NAME.test(e['name'])) return 'name_invalid'
  const ts = typeof e['timestamp'] === 'string' ? Date.parse(e['timestamp']) : NaN
  const dayMs = 24 * 60 * 60 * 1000
  if (Number.isNaN(ts) || ts < Date.UTC(2000, 0, 1) || ts > now.getTime() + dayMs) {
    return 'timestamp_invalid'
  }
  const user = (e['user_id'] ?? '') as string
  const anon = (e['anonymous_id'] ?? '') as string
  if (user === '' && anon === '') return 'identity_missing'
  if (bytes(user) > 256 || bytes(anon) > 256) return 'identity_invalid'
  const props = (e['properties'] ?? {}) as Record<string, unknown>
  if (Object.keys(props).length > 100 || !validObject(props, 1)) return 'properties_invalid'
  if (e['context'] && !validContext(e['context'] as Record<string, unknown>)) {
    return 'context_invalid'
  }
  return bytes(JSON.stringify(e)) > 32768 ? 'event_too_large' : ''
}

export const MAX_EVENTS_PER_BATCH = 500
