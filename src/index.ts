import { useEffect, useState } from 'react'
import { nativeModule } from './native'
import { corlex } from './singleton'
import type { ConfigJson } from './types'

export { NativeClient as Corlex } from './client'
export { SDK_VERSION } from './version'
export type {
  AutocaptureOptions,
  CorlexApi,
  ConfigApi,
  ConfigJson,
  ConfigOptions,
  ConfigUpdate,
  ConsentState,
  ExperimentAssignment,
  InitOptions,
  Properties,
} from './types'

/**
 * Starts the SDK. Call it once, at the top of your entry file (`app/_layout.tsx` in Expo Router),
 * outside any component. It returns a promise; you do not have to await it: calls made right
 * after `init()` wait for it.
 */
export const init: typeof corlex.init = (options) => corlex.init(options)
export const track: typeof corlex.track = (name, properties) => corlex.track(name, properties)
/** A screen was shown: `screen('Settings')`. Expo Router and React Navigation do this for you. */
export const screen: typeof corlex.screen = (name, source) => corlex.screen(name, source)
export const identify: typeof corlex.identify = (userId, traits) => corlex.identify(userId, traits)
export const setUserProperties: typeof corlex.setUserProperties = (properties) =>
  corlex.setUserProperties(properties)
/** Remote Config: `config.get('free_trial_days', 7)`, `await config.ready()`, `config.onUpdate(…)`. */
export const config: typeof corlex.config = corlex.config
/** A/B test: `experiment('paywall_test')` gives `{ variant, value }` or `null`, and counts the exposure. */
export const experiment: typeof corlex.experiment = (key) => corlex.experiment(key)
export const flag: typeof corlex.flag = (key, defaultValue) => corlex.flag(key, defaultValue)
export const reset: typeof corlex.reset = () => corlex.reset()
export const flush: typeof corlex.flush = () => corlex.flush()
export const getConsent: typeof corlex.getConsent = () => corlex.getConsent()
export const optIn: typeof corlex.optIn = () => corlex.optIn()
export const optOut: typeof corlex.optOut = () => corlex.optOut()

/**
 * A Remote Config value for a component. It is the value of this launch: a config published
 * later is saved and shows up at the next launch (SPEC §10), unless `init({ config: { live: true } })`.
 */
export function useConfig<T extends ConfigJson>(key: string, fallback: T): T {
  const [value, setValue] = useState<T>(() => config.get(key, fallback))
  useEffect(() => {
    // The first render may come before the saved config is loaded; read again once it is. This
    // does not wait for the download, so a config published since the last launch stays for the next.
    void corlex.initialized().then(() => setValue(config.get(key, fallback)))
    return config.onUpdate((update) => {
      if (update.applied) setValue(config.get(key, fallback))
    })
    // `fallback` is a default, not a dependency: a new object each render must not re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return value
}

/**
 * Crashes the app on purpose, natively, to check that native crash capture works end to end: relaunch
 * the app afterwards and the crash arrives. Returns false (and does nothing) where the native module
 * is missing, for example in Expo Go. Do not call it in production code.
 */
export function crashNativeForTesting(kind: 'exception' | 'signal' = 'exception'): boolean {
  const native = nativeModule()
  if (!native.available) return false
  native.module.crashForTesting(kind)
  return true
}
