import { MAX_CONTEXT } from './limits'
import { sanitizeProperties } from './properties'
import type { Properties, WireContext } from './types'
import { byteLength } from './util'
export interface CaptureMeta {
  timestamp?: string
  eventId?: string
  /** Original capture facts; an empty version/build explicitly means unknown. */
  platform?: 'ios' | 'android'
  appVersion?: string
  build?: string
}
export function exactUtf8(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.length > max || byteLength(value) > max) return false
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (char.length === 1 && code >= 0xd800 && code <= 0xdfff) return false
  }
  return true
}
export function captureContext(context: WireContext, meta: CaptureMeta): WireContext {
  const result = { ...context }
  if (meta.platform === 'ios' || meta.platform === 'android') result.platform = meta.platform
  if (meta.appVersion !== undefined) {
    if (meta.appVersion !== '' && exactUtf8(meta.appVersion, MAX_CONTEXT))
      result.app_version = meta.appVersion
    else Reflect.deleteProperty(result, 'app_version')
  }
  return result
}
export function captureProperties(raw: Properties | undefined, meta: CaptureMeta): Properties {
  const build = meta.build === undefined ? undefined : exactUtf8(meta.build, 32) ? meta.build : ''
  const out = sanitizeProperties({ ...(build === undefined ? {} : { build }), ...raw })
  if (build !== undefined) out['build'] = build
  return out
}
