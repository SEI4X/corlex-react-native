import { StateFixture } from './state-fixture'
import { vi } from 'vitest'
import { NativeClient } from '../client'
import type { ErrorHandler, ErrorUtilsLike, HermesLike } from '../crash/handlers'
import type { AppStateLike, NetInfoLike } from '../lifecycle'
import type { NativeAvailability, NativeCrashModule } from '../native'
import type { Runtime } from '../runtime'
import type { AsyncStorageLike } from '../storage'
import type { InitOptions } from '../types'
import type { WireEvent } from '#core'

export const KEY = `ck_live_${'b'.repeat(43)}`
export const ENDPOINT = 'https://ingest.test'
export const CONFIG_ENDPOINT = 'https://config.test'

/** The phone's flash memory: it outlives the app, so a second launch can reuse it. */
export class FakeDisk implements AsyncStorageLike {
  readonly rows = new Map<string, string>()

  async multiGet(keys: readonly string[]): Promise<[string, string | null][]> {
    return keys.map((k): [string, string | null] => [k, this.rows.get(k) ?? null])
  }

  async multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
    for (const [k, v] of pairs) this.rows.set(k, v)
  }

  async multiRemove(keys: readonly string[]): Promise<void> {
    for (const k of keys) this.rows.delete(k)
  }
}

export class FakeAppState implements AppStateLike {
  currentState = 'active'
  private readonly listeners = new Set<(state: string) => void>()

  addEventListener(_type: 'change', listener: (state: string) => void) {
    this.listeners.add(listener)
    return { remove: () => void this.listeners.delete(listener) }
  }

  go(state: string): void {
    this.currentState = state
    for (const l of [...this.listeners]) l(state)
  }
}

export class FakeNative implements NativeCrashModule {
  private readonly state: StateFixture
  constructor(disk = new FakeDisk()) {
    this.state = new StateFixture(disk, () => this.uninstall())
  }
  sdkCapabilities = () => ({ crashPrivacy: 1, protectedStorage: 2, crashBinding: 1 })
  currentSdkPrivacy = (): string => this.state.current()
  readBoundSdkState = (owner: string): Promise<string> => this.state.read(owner)
  exchangeSdkState = (command: string): Promise<string> => this.state.exchange(command)
  revokeSdkPrivacy = (expected: string, record: string): string =>
    this.state.revoke(expected, record)
  observeSdkCeiling = (expected: string, ceiling: string): string =>
    this.state.observe(expected, ceiling)
  selectSdkScope = (owner: string, generation: string): void => this.state.select(owner, generation)
  installed = 0
  uninstalled = 0
  /** Crash files "left by the previous launch". */
  files: string[] = []
  recorded: string[] = []
  att = 'notDetermined'
  install: NativeCrashModule['install'] = () => {
    this.installed += 1
    return true
  }
  uninstall = (): void => {
    this.uninstalled += 1
    this.files = []
  }
  takePendingCrashes: NativeCrashModule['takePendingCrashes'] = async () => this.files.splice(0)
  recordJsCrash: NativeCrashModule['recordJsCrash'] = (json) => {
    this.recorded.push(json)
  }
  trackingStatus = (): string => this.att
  crashForTesting = (): void => {}
}

export class FakeErrorUtils implements ErrorUtilsLike {
  handled: unknown[] = []
  private handler: ErrorHandler = (error) => void this.handled.push(error)
  getGlobalHandler = (): ErrorHandler => this.handler
  setGlobalHandler = (handler: ErrorHandler): void => {
    this.handler = handler
  }
  /** The runtime throws: whatever handler is installed gets it. */
  throwFatal(error: unknown, fatal = true): void {
    this.handler(error, fatal)
  }
}

export class FakeHermes implements HermesLike {
  onUnhandled: ((id: number, error: unknown) => void) | undefined
  enablePromiseRejectionTracker: NonNullable<HermesLike['enablePromiseRejectionTracker']> = (o) => {
    this.onUnhandled = o.onUnhandled
  }
}

export interface Device {
  disk: FakeDisk
  appState: FakeAppState
  errorUtils: FakeErrorUtils
  hermes: FakeHermes
  native: FakeNative | undefined
  netInfoListeners: Set<(s: { isConnected: boolean | null }) => void>
}

export function newDevice(options: { native?: boolean } = {}): Device {
  const disk = new FakeDisk()
  return {
    disk,
    appState: new FakeAppState(),
    errorUtils: new FakeErrorUtils(),
    hermes: new FakeHermes(),
    native: options.native === false ? undefined : new FakeNative(disk),
    netInfoListeners: new Set(),
  }
}

/** A launch of the app on a device: new process, same disk. */
export function launch(
  device: Device,
  options: Partial<InitOptions> = {},
  platform: string | { os?: string; runtime?: Partial<Runtime> } = 'ios',
): { sdk: NativeClient; ready: Promise<void> } {
  const os = typeof platform === 'string' ? platform : (platform.os ?? 'ios')
  const runtimeOverrides = typeof platform === 'string' ? {} : (platform.runtime ?? {})
  const native: NativeAvailability =
    device.native === undefined
      ? { available: false, reason: 'Expo Go' }
      : { available: true, module: device.native }
  const netInfo: NetInfoLike = {
    addEventListener: (l) => {
      device.netInfoListeners.add(l)
      return () => void device.netInfoListeners.delete(l)
    },
  }
  const runtime: Runtime = {
    os,
    request: (url, options) => globalThis.fetch(url, options),
    appState: device.appState,
    netInfo,
    errorUtils: device.errorUtils,
    hermes: device.hermes,
    native,
    ...runtimeOverrides,
    deviceInfo: () => ({
      appVersion: '1.2.3',
      osName: 'iOS',
      osVersion: '18.3',
      model: 'iPhone16,2',
      locale: 'en-US',
    }),
  }
  const sdk = new NativeClient(() => runtime)
  const ready = sdk.init({
    key: KEY,
    endpoint: ENDPOINT,
    configEndpoint: CONFIG_ENDPOINT,
    ...options,
  })
  return { sdk, ready }
}

/** A network that can be switched off; `received` is what the server accepted, in order. */
export function fakeNetwork() {
  const state = { online: true, config: undefined as string | undefined }
  const received: WireEvent[] = []
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (!state.online) throw new TypeError('Network request failed')
    if (String(url).includes('/v1/config/')) {
      return state.config === undefined
        ? new Response('{}', { status: 404 })
        : new Response(state.config, { status: 200, headers: { ETag: '"v1"' } })
    }
    received.push(...(JSON.parse(String(init?.body)) as { events: WireEvent[] }).events)
    return new Response('{}', { status: 202 })
  })
  vi.stubGlobal('fetch', fn)
  return { state, received, fn }
}

export const nameList = (events: WireEvent[]): string[] => events.map((e) => e.name)
export const byName = (events: WireEvent[], name: string): WireEvent[] =>
  events.filter((e) => e.name === name)

export function nativeOf(device: Device): FakeNative {
  if (device.native === undefined) throw new Error('this test device has no native module')
  return device.native
}

export function diskValue(device: Device, key: string): string | undefined {
  return [...device.disk.rows].find(
    ([name]) => name.startsWith('s:') && name.endsWith(':' + key),
  )?.[1]
}
