import { MAX_CONTEXT, truncateBytes } from '#core'
import type { WireContext } from '#core'
import { Platform } from 'react-native'
import { expoApplication, expoDevice } from './optional'
import { SDK_NAME, SDK_VERSION } from './version'

/** What the app can tell about the device without asking for a permission. */
export interface DeviceInfo {
  appVersion?: string | undefined
  build?: string | undefined
  osName?: string | undefined
  osVersion?: string | undefined
  model?: string | undefined
  locale?: string | undefined
}

const OS_NAMES: Record<string, string> = { ios: 'iOS', android: 'Android' }

function localeOf(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

/**
 * Device and app facts: `expo-application` and `expo-device` when the app has them, otherwise
 * only what `react-native`'s Platform knows (the OS and its version). There is no advertising id,
 * no IDFV, no device name: only the model and versions, the same on every phone of that kind.
 */
export function readDeviceInfo(): DeviceInfo {
  const device = expoDevice()
  const app = expoApplication()
  return {
    appVersion: app?.nativeApplicationVersion ?? undefined,
    build: app?.nativeBuildVersion ?? undefined,
    osName: device?.osName ?? OS_NAMES[Platform.OS] ?? Platform.OS,
    osVersion: device?.osVersion ?? String(Platform.Version),
    model: device?.modelId ?? device?.modelName ?? undefined,
    locale: localeOf(),
  }
}

const clip = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : truncateBytes(value, MAX_CONTEXT)

/** The `context` of every event; `platform` is `react-native` (the OS goes in `os`). */
export function contextFrom(info: DeviceInfo): WireContext {
  const context: WireContext = {
    platform: 'react-native',
    sdk: { name: SDK_NAME, version: SDK_VERSION },
  }
  const fields = {
    locale: info.locale,
    app_version: info.appVersion,
    os: info.osName,
    os_version: info.osVersion,
    device_model: info.model,
  } as const
  for (const [key, value] of Object.entries(fields)) {
    const clipped = clip(value)
    if (clipped !== undefined) context[key as keyof typeof fields] = clipped
  }
  return context
}
