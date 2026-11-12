import { diskValue } from './kit'
import { rejectionReason } from '#core/test-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byName, fakeNetwork, launch, nameList, newDevice } from './kit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('start-up', () => {
  it('sends app_open with the device context and no personal data', async () => {
    const net = fakeNetwork()
    const { sdk, ready } = launch(newDevice())
    await ready
    await sdk.flush()
    const [open] = byName(net.received, 'app_open')
    expect(open?.context).toEqual({
      platform: 'react-native',
      locale: 'en-US',
      app_version: '1.2.3',
      os: 'iOS',
      os_version: '18.3',
      device_model: 'iPhone16,2',
      sdk: { name: 'corlex-react-native', version: '0.1.0' },
    })
    for (const event of net.received) {
      expect(rejectionReason(event as unknown as Record<string, unknown>)).toBe('')
    }
    sdk.destroy()
  })

  it('runs calls made right after init() in order, before the stored state is loaded', async () => {
    const net = fakeNetwork()
    const { sdk, ready } = launch(newDevice(), { autocapture: false })
    sdk.track('first')
    sdk.identify('user-1')
    sdk.track('second')
    await ready
    await sdk.flush()
    expect(nameList(net.received)).toEqual(['first', 'corlex.identify', 'second'])
    expect(net.received[2]?.user_id).toBe('user-1')
    sdk.destroy()
  })

  it('ignores calls before init() and answers flag() with the default', () => {
    const sdk = launch(newDevice()).sdk
    sdk.destroy()
    sdk.track('too_early')
    expect(sdk.flag('x', 'fallback')).toBe('fallback')
    expect(sdk.getConsent()).toBe('pending')
  })

  it('keeps the same anonymous id across launches', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const first = launch(device, { autocapture: false })
    await first.ready
    first.sdk.track('a')
    await first.sdk.flush()
    first.sdk.destroy()
    const second = launch(device, { autocapture: false })
    await second.ready
    second.sdk.track('b')
    await second.sdk.flush()
    expect(net.received[0]?.anonymous_id).toBe(net.received[1]?.anonymous_id)
    second.sdk.destroy()
  })
})

describe('lifecycle', () => {
  it('flushes when the app goes to the background and reports the transitions', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device)
    await ready
    sdk.track('tapped')
    device.appState.go('inactive')
    expect(net.received).toHaveLength(0)
    device.appState.go('background')
    await vi.advanceTimersByTimeAsync(0)
    expect(nameList(net.received)).toEqual(['app_open', 'tapped', 'app_background'])
    device.appState.go('active')
    await vi.advanceTimersByTimeAsync(0)
    expect(nameList(net.received).at(-1)).toBe('app_foreground')
    sdk.destroy()
  })

  it('retries when NetInfo says the connection is back, without waiting for the backoff', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    net.state.online = false
    const { sdk, ready } = launch(device, { autocapture: false })
    await ready
    sdk.track('offline_event')
    await sdk.flush()
    expect(net.received).toHaveLength(0)

    net.state.online = true
    for (const listener of device.netInfoListeners) listener({ isConnected: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(nameList(net.received)).toEqual(['offline_event'])
    sdk.destroy()
  })
})

describe('screens', () => {
  it('sends screen_view once per change, with the previous screen', async () => {
    const net = fakeNetwork()
    const { sdk, ready } = launch(newDevice(), { autocapture: false })
    await ready
    sdk.screen('/', 'expo-router')
    sdk.screen('/', 'expo-router')
    sdk.screen('/user/[id]', 'expo-router')
    await sdk.flush()
    const views = byName(net.received, 'screen_view').map((e) => e.properties)
    expect(views).toEqual([
      { screen: '/', source: 'expo-router' },
      { screen: '/user/[id]', source: 'expo-router', previous_screen: '/' },
    ])
    sdk.destroy()
  })

  it('never sends the values of route params, even if a path with them is passed', async () => {
    const net = fakeNetwork()
    const { sdk, ready } = launch(newDevice(), { autocapture: false })
    await ready
    sdk.screen('/orders/84731299?email=a@b.c#top')
    await sdk.flush()
    expect(byName(net.received, 'screen_view')[0]?.properties['screen']).toBe('/orders/[id]')
    sdk.destroy()
  })
})

describe('consent', () => {
  it('with consent pending: no request, nothing on disk, then optIn() sends what was held', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device, { consent: 'pending' })
    await ready
    sdk.track('held')
    expect(sdk.flag('x', 1)).toBe(1)
    await vi.advanceTimersByTimeAsync(120_000)
    await sdk.flush()
    expect(net.fn).not.toHaveBeenCalled()
    expect([...device.disk.rows.keys()]).toEqual(['@privacy'])
    expect(device.native?.installed).toBe(0)

    sdk.optIn()
    await sdk.flush()
    expect(nameList(net.received)).toContain('held')
    expect(device.native?.installed).toBe(1)
    expect(diskValue(device, 'corlex_aid') !== undefined).toBe(true)
    sdk.destroy()
  })

  it('opt-out wipes the disk and the next launch is silent', async () => {
    const net = fakeNetwork()
    net.state.online = false
    const device = newDevice()
    const first = launch(device)
    await first.ready
    first.sdk.track('x')
    await first.sdk.flush()
    first.sdk.optOut()
    await first.sdk.flush()
    expect([...device.disk.rows.keys()]).toEqual(['@privacy'])
    expect(device.native?.uninstalled).toBeGreaterThanOrEqual(1)
    first.sdk.destroy()

    net.state.online = true
    const second = launch(device)
    await second.ready
    second.sdk.track('y')
    await second.sdk.flush()
    expect(net.received).toHaveLength(0)
    expect(second.sdk.getConsent()).toBe('denied')
    second.sdk.destroy()
  })

  it("'att' maps the tracking status without ever asking, and follows it", async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device, { consent: 'att', autocapture: false })
    await ready
    sdk.track('before_answer')
    await sdk.flush()
    expect(net.received).toHaveLength(0)
    expect(sdk.getConsent()).toBe('pending')

    if (device.native) device.native.att = 'authorized'
    device.appState.go('background')
    device.appState.go('active')
    await sdk.flush()
    expect(sdk.getConsent()).toBe('granted')
    expect(nameList(net.received)).not.toContain('before_answer')
    sdk.track('after_answer')
    await sdk.flush()
    expect(nameList(net.received)).toContain('after_answer')

    if (device.native) device.native.att = 'denied'
    device.appState.go('background')
    device.appState.go('active')
    expect(sdk.getConsent()).toBe('denied')
    sdk.destroy()
  })

  it("'att' without the native module (Expo Go) stays pending on iOS", async () => {
    const net = fakeNetwork()
    const { sdk, ready } = launch(newDevice({ native: false }), { consent: 'att' })
    await ready
    sdk.track('x')
    await sdk.flush()
    expect(net.fn).not.toHaveBeenCalled()
    expect(sdk.getConsent()).toBe('pending')
    sdk.destroy()
  })
})
