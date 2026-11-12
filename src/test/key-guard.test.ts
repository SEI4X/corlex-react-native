import { afterEach, expect, it, vi } from 'vitest'
import { fakeNetwork, launch, newDevice } from './kit'
afterEach(() => vi.unstubAllGlobals())
it('rejects control-plane/provider keys before hydration', async () => {
  const device = newDevice(),
    read = vi.spyOn(device.disk, 'multiGet'),
    net = fakeNetwork(),
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { sdk, ready } = launch(device, { key: 'cm_' + 'a'.repeat(43) })
  try {
    await ready
    sdk.track('safe_test')
    await sdk.flush()
    expect(read).not.toHaveBeenCalled()
    expect(net.fn).not.toHaveBeenCalled()
    expect(warn.mock.calls).toEqual([['[corlex] invalid_sdk_key']])
  } finally {
    sdk.destroy()
    warn.mockRestore()
  }
})
