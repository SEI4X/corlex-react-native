import { expect, it, vi } from 'vitest'
import { BindingController } from '../binding/controller'
import { CorlexCore } from '../client'
import type { Platform } from '../platform'
import type { BaseInitOptions } from '../types'
import type { PrivacyRead } from '../binding/types'
import { FakePlatform, fakeNetwork, newDevice, KEY, ENDPOINT, CONFIG_ENDPOINT } from './kit'
it('stops listeners returned after binding invalidation during platform startup', () => {
  let privacy: PrivacyRead = { kind: 'valid', generation: 'initial', state: 'granted' }
  const stop = vi.fn(),
    stores = newDevice(),
    underlying = { ...stores }
  const platform: Platform<BaseInitOptions> = {
    name: 'web',
    stores,
    keepalive: false,
    context: () => ({ platform: 'web', sdk: { name: 'test', version: '0' } }),
    eventProperties: () => ({}),
    isBlocked: () => false,
    onOptOut: () => {},
    onConsentGranted: () => {},
    bind: (_options, onInvalidate) => {
      const scope = {
        owner: 'owner',
        generation: 'initial',
        privacy,
        choice: 'granted' as const,
        stores: underlying,
        persistent: true,
      }
      const driver = {
        current: () => privacy,
        fresh: () => privacy,
        grant: () => scope,
        revoke: () => {},
      }
      const binding = new BindingController({
        owner: 'owner',
        scope,
        requested: 'granted',
        driver,
        onInvalidate,
      })
      Object.assign(stores, binding.stores)
      return binding
    },
    start: (_options, host) => {
      privacy = { kind: 'valid', generation: 'refusal', state: 'denied' }
      host.track('startup_boundary')
      return stop
    },
  }
  const sdk = new CorlexCore(platform)
  try {
    sdk.init({
      key: KEY,
      endpoint: ENDPOINT,
      configEndpoint: CONFIG_ENDPOINT,
      config: { enabled: false },
    })
    expect(sdk.getConsent()).toBe('denied')
    expect(stop).toHaveBeenCalledOnce()
  } finally {
    sdk.destroy()
  }
})

it('fails closed when a platform offers binding but cannot create its owner scope', async () => {
  const stores = newDevice(),
    platform = Object.assign(new FakePlatform(stores), { bind: () => undefined })
  const start = vi.spyOn(platform, 'start'),
    read = vi.spyOn(stores.persistent, 'get'),
    write = vi.spyOn(stores.persistent, 'set'),
    net = fakeNetwork()
  const sdk = new CorlexCore(platform)
  try {
    sdk.init({
      key: KEY,
      endpoint: ENDPOINT,
      configEndpoint: CONFIG_ENDPOINT,
      config: { enabled: false },
    })
    sdk.track('must_not_send')
    sdk.optIn()
    sdk.track('still_must_not_send')
    await sdk.flush()
    expect(start).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(net.fn).not.toHaveBeenCalled()
    expect(sdk.getConsent()).toBe('denied')
  } finally {
    sdk.destroy()
    vi.unstubAllGlobals()
  }
})
