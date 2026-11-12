import { afterEach, expect, it, vi } from 'vitest'
import { CONFIG_ENDPOINT, ENDPOINT, fakeNetwork, launch, newDevice } from './kit'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it('never lets an authorized ATT callback undo explicit SDK opt-out', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  if (device.native) device.native.att = 'authorized'
  const { sdk, ready } = launch(device, {
    consent: 'att',
    autocapture: false,
    config: { enabled: false },
  })
  try {
    await ready
    sdk.optOut()
    device.appState.go('background')
    device.appState.go('active')
    sdk.track('must_not_send')
    await sdk.flush()
    expect(sdk.getConsent()).toBe('denied')
    expect(net.received).toHaveLength(0)
  } finally {
    sdk.destroy()
  }
})
it('keeps explicit denial across reset and restart with ATT already authorized', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  if (device.native) device.native.att = 'authorized'
  const first = launch(device, { consent: 'att', autocapture: false, config: { enabled: false } })
  await first.ready
  first.sdk.optOut()
  await first.sdk.flush()
  first.sdk.reset()
  first.sdk.destroy()
  const next = launch(device, { consent: 'att', autocapture: false, config: { enabled: false } })
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
it('ignores a queued old ATT callback after destruction and another credential initialization', async () => {
  vi.useFakeTimers()
  const device = newDevice(),
    net = fakeNetwork()
  if (device.native) device.native.att = 'authorized'
  const subscribe = vi.spyOn(device.appState, 'addEventListener')
  const first = launch(device, { consent: 'att', config: { enabled: false } })
  await first.ready
  const old = subscribe.mock.calls.at(-1)?.[1]
  first.sdk.optOut()
  first.sdk.destroy()
  try {
    await first.sdk.init({
      key: 'ck_test_' + 'z'.repeat(43),
      endpoint: ENDPOINT,
      configEndpoint: CONFIG_ENDPOINT,
      consent: 'pending',
      autocapture: false,
      config: { enabled: false },
    })
    old?.('active')
    await vi.advanceTimersByTimeAsync(5000)
    await first.sdk.flush()
    expect(net.received).toHaveLength(0)
  } finally {
    first.sdk.destroy()
  }
})
it('does not lift a saved SDK pending choice under authorized ATT after restart', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  if (device.native) device.native.att = 'authorized'
  const initial = launch(device, {
    consent: 'pending',
    autocapture: false,
    config: { enabled: false },
  })
  await initial.ready
  initial.sdk.destroy()
  const next = launch(device, { consent: 'att', autocapture: false, config: { enabled: false } })
  try {
    await next.ready
    device.appState.go('background')
    device.appState.go('active')
    next.sdk.track('waiting_for_sdk_choice')
    await next.sdk.flush()
    expect(next.sdk.getConsent()).toBe('pending')
    expect(net.received).toHaveLength(0)
    next.sdk.optIn()
    await next.sdk.flush()
    expect(net.received.map((event) => event.name)).toEqual(['waiting_for_sdk_choice'])
  } finally {
    next.sdk.destroy()
  }
})
it('fences old offline payloads and native capture on ATT withdrawal and restores a fresh identity', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  if (device.native) device.native.att = 'authorized'
  const { sdk, ready } = launch(device, {
    consent: 'att',
    autocapture: false,
    config: { enabled: false },
  })
  try {
    await ready
    sdk.track('reference')
    await sdk.flush()
    const oldId = net.received[0]?.anonymous_id
    net.received.length = 0
    net.state.online = false
    sdk.track('old_offline_payload')
    await sdk.flush()
    if (device.native) device.native.att = 'denied'
    device.appState.go('background')
    device.appState.go('active')
    expect(sdk.getConsent()).toBe('denied')
    expect([...device.disk.rows.keys()]).toEqual(['@privacy'])
    const deniedRaw = device.native?.currentSdkPrivacy() ?? ''
    expect(JSON.parse(deniedRaw).sdkChoice).toBe('granted')
    if (device.native) device.native.att = 'authorized'
    device.appState.go('background')
    device.appState.go('active')
    net.state.online = true
    sdk.track('fresh_after_restore')
    await sdk.flush()
    expect(net.received.map((e) => e.name)).toEqual(['fresh_after_restore'])
    expect(net.received[0]?.anonymous_id).not.toBe(oldId)
    expect(device.native?.currentSdkPrivacy()).not.toBe(deniedRaw)
  } finally {
    sdk.destroy()
  }
})
it('does not let a remembered local grant override a newer external SDK denial on ATT restoration', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  const { sdk, ready } = launch(device, {
    consent: 'att',
    autocapture: false,
    config: { enabled: false },
  })
  try {
    await ready
    if (!device.native) throw new Error('missing bridge fixture')
    device.native.att = 'authorized'
    device.appState.go('active')
    await sdk.flush()
    expect(sdk.getConsent()).toBe('granted')
    const denied = JSON.stringify({
      generation: crypto.randomUUID(),
      state: 'denied',
      sdkChoice: 'denied',
    })
    device.native.revokeSdkPrivacy(device.native.currentSdkPrivacy(), denied)
    expect(sdk.getConsent()).toBe('denied')
    device.native.att = 'denied'
    device.appState.go('active')
    device.native.att = 'authorized'
    device.appState.go('active')
    sdk.track('must_not_send')
    await sdk.flush()
    expect(sdk.getConsent()).toBe('denied')
    expect(net.received).toHaveLength(0)
  } finally {
    sdk.destroy()
  }
})
it.each([false, true])(
  'retains only an actual explicit grant across ATT fences and pending restart (explicit=%s)',
  async (explicit) => {
    const device = newDevice()
    fakeNetwork()
    if (!device.native) throw new Error('missing bridge fixture')
    device.native.att = 'authorized'
    const first = launch(device, { consent: 'att', autocapture: false, config: { enabled: false } })
    await first.ready
    if (explicit) first.sdk.optIn()
    await first.sdk.flush()
    device.native.att = 'denied'
    device.appState.go('active')
    device.native.att = 'authorized'
    device.appState.go('active')
    await first.sdk.flush()
    first.sdk.destroy()
    const next = launch(device, {
      consent: 'pending',
      autocapture: false,
      config: { enabled: false },
    })
    try {
      await next.ready
      expect(next.sdk.getConsent()).toBe(explicit ? 'granted' : 'pending')
      if (explicit) {
        next.sdk.optOut()
        expect([...device.disk.rows.keys()].some((key) => key.startsWith('m:'))).toBe(false)
      }
    } finally {
      next.sdk.destroy()
    }
  },
)
