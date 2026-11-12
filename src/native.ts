import { expoCore } from './optional'

/**
 * The small native module `CorlexCrash` (ios/, android/). It exists only in a development or
 * production build made with `expo prebuild` / `expo run:*` or a bare project; **Expo Go does not
 * contain it**, and then everything native is skipped (see `nativeModule()`).
 */
export interface NativeCrashModule {
  /** Installs the native crash handlers (chained to any existing ones). True if now active. */
  sdkCapabilities?(): { crashPrivacy?: number; protectedStorage?: number; crashBinding?: number }
  install(captureErrorMessages?: boolean, owner?: string, generation?: string): boolean
  /** Stops native capture; the binding state owner controls scoped refusal cleanup. */
  uninstall(): void
  /** Crash files left by the previous launch, as JSON strings; they are deleted when taken. */
  takePendingCrashes(owner?: string, generation?: string): Promise<string[]>
  /** Writes a JS crash to disk synchronously: the process dies right after a fatal error. */
  recordJsCrash(json: string, owner?: string, generation?: string): void
  /** `notDetermined`, `authorized`, `denied`, `restricted` or `unsupported` (reading needs no permission). */
  trackingStatus(): string
  /** Crashes the app on purpose (`exception` or `signal`) to check crash capture end to end. */
  crashForTesting(kind: string): void
}

export type NativeAvailability =
  { available: true; module: NativeCrashModule } | { available: false; reason: string }

/** Looks the module up. Never throws: an app without it simply has no native crash capture. */
export function nativeModule(): NativeAvailability {
  const core = expoCore()
  if (core === undefined) {
    return { available: false, reason: 'expo-modules-core is not installed' }
  }
  const module = core.requireOptionalNativeModule<NativeCrashModule>('CorlexCrash')
  return module === null
    ? {
        available: false,
        reason:
          'the CorlexCrash native module is not in this build (Expo Go, or the app was not rebuilt)',
      }
    : { available: true, module }
}

/** Old native binaries must not receive new arguments or collect unsanitized legacy reports. */
export function supportsCrashPrivacy(module: NativeCrashModule): boolean {
  try {
    return module.sdkCapabilities?.().crashPrivacy === 1
  } catch {
    return false
  }
}
