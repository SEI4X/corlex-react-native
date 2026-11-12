import { afterEach, expect, it, vi } from 'vitest'
import { EventQueue, QUEUE_KEY } from '../queue'
import { byteLength, truncateBytes } from '../util'
import { fakeNetwork, launch, newDevice } from './kit'
import type { WireEvent } from '../types'

afterEach(() => vi.unstubAllGlobals())
it.each(['[null]', '[1]', '[{}]', '[{"event_id":"x"}]'])(
  'rejects corrupt cached entries without crashing delivery: %s',
  async (cache) => {
    const device = newDevice(),
      net = fakeNetwork()
    device.persistent.set(QUEUE_KEY, cache)
    const sdk = launch(device, { config: { enabled: false } })
    try {
      expect(() => sdk.track('safe_test')).not.toThrow()
      await expect(sdk.flush()).resolves.toBeUndefined()
      expect(net.received.map((event) => event.name)).toEqual(['safe_test'])
    } finally {
      sdk.destroy()
    }
  },
)
function event(properties: Record<string, unknown> = {}): WireEvent {
  return {
    event_id: '12345678-1234-4234-9234-123456789012',
    name: 'safe_test',
    timestamp: '2026-01-01T00:00:00.000Z',
    anonymous_id: 'anon',
    properties,
    context: { platform: 'web', sdk: { name: 'test', version: '1' } },
  }
}
it('bounds persisted bytes and deterministically retains newest events', () => {
  const store = newDevice().persistent,
    queue = new EventQueue(store, true)
  for (let i = 0; i < 600; i++)
    queue.push({ ...event({ text: 'x'.repeat(8000) }), event_id: String(i) })
  const stored = store.get(QUEUE_KEY) ?? ''
  expect(byteLength(stored)).toBeLessThanOrEqual(2 * 1024 * 1024)
  const rows = JSON.parse(stored) as WireEvent[]
  expect(rows.at(-1)?.event_id).toBe('599')
  expect(Number(rows[0]?.event_id)).toBeGreaterThan(0)
})
it('accepts a legitimate queue with more than 65536 property keys', () => {
  const store = newDevice().persistent
  const properties = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, i]))
  const rows = Array.from({ length: 1000 }, () => event(properties))
  const text = JSON.stringify(rows)
  expect(byteLength(text)).toBeLessThan(2 * 1024 * 1024)
  store.set(QUEUE_KEY, text)
  expect(new EventQueue(store, true).size).toBe(1000)
})
it('rejects oversized/deep cache before delivery', () => {
  const store = newDevice().persistent
  for (const text of [
    ' '.repeat(2 * 1024 * 1024) + '[]',
    '['.repeat(1000) + '0' + ']'.repeat(1000),
  ]) {
    store.set(QUEUE_KEY, text)
    expect(new EventQueue(store, true).size).toBe(0)
    expect(store.get(QUEUE_KEY)).toBeNull()
  }
})
it.each([1, 2, 3, 4, 5])('keeps whole emoji at byte budget %s', (budget) => {
  expect(truncateBytes('a😀', budget)).toBe(budget < 5 ? 'a' : 'a😀')
})

it.each(['a'.repeat(65), 'a'.repeat(128), 'corlex.identify'])(
  'preserves valid wire names across restart: %s',
  (name) => {
    const store = newDevice().persistent
    const row = { ...event(), name, user_id: 'я'.repeat(128) }
    store.set(QUEUE_KEY, JSON.stringify([row]))
    expect(new EventQueue(store, true).peek(1)).toEqual([row])
  },
)
