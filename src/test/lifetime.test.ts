import { afterEach, expect, it, vi } from 'vitest'
import { CONFIG_ENDPOINT, ENDPOINT, fakeNetwork, KEY, launch, newDevice } from './kit'

const NEW_KEY = `ck_test_${'c'.repeat(43)}`
afterEach(() => vi.unstubAllGlobals())
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
it('cannot initialize a replacement client with the old delayed key or consent', async () => {
  const first = deferred<[string, string | null][]>(),
    second = deferred<[string, string | null][]>(),
    device = newDevice(),
    net = fakeNetwork()
  vi.spyOn(device.disk, 'multiGet')
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const { sdk, ready } = launch(device, { key: KEY, config: { enabled: false } })
  sdk.track('old_waiting')
  sdk.destroy()
  const next = sdk.init({
    key: NEW_KEY,
    endpoint: ENDPOINT,
    configEndpoint: CONFIG_ENDPOINT,
    consent: 'pending',
    config: { enabled: false },
  })
  sdk.track('new_pending')
  try {
    first.resolve([])
    await ready
    expect(sdk.getConsent()).toBe('pending')
    expect(net.fn).not.toHaveBeenCalled()
    second.resolve([])
    await next
    expect(sdk.getConsent()).toBe('pending')
    sdk.optIn()
    await sdk.flush()
    expect(net.received.some((event) => event.name === 'old_waiting')).toBe(false)
    expect(net.received.some((event) => event.name === 'new_pending')).toBe(true)
    expect(
      net.fn.mock.calls.every(
        ([, init]) => new Headers(init?.headers).get('X-Corlex-Key') === NEW_KEY,
      ),
    ).toBe(true)
  } finally {
    first.resolve([])
    second.resolve([])
    await Promise.all([ready, next])
    sdk.destroy()
  }
})
it('an old flush waiting for hydration never flushes the replacement instance', async () => {
  const first = deferred<[string, string | null][]>(),
    device = newDevice(),
    net = fakeNetwork()
  vi.spyOn(device.disk, 'multiGet').mockReturnValueOnce(first.promise)
  const { sdk, ready } = launch(device, { config: { enabled: false } })
  const oldFlush = sdk.flush()
  sdk.destroy()
  try {
    await sdk.init({
      key: NEW_KEY,
      endpoint: ENDPOINT,
      configEndpoint: CONFIG_ENDPOINT,
      config: { enabled: false },
    })
    sdk.track('new_waiting')
    first.resolve([])
    await Promise.all([ready, oldFlush])
    expect(net.fn).not.toHaveBeenCalled()
    await sdk.flush()
    expect(net.received.some((event) => event.name === 'new_waiting')).toBe(true)
  } finally {
    first.resolve([])
    await ready
    sdk.destroy()
  }
})

it('honors onUpdate unsubscribe before hydration completes', async () => {
  const first = deferred<[string, string | null][]>(),
    device = newDevice(),
    net = fakeNetwork()
  net.state.config = JSON.stringify({ version: 1, etag: '"v1"', params: [] })
  vi.spyOn(device.disk, 'multiGet').mockReturnValueOnce(first.promise)
  const { sdk, ready } = launch(device)
  const listener = vi.fn(),
    off = sdk.config.onUpdate(listener)
  off()
  try {
    first.resolve([])
    await ready
    await sdk.config.refresh()
    expect(listener).not.toHaveBeenCalled()
  } finally {
    first.resolve([])
    await ready
    sdk.destroy()
  }
})
