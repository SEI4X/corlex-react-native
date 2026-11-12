import type { PlatformHost } from '#core'

/** The part of React Native's `AppState` this SDK uses. */
export interface AppStateLike {
  currentState: string
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void }
}

/** The part of NetInfo this SDK uses. */
export interface NetInfoLike {
  addEventListener(
    listener: (state: {
      isConnected: boolean | null
      isInternetReachable?: boolean | null | undefined
    }) => void,
  ): () => void
}

export interface LifecycleOptions {
  /** `app_open` once per launch. */
  appOpen: boolean
  /** `app_background` and `app_foreground`. */
  transitions: boolean
  /** Called when the app goes to the background, after the flush started. */
  onBackground: () => void
}

/**
 * `app_open` at launch, `app_background` / `app_foreground` from AppState, and a flush every time
 * the app leaves the foreground (the queue is also on disk, so a suspended app loses nothing) or
 * comes back (this is where a batch that failed in the background is retried).
 */
export function startLifecycle(
  appState: AppStateLike,
  host: PlatformHost,
  options: LifecycleOptions,
): () => void {
  if (options.appOpen) host.track('app_open')
  let last = appState.currentState
  const subscription = appState.addEventListener('change', (state) => {
    if (state === last) return
    const wasBackground = last === 'background'
    last = state
    if (state === 'background') {
      if (options.transitions) host.track('app_background')
      void host.flush()
      options.onBackground()
    } else if (state === 'active' && wasBackground) {
      if (options.transitions) host.track('app_foreground')
      void host.flush()
    }
  })
  return () => subscription.remove()
}

/**
 * With NetInfo installed, a delivery that failed offline is retried as soon as the connection is
 * back instead of waiting for the backoff timer. Without NetInfo the queue still retries with
 * backoff, on every flush and when the app returns to the foreground.
 */
export function startConnectivity(
  netInfo: NetInfoLike | undefined,
  host: PlatformHost,
): () => void {
  if (netInfo === undefined) return () => {}
  return netInfo.addEventListener((state) => {
    if (state.isConnected === true && state.isInternetReachable !== false) void host.flush()
  })
}
