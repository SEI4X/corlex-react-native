import { afterEach, expect, it, vi } from 'vitest'
import { fakeNetwork, launch, newDevice } from './kit'
afterEach(() => vi.unstubAllGlobals())
const KEY_B = 'ck_test_' + 'c'.repeat(43)
const OPTIONS = { autocapture: false, config: { enabled: false } } as const
it('never replays pending events or identity under a different credential or cell base', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  net.state.online = false
  const a = launch(device, OPTIONS)
  await a.ready
  a.sdk.identify('person_a')
  a.sdk.track('only_a')
  await a.sdk.flush()
  a.sdk.destroy()
  net.state.online = true
  const b = launch(device, { ...OPTIONS, key: KEY_B })
  try {
    await b.ready
    b.sdk.track('only_b')
    await b.sdk.flush()
    expect(net.received.map((e) => e.name)).toEqual(['only_b'])
    expect(net.received[0]?.user_id).toBeUndefined()
  } finally {
    b.sdk.destroy()
  }
})
it('does not undo a saved refusal when protected privacy storage cannot be read', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  const a = launch(device, OPTIONS)
  await a.ready
  a.sdk.optOut()
  await a.sdk.flush()
  a.sdk.destroy()
  vi.spyOn(device.disk, 'multiGet').mockRejectedValue(new Error('synthetic_read_failure'))
  if (device.native)
    vi.spyOn(device.native, 'currentSdkPrivacy').mockImplementation(() => {
      throw new Error('synthetic_privacy_read_failure')
    })
  const b = launch(device, { ...OPTIONS, key: KEY_B })
  try {
    await b.ready
    b.sdk.track('must_not_send')
    await b.sdk.flush()
    expect(b.sdk.getConsent()).toBe('pending')
    expect(net.received).toHaveLength(0)
  } finally {
    b.sdk.destroy()
  }
})
it('persists the newest explicit opt-out when an earlier grant publishes between controller and native reads', async () => {
  const device = newDevice(),
    net = fakeNetwork(),
    first = launch(device, OPTIONS)
  await first.ready
  if (!device.native) throw new Error('missing bridge fixture')
  const native = device.native,
    read = native.currentSdkPrivacy
  let reads = 0
  const spy = vi.spyOn(native, 'currentSdkPrivacy').mockImplementation(() => {
    if (++reads === 2)
      device.disk.rows.set(
        '@privacy',
        JSON.stringify({ generation: crypto.randomUUID(), state: 'granted', sdkChoice: 'granted' }),
      )
    return read()
  })
  first.sdk.optOut()
  await first.sdk.flush()
  first.sdk.destroy()
  spy.mockRestore()
  const next = launch(device, OPTIONS)
  try {
    await next.ready
    next.sdk.track('must_not_send_after_restart')
    await next.sdk.flush()
    expect(next.sdk.getConsent()).toBe('denied')
    expect(net.received).toHaveLength(0)
  } finally {
    next.sdk.destroy()
  }
})
it('passes each immutable originating owner and generation into native crash operations', async () => {
  const device = newDevice()
  fakeNetwork()
  if (!device.native) throw new Error('missing bridge fixture')
  const native = device.native,
    install = vi.spyOn(native, 'install'),
    take = vi.spyOn(native, 'takePendingCrashes'),
    record = vi.spyOn(native, 'recordJsCrash')
  const first = launch(device, { autocapture: { appOpen: false }, config: { enabled: false } })
  try {
    await first.ready
    const generation = JSON.parse(native.currentSdkPrivacy()).generation
    expect(install.mock.calls[0]).toEqual([
      false,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      generation,
    ])
    const owner = install.mock.calls[0]?.[1]
    expect(take.mock.calls[0]).toEqual([owner, generation])
    device.errorUtils.throwFatal(new Error('synthetic'), true)
    expect(record.mock.calls[0]?.slice(1)).toEqual([owner, generation])
  } finally {
    first.sdk.destroy()
  }
})
