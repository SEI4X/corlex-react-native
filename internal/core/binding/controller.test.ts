import { describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../store'
import type { SDKRequest } from '../request'
import { BindingController, initialConsent } from './controller'
import type { BindingDriver, BoundScope, PrivacyRead } from './types'

const privacy = (
  generation = 'g1',
  state: 'granted' | 'pending' | 'denied' = 'granted',
): PrivacyRead => ({ kind: 'valid', generation, state })
function scope(owner = 'a', p = privacy()): BoundScope {
  return {
    owner,
    generation: p.kind === 'valid' ? p.generation : 'memory',
    privacy: p,
    persistent: p.kind === 'valid',
    stores: {
      persistent: new MemoryStore(),
      identity: new MemoryStore(),
      session: new MemoryStore(),
    },
  }
}
function fixture(initial = scope()) {
  let current = initial.privacy
  const driver: BindingDriver = {
    current: () => current,
    fresh: () => current,
    grant: ({ owner }) => {
      current = privacy('g2')
      return { ...scope(owner, current), choice: 'granted' }
    },
    revoke: () => {
      current = privacy('g3', 'denied')
    },
  }
  const invalidated = vi.fn()
  const controller = new BindingController({
    owner: initial.owner,
    scope: initial,
    requested: 'granted',
    driver,
    onInvalidate: invalidated,
  })
  return {
    controller,
    driver,
    invalidated,
    set: (p: PrivacyRead) => {
      current = p
    },
  }
}
const response = () => ({ status: 200, ok: true, headers: { get: () => null }, body: null })
const options = () => ({
  headers: {},
  signal: new AbortController().signal,
  redirect: 'error' as const,
  credentials: 'omit' as const,
})

describe('binding consent and fences', () => {
  it('keeps global denial/pending across owners and fails closed on unreadable state', () => {
    for (const state of ['denied', 'pending'] as const)
      expect(initialConsent({ privacy: privacy('g1', state), requested: 'granted' })).toBe(state)
    expect(initialConsent({ privacy: { kind: 'unavailable' }, requested: 'granted' })).toBe(
      'pending',
    )
    expect(initialConsent({ privacy: privacy(), requested: 'pending' })).toBe('pending')
    expect(initialConsent({ privacy: privacy(), choice: 'granted', requested: 'pending' })).toBe(
      'granted',
    )
    expect(fixture(scope('a', { kind: 'missing' })).controller.consent()).toBe('pending')
  })
  it('exposes only its bound stores; stale readers/writers cannot touch fresh state', () => {
    const a = scope('a')
    const f = fixture(a)
    a.stores.persistent.set('queue', 'old-a')
    expect(f.controller.stores.persistent.get('queue')).toBe('old-a')
    f.set(privacy('g2'))
    expect(f.controller.stores.persistent.get('queue')).toBeNull()
    expect(f.controller.stores.persistent.set('queue', 'late')).toBe(false)
    f.controller.stores.persistent.remove('queue')
    expect(a.stores.persistent.get('queue')).toBe('old-a')
    expect(f.invalidated).toHaveBeenCalledTimes(1)
    expect(f.controller.consent()).toBe('pending')
  })
  it('rejects stale read results and cleans only the stale physical write', () => {
    const a = scope()
    const f = fixture(a)
    a.stores.identity.get = () => {
      f.set(privacy('g2'))
      return 'old-id'
    }
    expect(f.controller.stores.identity.get('id')).toBeNull()
    const b = scope()
    const other = fixture(b)
    b.stores.persistent.set = () => {
      other.set(privacy('g2'))
      return true
    }
    const removed = vi.spyOn(b.stores.persistent, 'remove')
    expect(other.controller.stores.persistent.set('queue', 'old')).toBe(false)
    expect(removed).toHaveBeenCalledWith('queue')
  })
  it('never silently adopts another grant; explicit activation returns a fresh scope', async () => {
    const f = fixture()
    f.set(privacy('other'))
    expect(f.controller.consent()).toBe('pending')
    expect(await f.controller.grant()).toEqual({ preserveMemory: false })
    expect(f.controller.consent()).toBe('granted')
    expect(f.controller.scope()).toEqual({ owner: 'a', generation: 'g2', persistent: true })
    expect(f.controller.stores.persistent.get('queue')).toBeNull()
  })
  it('waits for native scope hydration after grant publication without canceling the grant', async () => {
    const f = fixture(scope('a', privacy('g1', 'pending')))
    let resolve!: (value: BoundScope) => void
    f.driver.grant = () => {
      f.set(privacy())
      return new Promise((done) => {
        resolve = done
      })
    }
    const granting = f.controller.grant()
    expect(f.controller.consent()).toBe('pending')
    expect(f.controller.stores.identity.get('id')).toBeNull()
    const send = vi.fn<SDKRequest>().mockResolvedValue(response())
    await expect(f.controller.request(send)('https://example.test', options())).rejects.toThrow(
      'SDK request interrupted',
    )
    expect(send).not.toHaveBeenCalled()
    resolve({ ...scope(), choice: 'granted' })
    expect(await granting).toEqual({ preserveMemory: true })
    expect(f.controller.consent()).toBe('granted')
    expect(f.invalidated).not.toHaveBeenCalled()
  })
  it('immediately fences an external denial or new pending generation during activation', async () => {
    for (const state of ['denied', 'pending'] as const) {
      const f = fixture(scope('a', privacy('g1', 'pending')))
      let resolve!: (value: BoundScope) => void
      f.driver.grant = () =>
        new Promise((done) => {
          resolve = done
        })
      const granting = f.controller.grant()
      f.set(privacy('external', state))
      expect(f.controller.consent()).toBe(state)
      resolve({ ...scope(), choice: 'granted' })
      expect(await granting).toEqual({ preserveMemory: false })
      expect(f.controller.consent()).toBe(state)
    }
  })
  it('does not activate a failed CAS snapshot with pending or absent scoped choice', async () => {
    for (const next of [scope(), { ...scope(), choice: 'pending' as const }]) {
      const f = fixture(scope('a', privacy('g1', 'pending')))
      f.driver.grant = () => {
        f.set(privacy())
        return next
      }
      await f.controller.grant()
      expect(f.controller.consent()).toBe('pending')
    }
  })
  it('activates a synchronous Web grant before returning its promise', () => {
    const f = fixture(scope('a', privacy('g1', 'pending')))
    const granted = f.controller.grant()
    expect(f.controller.consent()).toBe('granted')
    return granted
  })
  it('preserves memory only on initial pending to grant in the same generation', async () => {
    const f = fixture(scope('a', privacy('g1', 'pending')))
    f.driver.grant = () => {
      f.set(privacy())
      return { ...scope(), choice: 'granted' }
    }
    expect(await f.controller.grant()).toEqual({ preserveMemory: true })
    f.controller.revoke()
    expect(await f.controller.grant()).toEqual({ preserveMemory: false })
  })
  it('allows explicit fresh memory grant, without reading unavailable old storage', async () => {
    const a = scope('a', { kind: 'unavailable' })
    const f = fixture(a)
    a.stores.identity.set('id', 'must-not-read')
    f.driver.grant = () => ({ ...scope('a', { kind: 'unavailable' }), choice: 'granted' })
    expect(f.controller.stores.identity.get('id')).toBeNull()
    await f.controller.grant()
    expect(f.controller.consent()).toBe('granted')
    expect(f.controller.stores.identity.get('id')).toBeNull()
    f.set(privacy('new', 'denied'))
    expect(f.controller.consent()).toBe('denied')
  })
  it('does not accept a wrong owner or a grant resolving after revoke', async () => {
    const f = fixture()
    f.driver.grant = () => scope('b')
    await f.controller.grant()
    expect(f.controller.consent()).toBe('pending')
    let resolve!: (scope: BoundScope) => void
    f.driver.grant = () =>
      new Promise((done) => {
        resolve = done
      })
    const grant = f.controller.grant()
    f.controller.revoke()
    resolve(scope())
    await grant
    expect(f.controller.consent()).toBe('denied')
  })
})

describe('binding request authorization', () => {
  it('freshly reads native privacy before the first byte of a request', async () => {
    const f = fixture()
    const send = vi.fn<SDKRequest>().mockResolvedValue(response())
    f.driver.fresh = () => {
      f.set(privacy('g2', 'denied'))
      return privacy('g2', 'denied')
    }
    await expect(f.controller.request(send)('https://example.test', options())).rejects.toThrow(
      'SDK request interrupted',
    )
    expect(send).not.toHaveBeenCalled()
  })
  it('does not let an old native privacy read invalidate a later explicit grant', async () => {
    const f = fixture()
    let resolve!: (read: PrivacyRead) => void
    f.driver.fresh = () =>
      new Promise((done) => {
        resolve = done
      })
    const send = vi.fn<SDKRequest>().mockResolvedValue(response())
    const pending = f.controller.request(send)('https://example.test', options())
    f.controller.revoke()
    await f.controller.grant()
    resolve(privacy())
    await expect(pending).rejects.toThrow('SDK request interrupted')
    expect(send).not.toHaveBeenCalled()
    expect(f.controller.consent()).toBe('granted')
  })
  it('aborts an in-flight request synchronously before asynchronous native wipe', async () => {
    const f = fixture()
    let signal!: AbortSignal
    const send: SDKRequest = (_url, opt) => {
      signal = opt.signal
      return new Promise(() => {})
    }
    const pending = f.controller.request(send)('https://example.test', options())
    await Promise.resolve()
    await Promise.resolve()
    f.driver.revoke = () => new Promise(() => {})
    f.controller.revoke()
    expect(signal.aborted).toBe(true)
    await expect(pending).rejects.toThrow('SDK request interrupted')
  })
  it('preserves actual Fetch Response accessors while fencing the readable body', async () => {
    const f = fixture()
    const result = await f.controller.request(
      async () =>
        new Response('payload', {
          status: 202,
          headers: { 'x-proof': 'actual-fetch-response' },
        }),
    )('https://example.test', options())
    expect(result.status).toBe(202)
    expect(result.ok).toBe(true)
    expect(result.headers.get('x-proof')).toBe('actual-fetch-response')
    if (!result.body) throw new Error('missing response body')
    const reader = result.body.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('payload')
    f.controller.revoke()
    await expect(reader.read()).rejects.toThrow('SDK request interrupted')
  })
  it('fences a response body after headers have arrived', async () => {
    const f = fixture()
    const result = await f.controller.request(async () => ({
      ...response(),
      body: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1]))
        },
      }),
    }))('https://example.test', options())
    f.controller.revoke()
    if (!result.body) throw new Error('missing response body')
    await expect(result.body.getReader().read()).rejects.toThrow('SDK request interrupted')
  })
})
