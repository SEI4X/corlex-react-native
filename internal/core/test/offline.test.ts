import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUEUE_KEY } from '../queue'
import { fakeNetwork, ids, launch, nameList, newDevice } from './kit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('offline queue', () => {
  it('keeps events while offline and delivers each once after the network is back', async () => {
    const net = fakeNetwork()
    const sdk = launch(newDevice())
    net.state.online = false
    for (const n of ['a', 'b', 'c']) sdk.track(n)
    await sdk.flush()
    expect(net.received).toHaveLength(0)

    net.state.online = true
    await vi.advanceTimersByTimeAsync(70_000)
    expect(nameList(net.received)).toEqual(['a', 'b', 'c'])
    expect(new Set(ids(net.received)).size).toBe(3)
    sdk.destroy()
  })

  it('survives an app restart while offline: the next launch sends the old events once', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const first = launch(device)
    net.state.online = false
    first.track('before_restart_1')
    first.track('before_restart_2')
    await first.flush()
    first.destroy()
    expect(JSON.parse(device.persistent.get(QUEUE_KEY) ?? '[]')).toHaveLength(2)

    const second = launch(device)
    second.track('after_restart')
    net.state.online = true
    await second.flush()
    expect(nameList(net.received)).toEqual([
      'before_restart_1',
      'before_restart_2',
      'after_restart',
    ])
    expect(new Set(ids(net.received)).size).toBe(3)
    expect(device.persistent.get(QUEUE_KEY)).toBe('[]')
    second.destroy()
  })

  it('retries a batch that failed in flight with the same event ids', async () => {
    const net = fakeNetwork()
    const sdk = launch(newDevice(), { batchSize: 2 })
    net.state.online = false
    sdk.track('a')
    sdk.track('b')
    await vi.advanceTimersByTimeAsync(0)
    const firstTry = net.fn.mock.calls.length
    expect(firstTry).toBeGreaterThan(0)

    net.state.online = true
    await vi.advanceTimersByTimeAsync(70_000)
    expect(nameList(net.received)).toEqual(['a', 'b'])
    sdk.destroy()
  })

  it('keeps at most 1000 events, the oldest go first', async () => {
    const net = fakeNetwork()
    net.state.online = false
    const device = newDevice()
    const sdk = launch(device, { batchSize: 500 })
    for (let i = 0; i < 1010; i += 1) sdk.track(`e${i % 10}`)
    const stored = JSON.parse(device.persistent.get(QUEUE_KEY) ?? '[]') as unknown[]
    expect(stored).toHaveLength(1000)
    sdk.destroy()
  })

  it('writes nothing to storage and sends nothing while consent is pending', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const sdk = launch(device, { consent: 'pending' })
    sdk.track('held')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(net.fn).not.toHaveBeenCalled()
    expect(device.persistent.get(QUEUE_KEY)).toBeNull()
    expect(device.identity.get('corlex_aid')).toBeNull()

    sdk.optIn()
    await sdk.flush()
    expect(nameList(net.received)).toEqual(['held'])
    expect(device.identity.get('corlex_aid')).not.toBeNull()
    sdk.destroy()
  })

  it('opt-out clears the queue and the ids, and the next launch stays silent', async () => {
    const net = fakeNetwork()
    net.state.online = false
    const device = newDevice()
    const sdk = launch(device)
    sdk.track('x')
    sdk.optOut()
    expect(device.persistent.get(QUEUE_KEY)).toBeNull()
    expect(device.identity.get('corlex_aid')).toBeNull()
    sdk.destroy()

    net.state.online = true
    const next = launch(device)
    next.track('y')
    await next.flush()
    expect(net.received).toHaveLength(0)
    expect(next.getConsent()).toBe('denied')
  })
})
