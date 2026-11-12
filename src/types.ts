import type { BaseInitOptions } from '#core'

export type {
  CorlexApi,
  ConfigApi,
  ConfigJson,
  ConfigOptions,
  ConfigUpdate,
  ConsentState,
  ExperimentAssignment,
  Properties,
} from '#core'

/** Which automatic events and collectors are on. Every part is on by default. */
export interface AutocaptureOptions {
  /** `app_open` at each launch. */
  appOpen?: boolean
  /** `app_background` and `app_foreground`. */
  lifecycle?: boolean
  /** JS errors and unhandled promise rejections as `corlex.crash`. */
  crashes?: boolean
  /** Native crashes (needs a development/production build, not Expo Go). */
  nativeCrashes?: boolean
}

export interface InitOptions extends Omit<BaseInitOptions, 'consent'> {
  /**
   * `granted` (default): collect at once, for apps that ask for consent themselves.
   * `pending`: nothing is stored or sent until `optIn()`.
   * `att` (iOS): follow App Tracking Transparency, without ever showing its prompt: not yet asked
   * is `pending`, allowed is `granted`, denied or restricted is `denied`. The app asks when it
   * wants to; the SDK re-reads the answer when the app returns to the foreground.
   */
  consent?: 'granted' | 'pending' | 'att'
  /** `true` (default) collects everything, `false` nothing, or pick parts. */
  autocapture?: boolean | AutocaptureOptions
}
