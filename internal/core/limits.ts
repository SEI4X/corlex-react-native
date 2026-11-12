// Mirrors services/ingest/internal/event/validate.go and docs/protocol.md.
export const MAX_NAME = 128
export const MAX_ID = 256
export const MAX_CONTEXT = 128
export const MAX_PROPERTIES = 100
export const MAX_PROPERTY_KEY = 128
export const MAX_PROPERTY_STRING = 1024
export const MAX_ARRAY = 100
export const MAX_DEPTH = 4
export const MAX_BATCH_EVENTS = 500
export const MAX_EVENT_BYTES = 32_768

/** Reserved events the SDK emits for identity; see docs/protocol.md. */
export const EVENT_IDENTIFY = 'corlex.identify'
export const EVENT_USER_PROPS = 'corlex.user_props'
/** An A/B test variant was shown to the person (properties `experiment` and `variant`). */
export const EVENT_EXPOSURE = 'corlex.exposure'

export const NAME_PATTERN = /^[a-z0-9_.:-]{1,128}$/

/**
 * A crash or an unhandled error in an app (JS or native). Properties: `crash_id`, `kind` (`js` or
 * `native`), `fatal`, `name`, `message`, `frames`. Grouped and symbolicated by task #37.
 */
export const EVENT_CRASH = 'corlex.crash'
