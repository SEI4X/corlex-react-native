import type { PlatformStores } from '../platform'
import type { ConsentState } from '../types'

export type PrivacyRead =
  | { kind: 'valid'; generation: string; state: ConsentState }
  | { kind: 'missing' }
  | { kind: 'unavailable' }

/** Drivers bind every physical record to this owner and generation before exposing stores. */
export interface BoundScope {
  owner: string
  generation: string
  privacy: PrivacyRead
  choice?: ConsentState
  stores: PlatformStores
  persistent: boolean
}

export interface BindingDriver {
  /** Fresh synchronous Web read, or the latest preloaded/subscribed native snapshot. */
  current(): PrivacyRead
  /** Native reads must refresh the snapshot before resolving. Called before every request. */
  fresh(): PrivacyRead | Promise<PrivacyRead>
  /** Expected-generation CAS. Success requires choice: granted; failed CAS must keep its actual choice. */
  grant(input: { owner: string; expected: PrivacyRead }): BoundScope | Promise<BoundScope>
  /** Changes the global fence and wipes all SDK-owned scopes, never unrelated app data. */
  revoke(input: { expected: PrivacyRead }): void | Promise<void>
}

export interface BindingOptions {
  owner: string
  scope: BoundScope
  requested: ConsentState
  driver: BindingDriver
  onInvalidate(): void
}
