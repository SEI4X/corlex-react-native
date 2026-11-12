import { afterEach, describe, expect, it, vi } from 'vitest'
import { byteLength, truncateBytes, uuid } from '../util'

afterEach(() => vi.unstubAllGlobals())

describe('byteLength', () => {
  it.each(['', 'abc', 'Привет', '日本語', '😀 emoji', 'a\u0000b', '\ud800', 'x'.repeat(1000)])(
    'matches TextEncoder for %j',
    (s) => {
      expect(byteLength(s)).toBe(new TextEncoder().encode(s).length)
    },
  )
})

describe('truncateBytes', () => {
  it('never splits a character and never exceeds the limit', () => {
    const cut = truncateBytes('я'.repeat(10), 7)
    expect(byteLength(cut)).toBeLessThanOrEqual(7)
    expect(cut).toBe('я'.repeat(3))
  })
})

describe('uuid', () => {
  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('makes a v4 id without crypto (Hermes before React Native 0.8x)', () => {
    vi.stubGlobal('crypto', undefined)
    const made = new Set(Array.from({ length: 200 }, uuid))
    expect(made.size).toBe(200)
    for (const id of made) expect(id).toMatch(shape)
  })

  it('uses getRandomValues when randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: (b: Uint8Array) => b.fill(7) })
    expect(uuid()).toMatch(shape)
  })
})
