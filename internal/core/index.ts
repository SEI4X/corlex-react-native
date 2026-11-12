export { CorlexCore } from './client'
export type { CaptureMeta } from './client'
export { Identity, ANON_KEY, USER_KEY } from './identity'
export {
  EVENT_EXPOSURE,
  EVENT_IDENTIFY,
  EVENT_USER_PROPS,
  MAX_ARRAY,
  MAX_BATCH_EVENTS,
  MAX_PROPERTY_STRING,
  MAX_CONTEXT,
  EVENT_CRASH,
  MAX_ID,
  MAX_EVENT_BYTES,
  MAX_PROPERTIES,
  NAME_PATTERN,
} from './limits'
export type { Platform, PlatformHost, PlatformStores } from './platform'
export { sanitizeProperties } from './properties'
export { EventQueue, MAX_QUEUE, QUEUE_KEY } from './queue'
export { Sender, backoffDelay, parseRetryAfter } from './sender'
export type { FlushOptions, SenderOptions } from './sender'
export { MemoryStore } from './store'
export type { KeyValueStore } from './store'
export type {
  BaseInitOptions,
  CorlexApi,
  ConfigApi,
  ConfigJson,
  ConfigOptions,
  ConfigUpdate,
  ConsentState,
  ExperimentAssignment,
  Properties,
  WireContext,
  WireEvent,
} from './types'
export { parseJsStack, stripUrlQueries } from './stack'
export type { JsFrame } from './stack'
export { byteLength, isRecord, truncateBytes, uuid } from './util'
export { CONFIG_KEY, RemoteConfig } from './config/remote-config'
export { EXPOSURE_KEY } from './config/exposure'

export type { SDKRequest, SDKRequestOptions, SDKResponse } from './request'

export { isSdkKey } from './key'

export { exactUtf8 } from './capture-meta'

export { errorDetails, safeErrorReport, safeJsFrames } from './error-privacy'

export { BindingController, initialConsent } from './binding/controller'
export { bindingDigest } from './binding/digest'
export type { BindingInput } from './binding/digest'
export type { BindingDriver, BindingOptions, BoundScope, PrivacyRead } from './binding/types'
