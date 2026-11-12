import type { SDKRequest } from '#core'
import { afterEach, expect, it, vi } from 'vitest'
import { fakeNetwork, launch, newDevice } from './kit'

afterEach(() => vi.unstubAllGlobals())
it('disables the SDK without crashing the app when secure native transport is unavailable', async () => {
  const network = fakeNetwork()
  vi.stubGlobal('fetch', network.fn)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { sdk, ready } = launch(
    newDevice(),
    { config: { enabled: false } },
    { runtime: { request: undefined } },
  )
  try {
    await expect(ready).resolves.toBeUndefined()
    sdk.track('safe_test')
    await sdk.flush()
    sdk.optIn()
    await sdk.flush()
    expect(network.fn).not.toHaveBeenCalled()
    expect(sdk.getConsent()).toBe('pending')
    expect(sdk.flag('safe_flag', false)).toBe(false)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning.mock.calls[0]).toEqual(['[corlex] secure_transport_unavailable'])
  } finally {
    sdk.destroy()
    warning.mockRestore()
  }
})
it('uses only the platform adapter with redirect denial and no ambient cookies', async () => {
  const unsafe = vi.fn(async () => new Response('{}', { status: 202 }))
  const secure = vi.fn<SDKRequest>(async () => new Response('{}', { status: 202 }))
  vi.stubGlobal('fetch', unsafe)
  const { sdk, ready } = launch(
    newDevice(),
    { config: { enabled: false } },
    { runtime: { request: secure } },
  )
  try {
    await ready
    sdk.track('safe_test')
    await sdk.flush()
    expect(unsafe).not.toHaveBeenCalled()
    expect(secure).toHaveBeenCalled()
    expect(secure.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      credentials: 'omit',
    })
  } finally {
    sdk.destroy()
  }
})

import { secureExpoRequest } from '../request'
it.each(['52.0.0', '53.0.0', '57.0.99', '58.0.20', '59.0.0', '58.0.21-preview'])(
  'rejects untested Expo %s',
  (version) => {
    expect(secureExpoRequest({ fetch: vi.fn() }, version)).toBeUndefined()
  },
)
it('accepts the validated Expo transport but never an absent or malformed module', () => {
  const fetch = vi.fn()
  expect(secureExpoRequest({ fetch }, '58.0.21')).toBe(fetch)
  expect(secureExpoRequest(undefined, '58.0.21')).toBeUndefined()
  expect(secureExpoRequest({ fetch: 1 }, '58.0.21')).toBeUndefined()
})
