import { afterEach, expect, it, vi } from 'vitest'
import { fakeNetwork, launch, newDevice } from './kit'
afterEach(() => vi.unstubAllGlobals())
it.each([
  'cm_' + 'a'.repeat(43),
  'corlex_up_' + 'a'.repeat(43),
  'sk-' + 'a'.repeat(43),
  'ck_test_short',
])('rejects wrong credential type before network/storage', async (key) => {
  const net = fakeNetwork(),
    device = newDevice(),
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const sdk = launch(device, { key })
  try {
    sdk.track('safe_test')
    await sdk.flush()
    await sdk.config.refresh()
    expect(net.fn).not.toHaveBeenCalled()
    expect(device.persistent.get('corlex_queue')).toBeNull()
    expect(device.identity.get('corlex_aid')).toBeNull()
    expect(warn.mock.calls).toEqual([['[corlex] invalid_sdk_key']])
  } finally {
    sdk.destroy()
    warn.mockRestore()
  }
})

it.each(['\n', '\r\n', ' '])('rejects trailing credential whitespace %j', async (suffix) => {
  const net = fakeNetwork(),
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const sdk = launch(newDevice(), { key: 'ck_test_' + 'a'.repeat(43) + suffix })
  try {
    sdk.track('safe_test')
    await sdk.flush()
    expect(net.fn).not.toHaveBeenCalled()
  } finally {
    sdk.destroy()
    warn.mockRestore()
  }
})
