import { BindingController, MemoryStore } from '#core'
import type { BoundScope, ConsentState } from '#core'
import { NativeBindingDriver } from './binding/driver'
import type {
  BaseInitOptions,
  Platform,
  PlatformHost,
  PlatformStores,
  Properties,
  WireContext,
  SDKRequest,
} from '#core'
import { CrashCapture } from './crash/capture'
import { contextFrom } from './device'
import type { DeviceInfo } from './device'
import { startConnectivity, startLifecycle } from './lifecycle'
import type { Runtime } from './runtime'
import type { AutocaptureOptions } from './types'

/** What the core is given: the options of the app, `consent: 'att'` already resolved. */
export type CoreOptions = BaseInitOptions & { autocapture?: boolean | AutocaptureOptions }

const ALL: Required<AutocaptureOptions> = {
  appOpen: true,
  lifecycle: true,
  crashes: true,
  nativeCrashes: true,
}

export function resolveAutocapture(
  option: boolean | AutocaptureOptions | undefined,
): Required<AutocaptureOptions> {
  if (option === false)
    return { appOpen: false, lifecycle: false, crashes: false, nativeCrashes: false }
  if (option === undefined || option === true) return ALL
  return { ...ALL, ...option }
}

/** Native scoped state, AppState, optional NetInfo, and guarded crash capture. */
export class NativePlatform implements Platform<CoreOptions> {
  readonly name = 'react-native'
  readonly keepalive = false
  request: SDKRequest
  readonly stores: PlatformStores = {
    persistent: new MemoryStore(),
    identity: new MemoryStore(),
    session: new MemoryStore(),
  }
  private driver: NativeBindingDriver | undefined
  private prepared: BoundScope | undefined
  private binding: BindingController | undefined
  private readonly info: DeviceInfo
  private crash: CrashCapture | undefined

  constructor(
    private readonly runtime: Runtime,
    private readonly log: (...args: unknown[]) => void = () => {},
  ) {
    // NativeClient checks availability before constructing the platform. Never use global Fetch.
    if (!runtime.request) throw new Error('secure_transport_unavailable')
    this.request = runtime.request
    this.info = runtime.deviceInfo()
  }

  async prepare(
    owner: string,
    requested: ConsentState,
    ceiling?: () => ConsentState,
  ): Promise<void> {
    this.driver = new NativeBindingDriver(
      owner,
      this.runtime.native.available ? this.runtime.native.module : undefined,
      { log: () => this.log('storage_error'), ...(ceiling ? { ceiling } : {}) },
    )
    this.prepared = await this.driver.prepare(requested)
  }
  bind(options: CoreOptions, invalidate: () => void): BindingController | undefined {
    if (!this.driver || !this.prepared) return undefined
    const binding = new BindingController({
      owner: this.driver.owner,
      scope: this.prepared,
      requested: options.consent ?? 'granted',
      driver: this.driver,
      onInvalidate: invalidate,
    })
    this.binding = binding
    Object.assign(this.stores, binding.stores)
    this.request = binding.request(this.request)
    return binding
  }
  restorePermission(job: () => void): void {
    this.driver?.observeGrant(job)
  }
  observeCeiling(): void {
    this.driver?.current()
  }
  sdkGranted(): boolean {
    return this.driver?.sdkGranted() ?? false
  }
  async flushNow(): Promise<void> {
    await this.driver?.flushNow()
  }
  private nativeScope(): { owner: string; generation: string } | undefined {
    const scope = this.binding?.scope()
    return scope && this.driver?.select(scope)
      ? { owner: scope.owner, generation: scope.generation }
      : undefined
  }

  context(): WireContext {
    return contextFrom(this.info)
  }

  eventProperties(): Properties {
    return {}
  }

  isBlocked(): boolean {
    return false
  }

  start(options: CoreOptions, host: PlatformHost, granted: boolean): () => void {
    const auto = resolveAutocapture(options.autocapture)
    const { runtime } = this
    const stops: (() => void)[] = [
      startLifecycle(runtime.appState, host, {
        appOpen: auto.appOpen,
        transitions: auto.lifecycle,
        onBackground: () => void this.flushNow(),
      }),
      startConnectivity(runtime.netInfo, host),
    ]
    this.crash = new CrashCapture(
      {
        host,
        appVersion: this.info.appVersion,
        build: this.info.build,
        errorUtils: runtime.errorUtils,
        hermes: runtime.hermes,
        native: runtime.native,
        nativeScope: () => this.nativeScope(),
        persistNow: () => void this.flushNow(),
        log: this.log,
      },
      {
        js: auto.crashes,
        native: auto.nativeCrashes,
        captureErrorMessages: options.captureErrorMessages === true,
      },
    )
    stops.push(this.crash.start(granted))
    return () => stops.forEach((stop) => stop())
  }

  onConsentGranted(): void {
    this.crash?.enableNative()
  }

  onOptOut(): void {
    this.crash?.disableNative()
  }
}
