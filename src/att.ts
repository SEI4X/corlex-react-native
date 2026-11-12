import type { ConsentState } from '#core'
import type { Runtime } from './runtime'

/**
 * `consent: 'att'` (docs: services/ingest/docs/protocol.md §4.1). The SDK reads the App Tracking
 * Transparency status (reading it needs no permission), never shows the prompt and never touches
 * the advertising id.
 */
export function consentFromAtt(status: string): ConsentState {
  if (status === 'authorized' || status === 'unsupported') return 'granted'
  if (status === 'denied' || status === 'restricted') return 'denied'
  return 'pending'
}

/** The consent that `att` means right now on this device. */
export function attConsent(runtime: Runtime): ConsentState {
  if (runtime.os !== 'ios') return 'granted' // Android has no ATT.
  if (!runtime.native.available) return 'pending' // Expo Go cannot read it: stay silent.
  try {
    return consentFromAtt(runtime.native.module.trackingStatus())
  } catch {
    return 'pending'
  }
}
