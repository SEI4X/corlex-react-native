import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDocument } from '../config/fetch'
import { RemoteConfig, CONFIG_KEY } from '../config/remote-config'
import { MemoryStore } from '../store'
const LIMIT = 1024 * 1024
const request = (endpoint = 'https://config.test') => ({
  endpoint,
  key: 'synthetic-key',
  etag: undefined,
  signal: new AbortController().signal,
  log: () => {},
})
const doc = (value: unknown) => ({
  version: 1,
  etag: '"one"',
  params: [{ k: 'value', t: 'json', v: value, r: 10000 }],
})
afterEach(() => vi.unstubAllGlobals())
describe('remote config allocation boundaries', () => {
  it('bounds decoded bytes even when compressed Content-Length is small, using an actual HTTP server', async () => {
    const body = gzipSync(JSON.stringify({ ...doc(true), padding: 'x'.repeat(3 * LIMIT) }))
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(body.length),
      })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const result = await fetchDocument(
        request(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
      )
      expect(body.length).toBeLessThan(LIMIT)
      expect(result.kind).toBe('none')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
  it('cancels an excessive stream before consuming it completely', async () => {
    let produced = 0,
      cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= 3 * LIMIT) {
          controller.close()
          return
        }
        const text =
          produced === 0 ? ' {"version":1,"etag":"one","params":[],"padding":"' : 'x'.repeat(4096)
        produced += text.length
        controller.enqueue(new TextEncoder().encode(text))
      },
      cancel() {
        cancelled = true
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    )
    expect((await fetchDocument(request())).kind).toBe('none')
    expect(cancelled).toBe(true)
    expect(produced).toBeLessThan(2 * LIMIT)
  })
  for (const cached of [false, true])
    for (const [name, value] of [
      ['depth', JSON.parse('['.repeat(32) + '0' + ']'.repeat(32)) as unknown],
      ['key count', Object.fromEntries(Array.from({ length: 65537 }, (_, i) => [`k${i}`, 0]))],
      ['bytes', 'x'.repeat(2 * LIMIT)],
    ] as const)
      it(`rejects excessive ${name} before applying, cached=${cached}`, async () => {
        const store = new MemoryStore(),
          document = doc(value)
        if (cached) store.set(CONFIG_KEY, JSON.stringify({ etag: document.etag, doc: document }))
        vi.stubGlobal(
          'fetch',
          vi.fn(async () =>
            cached ? new Response('{}', { status: 404 }) : Response.json(document),
          ),
        )
        const config = new RemoteConfig({
          store,
          platform: 'web',
          endpoint: 'https://config.test',
          key: 'synthetic-key',
          live: true,
          timeoutMs: 100,
          idOf: () => 'device',
          expose: () => {},
          log: () => {},
        })
        config.start()
        try {
          await config.refresh()
          expect(Object.keys(config.getAll())).toEqual([])
        } finally {
          config.destroy()
        }
      })
})
