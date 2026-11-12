import { afterEach, expect, it, vi } from 'vitest'
import { captureContext, exactUtf8 } from '../capture-meta'
import { truncateBytes } from '../util'
import { fakeNetwork, launch, newDevice } from './kit'
afterEach(() => vi.unstubAllGlobals())
it('preserves exact supported release facts and unknown sentinels without current-launch fallback', async () => {
  const net = fakeNetwork(),
    sdk = launch(newDevice(), { config: { enabled: false } })
  try {
    sdk.capture('corlex.crash', {}, { platform: 'ios', appVersion: 'old_version', build: '17' })
    sdk.capture('corlex.crash', {}, { platform: 'ios', appVersion: '', build: '' })
    await sdk.flush()
    expect(net.received[0]?.context).toMatchObject({ platform: 'ios', app_version: 'old_version' })
    expect(net.received[0]?.properties.build).toBe('17')
    expect(net.received[1]?.context.app_version).toBeUndefined()
    expect(net.received[1]?.properties.build).toBe('')
  } finally {
    sdk.destroy()
  }
})
it('rejects invalid/oversized release identity instead of conflating prefixes', () => {
  expect(exactUtf8('a'.repeat(32), 32)).toBe(true)
  expect(exactUtf8('a'.repeat(33), 32)).toBe(false)
  expect(exactUtf8('\ud800', 32)).toBe(false)
  expect(truncateBytes('a'.repeat(125) + '😀', 128)).toBe('a'.repeat(125))
})

it('clears current-launch version when the recovered original release is unknown', () => {
  expect(
    captureContext(
      { platform: 'react-native', app_version: 'new_launch', sdk: { name: 'test', version: '0' } },
      { platform: 'ios', appVersion: '' },
    ),
  ).toEqual({ platform: 'ios', sdk: { name: 'test', version: '0' } })
})
