import type { BindingController } from './binding/controller'
import type { SDKRequest } from './request'
import type { CaptureMeta } from './client'
import type { FlushOptions } from './sender'
import type { KeyValueStore } from './store'
import type { BaseInitOptions, ConsentState, Properties, WireContext } from './types'

export interface PlatformStores {
  /** The queue, the saved config and the consent choice: survives restarts. */
  persistent: KeyValueStore
  /** The anonymous and user ids. Same lifetime as `persistent`; apart so the web can add a cookie. */
  identity: KeyValueStore
  /** What is remembered for one session only (exposures). */
  session: KeyValueStore
}

/** What the platform part may ask of the SDK that hosts it. */
export interface PlatformHost {
  track(name: string, properties?: Properties): void
  capture(name: string, properties: Properties | undefined, meta: CaptureMeta): void
  flush(options?: FlushOptions): Promise<void>
  consent(): ConsentState
}

/**
 * Everything that differs between the browser and an app. The core (`CorlexCore`) owns the event
 * model, consent, queue, delivery and Remote Config; a platform supplies storage, context,
 * lifecycle hooks and automatic events.
 */
export interface Platform<O extends BaseInitOptions> {
  bind?(options: O, invalidate: () => void): BindingController | undefined
  request?: SDKRequest
  /** `web`, `react-native`: the `context.platform` value and the Remote Config platform. */
  readonly name: string
  readonly stores: PlatformStores
  /** Browsers only: send with `fetch` `keepalive`. */
  readonly keepalive: boolean
  /** The `context` of every event. */
  context(): WireContext
  /** Properties added to every event (the caller's own keys win), e.g. the page URL on the web. */
  eventProperties(): Properties
  /** A system-level "do not collect" signal (DNT, GPC) that beats `optIn()`. */
  isBlocked(options: O): boolean
  /** Starts listeners and automatic events. The result stops them. */
  start(options: O, host: PlatformHost, granted: boolean): () => void
  /** Consent arrived after start: write what was held back. */
  onConsentGranted(): void
  /** Opt-out: remove what the platform stored. */
  onOptOut(): void
}
