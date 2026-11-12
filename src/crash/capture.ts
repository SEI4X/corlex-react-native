import { EVENT_CRASH, safeErrorReport } from '#core'
import type { PlatformHost } from '#core'
import type { NativeAvailability, NativeCrashModule } from '../native'
import { installGlobalHandler, installRejectionTracker } from './handlers'
import type { ErrorUtilsLike, HermesLike } from './handlers'
import { crashProperties, parseCrashFile, reportFromError } from './report'
import type { CrashReport, CrashSource } from './report'
import { supportsCrashPrivacy } from '../native'

export interface CrashDeps {
  host: PlatformHost
  errorUtils: ErrorUtilsLike | undefined
  hermes: HermesLike | undefined
  nativeScope?(): { owner: string; generation: string } | undefined
  native: NativeAvailability
  /** Starts writing the SDK's store to disk now (a fatal error leaves no time to wait). */
  persistNow: () => void
  log: (...args: unknown[]) => void
  appVersion?: string | undefined
  build?: string | undefined
}

export interface CrashFeatures {
  /** JS errors and unhandled rejections. */
  js: boolean
  /** The native module: needs a development or production build, not Expo Go. */
  native: boolean
  captureErrorMessages?: boolean
}

/**
 * Crash collection. A crash is an event `corlex.crash` whose `event_id` is its `crash_id`, so
 * every way it travels (the live queue, the file the native module wrote, a retry) names the same
 * event and ingest's duplicate check keeps one.
 *
 *  - JS errors: `ErrorUtils` global handler (fatal and not) and unhandled promise rejections, both
 *    chained to the handlers that were there. The event is queued and persisted at once; a fatal
 *    one is also written synchronously by the native module when there is one, because the
 *    process ends before an asynchronous AsyncStorage write is certain to finish.
 *  - Native crashes: the native module's handlers write a file; the next launch reads it here.
 *  - Expo Go has no native module: JS capture works, native capture is skipped with one log line.
 */
export class CrashCapture {
  private nativeActive = false
  private scope: { owner: string; generation: string } | undefined
  private generation = 0
  private stops: (() => void)[] = []

  constructor(
    private readonly deps: CrashDeps,
    private readonly features: CrashFeatures,
  ) {}

  /** Installs the handlers. Native ones only with consent: without it nothing is written to disk. */
  start(granted: boolean): () => void {
    if (this.features.js) {
      const { errorUtils, hermes } = this.deps
      this.stops.push(
        installGlobalHandler(errorUtils, (error, fatal) =>
          this.record(this.jsReport(error, fatal, 'global_handler')),
        ),
        installRejectionTracker(hermes, (error) =>
          this.record(this.jsReport(error, false, 'unhandled_rejection')),
        ),
      )
    }
    if (granted) this.enableNative()
    return () => this.stop()
  }

  /** Consent arrived (or was there from the start): install the native handlers, read old files. */
  enableNative(): void {
    if (!this.features.native || this.nativeActive) return
    const { native, log } = this.deps
    if (!native.available) {
      log(`native crash capture is off: ${native.reason}. JS errors are still captured.`)
      return
    }
    const scope = this.deps.nativeScope?.()
    if (!scope) return
    if (!supportsCrashPrivacy(native.module)) {
      try {
        native.module.uninstall()
      } catch {
        log('native_crash_uninstall_failed')
      }
      console.warn('[corlex] native_sdk_rebuild_required')
      return
    }
    const generation = ++this.generation
    try {
      this.nativeActive = native.module.install(
        this.features.captureErrorMessages === true,
        scope.owner,
        scope.generation,
      )
      this.scope = scope
    } catch {
      log('native_crash_install_failed')
      return
    }
    if (this.nativeActive) void this.recoverPending(native.module, generation)
  }

  /** Opt-out: the native handlers become pass-through and unsent crash files are deleted. */
  disableNative(): void {
    this.generation += 1
    if (this.nativeActive && this.deps.native.available) {
      try {
        this.deps.native.module.uninstall()
      } catch {
        this.deps.log('native_crash_uninstall_failed')
      }
    }
    this.nativeActive = false
    this.scope = undefined
  }

  private stop(): void {
    for (const stop of this.stops.splice(0)) stop()
    this.disableNative()
  }

  private record(report: CrashReport): void {
    this.send(report)
    this.deps.persistNow()
    const { native } = this.deps
    const scope = this.scope
    if (!report.fatal || !this.nativeActive || !native.available || !scope) return
    try {
      native.module.recordJsCrash(JSON.stringify(headerOf(report)), scope.owner, scope.generation)
    } catch {
      this.deps.log('native_crash_record_failed')
    }
  }

  private jsReport(error: unknown, fatal: boolean, source: CrashSource): CrashReport {
    return reportFromError(error, {
      fatal,
      source,
      captureErrorMessages: this.features.captureErrorMessages === true,
      appVersion: this.deps.appVersion,
      build: this.deps.build,
    })
  }
  private send(report: CrashReport): void {
    const safe =
      report.kind === 'js'
        ? { ...report, ...safeErrorReport(report, this.features.captureErrorMessages === true) }
        : report
    this.deps.host.capture(EVENT_CRASH, crashProperties(safe), {
      eventId: safe.crashId,
      timestamp: safe.timestamp,
      ...(safe.kind === 'native' && safe.nativePlatform !== undefined
        ? { platform: safe.nativePlatform }
        : {}),
      ...(safe.appVersion === undefined ? {} : { appVersion: safe.appVersion }),
      ...(safe.build === undefined ? {} : { build: safe.build }),
    })
  }

  private async recoverPending(module: NativeCrashModule, generation: number): Promise<void> {
    try {
      const scope = this.scope
      if (!scope) return
      const files = await module.takePendingCrashes(scope.owner, scope.generation)
      if (!this.nativeActive || generation !== this.generation) return
      for (const text of files) {
        const report = parseCrashFile(text, {
          captureErrorMessages: this.features.captureErrorMessages === true,
        })
        if (report !== undefined) this.send(report)
      }
      if (files.length > 0) {
        this.deps.log(`${files.length} crash(es) of the previous launch queued`)
        this.deps.persistNow()
      }
    } catch {
      this.deps.log('native_crash_recovery_failed')
    }
  }
}

/** The one-line JSON the native module stores for a JS crash (the same shape as a native file). */
function headerOf(report: CrashReport): Record<string, unknown> {
  return {
    v: 1,
    crash_id: report.crashId,
    kind: report.kind,
    fatal: report.fatal,
    name: report.name,
    message: report.message,
    source: report.source,
    timestamp: report.timestamp,
    app_version: report.appVersion,
    build: report.build,
    frames: report.frames,
  }
}
