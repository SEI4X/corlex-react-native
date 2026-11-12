import { captureContext, captureProperties, type CaptureMeta } from './capture-meta'
import { MAX_PROPERTIES } from './limits'
import { sanitizeProperties } from './properties'
import { uuid } from './util'
import type { Identity } from './identity'
import type { Properties, WireContext, WireEvent } from './types'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function buildEvent(input: {
  identity: Identity
  name: string
  properties: Properties | undefined
  meta: CaptureMeta
  context: WireContext
  extras: Properties
}): WireEvent {
  const { identity, name, meta } = input
  const own = captureProperties(input.properties, meta)
  for (const [key, value] of Object.entries(sanitizeProperties(input.extras))) {
    if (Object.keys(own).length >= MAX_PROPERTIES) break
    if (!(key in own)) own[key] = value
  }
  const event: WireEvent = {
    event_id: meta.eventId !== undefined && UUID.test(meta.eventId) ? meta.eventId : uuid(),
    name,
    timestamp: meta.timestamp ?? new Date().toISOString(),
    anonymous_id: identity.anonymousId,
    properties: own,
    context: captureContext(input.context, meta),
  }
  if (identity.userId !== undefined) event.user_id = identity.userId
  return event
}
