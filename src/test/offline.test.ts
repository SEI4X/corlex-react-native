import { diskValue } from './kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeNetwork, launch, nameList, newDevice } from './kit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const plain = { autocapture: false } as const
const idsOf = (events: { event_id: string }[]): string[] => events.map((e) => e.event_id)

describe('offline queue on a phone', () => {
  it('offline, then online: every event arrives once, in order, with distinct ids', async () => {
    const net = fakeNetwork()
    net.state.online = false
    const { sdk, ready } = launch(newDevice(), plain)
    await ready
    for (let i = 1; i <= 25; i += 1) sdk.track(`event_${i}`)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(net.received).toHaveLength(0)

    net.state.online = true
    await vi.advanceTimersByTimeAsync(70_000)
    expect(nameList(net.received)).toEqual(Array.from({ length: 25 }, (_, i) => `event_${i + 1}`))
    expect(new Set(idsOf(net.received)).size).toBe(25)
    sdk.destroy()
  })

  it('an app restart while offline loses nothing and duplicates nothing', async () => {
    const net = fakeNetwork()
    net.state.online = false
    const device = newDevice()

    const first = launch(device, plain)
    await first.ready
    for (let i = 1; i <= 5; i += 1) first.sdk.track(`before_${i}`)
    await first.sdk.flush() // fails: offline. Events are on disk now.
    first.sdk.destroy() // the user swipes the app away

    const second = launch(device, plain)
    await second.ready
    for (let i = 1; i <= 3; i += 1) second.sdk.track(`after_${i}`)
    net.state.online = true
    await second.sdk.flush()

    expect(nameList(net.received)).toEqual([
      ...Array.from({ length: 5 }, (_, i) => `before_${i + 1}`),
      ...Array.from({ length: 3 }, (_, i) => `after_${i + 1}`),
    ])
    expect(new Set(idsOf(net.received)).size).toBe(8)
    expect(diskValue(device, 'corlex_queue')).toBe('[]')

    // A third launch has nothing left to send.
    second.sdk.destroy()
    const before = net.received.length
    const third = launch(device, plain)
    await third.ready
    await third.sdk.flush()
    expect(net.received).toHaveLength(before)
    third.sdk.destroy()
  })

  it('an event is on disk by the next task, so a kill right after track() keeps it', async () => {
    fakeNetwork().state.online = false
    const device = newDevice()
    const { sdk, ready } = launch(device, plain)
    await ready
    sdk.track('last_words')
    await vi.advanceTimersByTimeAsync(0)
    expect(diskValue(device, 'corlex_queue')).toContain('last_words')
    sdk.destroy()
  })

  it('a batch the server accepted but whose answer was lost is sent again with the same ids', async () => {
    const net = fakeNetwork()
    const device = newDevice()
    const { sdk, ready } = launch(device, plain)
    await ready
    sdk.track('maybe_twice')
    // The server stores the event, the phone never hears back (a dropped connection).
    net.fn.mockImplementationOnce(async (_url, init) => {
      net.received.push(...(JSON.parse(String(init?.body)) as { events: never[] }).events)
      throw new TypeError('Network request failed')
    })
    await sdk.flush()
    await vi.advanceTimersByTimeAsync(70_000)
    const same = net.received.filter((e) => e.name === 'maybe_twice')
    // The ingest service drops the repeat: both copies carry one event_id.
    expect(same.length).toBe(2)
    expect(new Set(idsOf(same)).size).toBe(1)
    sdk.destroy()
  })

  it('splits a long backlog into batches and sends all of it', async () => {
    const net = fakeNetwork()
    net.state.online = false
    const { sdk, ready } = launch(newDevice(), { ...plain, batchSize: 50 })
    await ready
    for (let i = 0; i < 230; i += 1) sdk.track('bulk')
    await vi.advanceTimersByTimeAsync(5_000)
    net.state.online = true
    await vi.advanceTimersByTimeAsync(70_000)
    expect(net.received).toHaveLength(230)
    expect(new Set(idsOf(net.received)).size).toBe(230)
    sdk.destroy()
  })
})
