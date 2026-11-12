import { vi } from 'vitest'
import { CorlexCore } from '../client'
import { MemoryStore } from '../store'
import type { Platform, PlatformStores } from '../platform'
import type { BaseInitOptions, Properties, WireContext, WireEvent } from '../types'

export const KEY = `ck_live_${'a'.repeat(43)}`
export const ENDPOINT = 'https://ingest.test'
export const CONFIG_ENDPOINT = 'https://config.test'

/** The disk of a fake device: a new `CorlexCore` on the same stores is "the app, relaunched". */
export function newDevice(): PlatformStores {
  return {
    persistent: new MemoryStore(),
    identity: new MemoryStore(),
    session: new MemoryStore(),
  }
}

export class FakePlatform implements Platform<BaseInitOptions> {
  readonly keepalive = false
  blocked = false
  started = 0
  stopped = 0

  constructor(
    readonly stores: PlatformStores = newDevice(),
    readonly name = 'react-native',
  ) {}

  context(): WireContext {
    return { platform: this.name, sdk: { name: 'corlex-test', version: '0.0.0' } }
  }

  eventProperties(): Properties {
    return { screen_hint: 'x' }
  }

  isBlocked(): boolean {
    return this.blocked
  }

  start(): () => void {
    this.started += 1
    return () => {
      this.stopped += 1
    }
  }

  onConsentGranted(): void {}

  onOptOut(): void {}
}

export function launch(device: PlatformStores, options: Partial<BaseInitOptions> = {}): CorlexCore {
  const sdk = new CorlexCore(new FakePlatform(device))
  sdk.init({ key: KEY, endpoint: ENDPOINT, configEndpoint: CONFIG_ENDPOINT, ...options })
  return sdk
}

/**
 * A network that can be switched off. `received` holds every event the "server" accepted, in
 * arrival order, so a test can assert on duplicates by `event_id`.
 */
export function fakeNetwork() {
  const state = { online: true, requests: 0, config: undefined as string | undefined }
  const received: WireEvent[] = []
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    state.requests += 1
    if (!state.online) throw new TypeError('Network request failed')
    if (String(url).includes('/v1/config/')) {
      return state.config === undefined
        ? new Response('{}', { status: 404 })
        : new Response(state.config, { status: 200, headers: { ETag: '"v1"' } })
    }
    const body = JSON.parse(String(init?.body)) as { events: WireEvent[] }
    received.push(...body.events)
    return new Response('{}', { status: 202 })
  })
  vi.stubGlobal('fetch', fn)
  return { state, received, fn }
}

export const ids = (events: WireEvent[]): string[] => events.map((e) => e.event_id)
export const nameList = (events: WireEvent[]): string[] => events.map((e) => e.name)
