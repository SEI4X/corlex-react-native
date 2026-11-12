import { afterEach, expect, it, vi } from 'vitest'
import { installRejectionTracker } from '../crash/handlers'
import { FakeHermes, fakeNetwork, launch, nativeOf, newDevice } from './kit'
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('keeps SDK-generated rejection warnings generic and bounded without changing reports', () => {
  const warn = vi.fn(),
    report = vi.fn(),
    hermes = new FakeHermes()
  installRejectionTracker(hermes, report, warn)
  for (let index = 0; index < 10000; index++)
    hermes.onUnhandled?.(index, new Error('synthetic@example.test token=sensitive_fixture'))
  expect(report).toHaveBeenCalledTimes(10000)
  expect(warn).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic@example.test')
  expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive_fixture')
})
for (const failure of ['storage', 'record', 'recover'] as const)
  it(`does not echo ${failure} exception values in debug output`, async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {}),
      device = newDevice({ native: true }),
      secret = 'synthetic@example.test private_fixture'
    fakeNetwork()
    if (failure === 'storage')
      device.disk.multiSet = async () => {
        throw new Error(secret)
      }
    if (failure === 'record')
      nativeOf(device).recordJsCrash = () => {
        throw new Error(secret)
      }
    if (failure === 'recover')
      nativeOf(device).takePendingCrashes = async () => {
        throw new Error(secret)
      }
    const { sdk, ready } = launch(device, {
      debug: true,
      autocapture: { appOpen: false },
      config: { enabled: false },
    })
    try {
      await ready
      if (failure === 'record') device.errorUtils.throwFatal(new Error('synthetic crash'))
      await sdk.flush()
      expect(debug).toHaveBeenCalled()
      expect(
        debug.mock.calls
          .flat()
          .map((value) => (value instanceof Error ? value.message : String(value)))
          .join(' '),
      ).not.toContain(secret)
    } finally {
      sdk.destroy()
    }
  })
