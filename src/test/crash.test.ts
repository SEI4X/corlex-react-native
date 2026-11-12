import { diskValue } from './kit'
import { rejectionReason } from '#core/test-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byName, fakeNetwork, launch, nativeOf, newDevice } from './kit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const HERMES_STACK = `TypeError: undefined is not a function
    at explode (address at http://localhost:8081/index.bundle?platform=ios&dev=true:1234:56)
    at onPress (address at /app/index.bundle:99:7)
    at anonymous (address at InternalBytecode.js:1:2)
    at native`

function crashOf(message: string, stack = HERMES_STACK): Error {
  const error = new TypeError(message)
  error.stack = stack
  return error
}

describe('JS crashes', () => {
  it('sends a corlex.crash event with name, message and parsed frames', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device, { autocapture: { appOpen: false } })
    await ready
    device.errorUtils.throwFatal(crashOf('undefined is not a function'), false)
    await sdk.flush()
    const [crash] = byName(net.received, 'corlex.crash')
    expect(crash?.properties).toMatchObject({
      kind: 'js',
      fatal: false,
      name: 'TypeError',
      message: 'Error details omitted',
      source: 'global_handler',
      symbolicated: false,
    })
    expect(crash?.properties['frames']).toEqual([
      { fn: 'explode', file: 'index.bundle', line: 1234, col: 56 },
      { fn: 'onPress', file: 'index.bundle', line: 99, col: 7 },
      { fn: 'anonymous', file: 'InternalBytecode.js', line: 1, col: 2 },
      { fn: 'native' },
    ])
    expect(crash?.event_id).toBe(crash?.properties['crash_id'])
    expect(rejectionReason(crash as unknown as Record<string, unknown>)).toBe('')
    sdk.destroy()
  })

  it('chains to the handler that was there, so the app still crashes or shows its red box', async () => {
    fakeNetwork()
    const device = newDevice()
    const seen: unknown[] = []
    device.errorUtils.setGlobalHandler((e, fatal) => void seen.push([e, fatal]))
    const { sdk, ready } = launch(device)
    await ready
    const error = crashOf('boom')
    device.errorUtils.throwFatal(error, true)
    expect(seen).toEqual([[error, true]])
    sdk.destroy()
  })

  it('a fatal crash is saved to disk before the process goes: AsyncStorage and the native file', async () => {
    fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device)
    await ready
    device.errorUtils.throwFatal(crashOf('fatal one'), true)
    await vi.advanceTimersByTimeAsync(0)
    const queue = diskValue(device, 'corlex_queue') ?? ''
    expect(queue).toContain('corlex.crash')
    expect(device.native?.recorded).toHaveLength(1)
    expect(JSON.parse(device.native?.recorded[0] ?? '{}')).toMatchObject({
      kind: 'js',
      fatal: true,
      name: 'TypeError',
    })
    sdk.destroy()
  })

  it('delivers a crash after the relaunch even if the process died before sending', async () => {
    const net = fakeNetwork()
    net.state.online = false
    const device = newDevice()
    const first = launch(device, { autocapture: { appOpen: false } })
    await first.ready
    device.errorUtils.throwFatal(crashOf('died'), true)
    await vi.advanceTimersByTimeAsync(0)
    first.sdk.destroy() // the process is gone

    net.state.online = true
    const second = launch(device, { autocapture: { appOpen: false } })
    await second.ready
    await second.sdk.flush()
    expect(byName(net.received, 'corlex.crash')).toHaveLength(1)
    second.sdk.destroy()
  })

  it('reports unhandled promise rejections as non-fatal and keeps the usual warning', async () => {
    const net = fakeNetwork()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const device = newDevice()
    const { sdk, ready } = launch(device, { autocapture: { appOpen: false } })
    await ready
    device.hermes.onUnhandled?.(7, crashOf('rejected'))
    await sdk.flush()
    const [crash] = byName(net.received, 'corlex.crash')
    expect(crash?.properties).toMatchObject({ source: 'unhandled_rejection', fatal: false })
    expect(warn.mock.calls[0]?.[0]).toContain('Possible Unhandled Promise Rejection (id: 7)')
    sdk.destroy()
  })

  it('accepts thrown values and cuts explicitly enabled detailed messages', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device, {
      captureErrorMessages: true,
      autocapture: { appOpen: false },
    })
    await ready
    device.errorUtils.throwFatal('just a string', false)
    device.errorUtils.throwFatal({ weird: true }, false)
    device.errorUtils.throwFatal(crashOf('x'.repeat(5000)), false)
    await sdk.flush()
    const crashes = byName(net.received, 'corlex.crash')
    expect(crashes.map((c) => c.properties['message'])).toEqual([
      'just a string',
      '',
      'x'.repeat(512),
    ])
    for (const c of crashes) {
      expect(rejectionReason(c as unknown as Record<string, unknown>)).toBe('')
    }
    sdk.destroy()
  })

  it('can be switched off', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device, { autocapture: { crashes: false, appOpen: false } })
    await ready
    device.errorUtils.throwFatal(crashOf('ignored'), false)
    await sdk.flush()
    expect(net.received).toHaveLength(0)
    sdk.destroy()
  })
})

describe('native crashes', () => {
  const signalFile = [
    '{"v":1,"crash_id":"7d3a1f60-0b6e-4a52-9d41-3c8f2e5b9a10","kind":"native","fatal":true,"name":"SIGSEGV","message":"Signal 11","source":"signal","timestamp_s":1790000000}',
    '0   libsystem_platform.dylib  0x000000018a2b1234 _sigtramp + 56',
    '1   Corlex                    0x0000000104a0b1c8 -[Demo crash] + 40',
    '',
  ].join('\n')

  it('sends the crash a previous launch left in a file, once, with its original time and id', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    nativeOf(device).files = [signalFile]
    const { sdk, ready } = launch(device, { autocapture: { appOpen: false } })
    await ready
    await vi.advanceTimersByTimeAsync(0)
    await sdk.flush()
    const crashes = byName(net.received, 'corlex.crash')
    expect(crashes).toHaveLength(1)
    expect(crashes[0]).toMatchObject({
      event_id: '7d3a1f60-0b6e-4a52-9d41-3c8f2e5b9a10',
      timestamp: '2026-09-21T14:13:20.000Z',
    })
    expect(crashes[0]?.properties).toMatchObject({ kind: 'native', fatal: true, name: 'SIGSEGV' })
    expect(crashes[0]?.properties['frames']).toEqual([]) // Legacy free-form native text is private by default.
    expect(rejectionReason(crashes[0] as unknown as Record<string, unknown>)).toBe('')
    expect(device.native?.files).toEqual([])
    sdk.destroy()
  })

  it('a JS crash recorded natively and also delivered live is one event', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const first = launch(device, { autocapture: { appOpen: false } })
    await first.ready
    device.errorUtils.throwFatal(crashOf('both ways'), true)
    await first.sdk.flush() // delivered live: the app survived
    first.sdk.destroy()

    nativeOf(device).files = nativeOf(device).recorded // the file the native module wrote
    const second = launch(device, { autocapture: { appOpen: false } })
    await second.ready
    await vi.advanceTimersByTimeAsync(0)
    await second.sdk.flush()
    const ids = byName(net.received, 'corlex.crash').map((e) => e.event_id)
    expect(ids).toHaveLength(2) // ingest receives it twice: it deduplicates by event_id
    expect(new Set(ids).size).toBe(1)
    second.sdk.destroy()
  })

  it('a damaged file (the process died while writing) is skipped, not fatal', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    nativeOf(device).files = ['{"v":1,"crash_i', signalFile]
    const { sdk, ready } = launch(device, { autocapture: { appOpen: false } })
    await ready
    await vi.advanceTimersByTimeAsync(0)
    await sdk.flush()
    expect(byName(net.received, 'corlex.crash')).toHaveLength(1)
    sdk.destroy()
  })

  it('without a native state bridge, a fresh explicit grant permits JS memory-only capture', async () => {
    const net = fakeNetwork()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const device = newDevice({ native: false })
    const { sdk, ready } = launch(device, { debug: true, autocapture: { appOpen: false } })
    await ready
    expect(sdk.getConsent()).toBe('pending')
    sdk.optIn()
    await sdk.flush()
    device.errorUtils.throwFatal(crashOf('js still works'), false)
    await sdk.flush()
    expect(byName(net.received, 'corlex.crash')).toHaveLength(1)
    const notes = debug.mock.calls.filter((c) =>
      String(c[0]).includes('native crash capture is off'),
    )
    expect(notes).toHaveLength(1)
    sdk.destroy()
  })

  it('native capture can be switched off while JS capture stays on', async () => {
    fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device, { autocapture: { nativeCrashes: false } })
    await ready
    expect(device.native?.installed).toBe(0)
    sdk.destroy()
  })
})
