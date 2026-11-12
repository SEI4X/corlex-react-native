import { afterEach, expect, it, vi } from 'vitest'
import { RemoteConfig, CONFIG_KEY } from '../config/remote-config'
import * as transport from '../config/fetch'
import type { Download } from '../config/fetch'
import { MemoryStore } from '../store'
const doc = {
  version: 1,
  etag: '"safe"',
  params: [{ k: 'enabled', t: 'bool' as const, v: true, r: 10000 }],
}
const options = (store = new MemoryStore()) => ({
  store,
  platform: 'web',
  endpoint: 'https://config.test',
  key: 'synthetic_key',
  live: true,
  timeoutMs: 100,
  idOf: () => 'synthetic',
  expose: () => {},
  log: () => {},
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('immediately fetches a fresh config after stop/regrant instead of sharing an aborted request', async () => {
  const first = deferred<Response>()
  const request = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(Response.json(doc))
  vi.stubGlobal('fetch', request)
  const config = new RemoteConfig(options())
  config.start()
  const old = config.refresh()
  config.stop(true)
  config.start()
  try {
    await config.ready()
    expect(request).toHaveBeenCalledTimes(2)
    expect(config.get('enabled', false)).toBe(true)
  } finally {
    config.destroy()
    first.resolve(new Response('{}', { status: 404 }))
    await old
  }
})
it('never applies an old generation or lets its finalizer clear a fresh in-flight request', async () => {
  const oldReply = deferred<Download>(),
    freshReply = deferred<Download>()
  const fetch = vi
    .spyOn(transport, 'fetchDocument')
    .mockReturnValueOnce(oldReply.promise)
    .mockReturnValueOnce(freshReply.promise)
    .mockResolvedValue({ kind: 'none' })
  const config = new RemoteConfig(options()),
    update = vi.fn()
  config.onUpdate(update)
  config.start()
  const old = config.refresh()
  config.stop(true)
  config.start()
  const fresh = config.refresh()
  try {
    oldReply.resolve({ kind: 'document', doc })
    await old
    expect(config.get('enabled', false)).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(config.refresh()).toBe(fresh)
    expect(fetch).toHaveBeenCalledTimes(2)
    freshReply.resolve({ kind: 'document', doc: { ...doc, version: 2 } })
    await fresh
    expect(config.get('enabled', false)).toBe(true)
    expect(update).toHaveBeenCalledOnce()
  } finally {
    config.destroy()
    oldReply.resolve({ kind: 'none' })
    freshReply.resolve({ kind: 'none' })
  }
})
it.each([...Array.from({ length: 32 }, (_, i) => i), 127])(
  'rejects cached ETag control byte %i before refreshing headers',
  async (code) => {
    const store = new MemoryStore(),
      etag = '"bad' + String.fromCharCode(code) + '"'
    store.set(CONFIG_KEY, JSON.stringify({ etag, doc: { ...doc, etag } }))
    const request = vi.fn<typeof fetch>(async () => Response.json(doc))
    vi.stubGlobal('fetch', request)
    const config = new RemoteConfig(options(store))
    config.start()
    try {
      await config.ready()
      expect(
        (request.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined)?.[
          'If-None-Match'
        ],
      ).toBeUndefined()
      expect(config.get('enabled', false)).toBe(true)
    } finally {
      config.destroy()
    }
  },
)
it.each(['é', '😄', '\u0080', '\ud800'])(
  'rejects non-ASCII ETag %s from cache and network before Headers construction',
  async (tag) => {
    for (const cached of [true, false]) {
      const store = new MemoryStore(),
        bad = { ...doc, etag: '"' + tag + '"' }
      if (cached) store.set(CONFIG_KEY, JSON.stringify({ etag: bad.etag, doc: bad }))
      const request = vi.fn<typeof fetch>(async (...args) => {
        new Headers(args[1]?.headers)
        return Response.json(cached ? doc : bad)
      })
      vi.stubGlobal('fetch', request)
      const config = new RemoteConfig(options(store))
      config.start()
      try {
        await config.ready()
        expect(
          (request.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined)?.[
            'If-None-Match'
          ],
        ).toBeUndefined()
        expect(config.get('enabled', false)).toBe(cached)
      } finally {
        config.destroy()
      }
    }
  },
)

it('accepts printable ASCII ETags that the actual Headers constructor can send', async () => {
  const etag =
    '"' + Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join('') + '"'
  expect(() => new Headers({ 'If-None-Match': etag })).not.toThrow()
  const store = new MemoryStore(),
    valid = { ...doc, etag }
  store.set(CONFIG_KEY, JSON.stringify({ etag, doc: valid }))
  const request = vi.fn<typeof fetch>(async (...args) => {
    new Headers(args[1]?.headers)
    return new Response(null, { status: 304 })
  })
  vi.stubGlobal('fetch', request)
  const config = new RemoteConfig(options(store))
  config.start()
  try {
    await config.ready()
    expect(config.get('enabled', false)).toBe(true)
  } finally {
    config.destroy()
  }
})
