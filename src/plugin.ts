import { createRunOncePlugin } from '@expo/config-plugins'
import type { ConfigPlugin } from '@expo/config-plugins'

type ExpoConfig = Parameters<ConfigPlugin>[0]

export interface CorlexPluginProps {
  /** @deprecated Native-only capture does not remove the SDK's JS crash capability/declaration. */
  nativeCrashes?: boolean
}

interface CollectedType {
  NSPrivacyCollectedDataType: string
  NSPrivacyCollectedDataTypeLinked: boolean
  NSPrivacyCollectedDataTypeTracking: boolean
  NSPrivacyCollectedDataTypePurposes: string[]
}

const ANALYTICS = 'NSPrivacyCollectedDataTypePurposeAnalytics'

/** Conservative capability declaration: identify() can link analytics and crashes to an account. */
export function collectedTypes(nativeCrashes?: boolean): CollectedType[] {
  // Keep the pre-release argument compatible; native-only opt-out does not turn JS crashes off.
  void nativeCrashes
  const kinds = ['ProductInteraction', 'DeviceID', 'UserID', 'CrashData']
  return kinds.map((kind) => ({
    NSPrivacyCollectedDataType: `NSPrivacyCollectedDataType${kind}`,
    NSPrivacyCollectedDataTypeLinked: true,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: [
      ANALYTICS,
      ...(kind === 'CrashData' ? ['NSPrivacyCollectedDataTypePurposeAppFunctionality'] : []),
    ],
  }))
}

/** Adds the SDK's data types to `ios.privacyManifests`, keeping what the app already declares. */
export function mergePrivacyManifest(config: ExpoConfig, props: CorlexPluginProps): ExpoConfig {
  const ios = (config.ios ?? {}) as Record<string, unknown>
  const manifest = (ios['privacyManifests'] ?? {}) as Record<string, unknown>
  const existing = (manifest['NSPrivacyCollectedDataTypes'] ?? []) as CollectedType[]
  const sdk = collectedTypes(props.nativeCrashes)
  const byType = new Map(sdk.map((row) => [row.NSPrivacyCollectedDataType, row]))
  const upgraded = existing.map((row) => {
    const own = byType.get(row.NSPrivacyCollectedDataType)
    if (own === undefined) return row
    return {
      ...row,
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypePurposes: [
        ...new Set([
          ...row.NSPrivacyCollectedDataTypePurposes,
          ...own.NSPrivacyCollectedDataTypePurposes,
        ]),
      ],
    }
  })
  const known = new Set(existing.map((t) => t.NSPrivacyCollectedDataType))
  const added = sdk.filter((t) => !known.has(t.NSPrivacyCollectedDataType))
  return {
    ...config,
    ios: {
      ...ios,
      privacyManifests: { ...manifest, NSPrivacyCollectedDataTypes: [...upgraded, ...added] },
    },
  }
}

const withCorlex: ConfigPlugin<CorlexPluginProps | undefined> = (config, props) =>
  mergePrivacyManifest(config, props ?? {})

export default createRunOncePlugin(withCorlex, '@corlex/sdk-react-native', '0.1.0')
