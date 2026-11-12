import type { SDKRequest } from '#core'
import { AppState, Platform } from 'react-native'
import type { ErrorUtilsLike, HermesLike } from './crash/handlers'
import { readDeviceInfo } from './device'
import type { DeviceInfo } from './device'
import type { AppStateLike, NetInfoLike } from './lifecycle'
import { nativeModule } from './native'
import type { NativeAvailability } from './native'
import { expoRequest, netInfo } from './optional'

/**
 * Everything the SDK takes from React Native and the Expo modules, in one object, so the rest of
 * the code (and its tests) never imports them. Built when `init()` runs, not when the module loads.
 */
export interface Runtime {
  os: string
  request: SDKRequest | undefined
  appState: AppStateLike
  netInfo: NetInfoLike | undefined
  errorUtils: ErrorUtilsLike | undefined
  hermes: HermesLike | undefined
  native: NativeAvailability
  deviceInfo: () => DeviceInfo
}

export function defaultRuntime(): Runtime {
  const globals = globalThis as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike }
  const native = nativeModule()
  return {
    os: Platform.OS,
    request: expoRequest(),
    appState: AppState,
    netInfo: netInfo(),
    errorUtils: globals.ErrorUtils,
    hermes: globals.HermesInternal,
    native,
    deviceInfo: readDeviceInfo,
  }
}
