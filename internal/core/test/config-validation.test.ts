import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteConfig, CONFIG_KEY } from '../config/remote-config'
import { MemoryStore } from '../store'
const valid = {
  version: 1,
  etag: '"one"',
  params: [{ k: 'enabled', t: 'bool', v: true, r: 10000 }],
}
const options = (store = new MemoryStore()) => ({
  store,
  platform: 'web',
  endpoint: 'https://config.test',
  key: 'synthetic-config-key',
  live: true,
  timeoutMs: 100,
  idOf: () => 'synthetic-device',
  expose: () => {},
  log: () => {},
})
afterEach(() => vi.unstubAllGlobals())
describe('untrusted compiled config', () => {
  const malformed = [
    { ...valid, experiments: [null] },
    { ...valid, experiments: [{ k: 'exp', s: 'salt', v: null }] },
    {
      ...valid,
      experiments: [
        {
          k: 'exp',
          s: 'salt',
          v: [
            { n: 'control', b: 0, v: false },
            { n: 'b', b: 10000, v: true },
          ],
        },
      ],
    },
    {
      ...valid,
      experiments: [
        {
          k: 'exp',
          s: 'salt',
          v: [
            { n: 'control', b: 5000, v: false },
            { n: 'b', b: 5000, v: true },
            { n: 'c', b: 10000, v: true },
          ],
        },
      ],
    },
    { ...valid, params: [{ k: 'enabled', t: 'bool', v: true, r: 10000, o: null }] },
    { ...valid, params: [{ k: 'enabled', t: 'bool', v: { unexpected: true }, r: 10000 }] },
  ]
  for (const [index, doc] of malformed.entries())
    for (const cached of [false, true])
      it(`ignores malformed document ${index}, cached=${cached}`, async () => {
        const store = new MemoryStore()
        if (cached) store.set(CONFIG_KEY, JSON.stringify({ etag: doc.etag, doc }))
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => (cached ? new Response('{}', { status: 404 }) : Response.json(doc))),
        )
        const config = new RemoteConfig(options(store))
        config.start()
        try {
          await config.ready()
          expect(() => config.get('enabled', false)).not.toThrow()
          expect(() => config.experiment('exp')).not.toThrow()
          expect(config.get('enabled', false)).toBe(false)
          expect(config.getAll()).toEqual({})
        } finally {
          config.destroy()
        }
      })
  for (const key of ['__proto__', 'constructor', 'prototype'])
    for (const cached of [false, true])
      it(`rejects reserved resolved key ${key}, cached=${cached}`, async () => {
        const store = new MemoryStore(),
          doc = { ...valid, params: [{ k: key, t: 'json', v: { polluted: true }, r: 10000 }] }
        if (cached) store.set(CONFIG_KEY, JSON.stringify({ etag: doc.etag, doc }))
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => (cached ? new Response('{}', { status: 404 }) : Response.json(doc))),
        )
        const config = new RemoteConfig(options(store))
        config.start()
        try {
          await config.ready()
          const result = config.getAll()
          expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
          expect(Object.keys(result)).toEqual([])
          expect(result['polluted']).toBeUndefined()
        } finally {
          config.destroy()
        }
      })
  it('does not let a linked experiment change the resolved map prototype', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...valid,
          experiments: [
            {
              k: 'exp',
              s: 'salt',
              p: '__proto__',
              v: [
                { n: 'a', b: 5000, v: { polluted: true } },
                { n: 'b', b: 10000, v: { polluted: true } },
              ],
            },
          ],
        }),
      ),
    )
    const config = new RemoteConfig(options())
    config.start()
    try {
      await config.ready()
      expect(Object.getPrototypeOf(config.getAll())).toBe(Object.prototype)
      expect(config.getAll()['polluted']).toBeUndefined()
    } finally {
      config.destroy()
    }
  })
  it('isolates throwing update listeners and never logs their message', async () => {
    const log = vi.fn(),
      second = vi.fn(),
      secret = 'synthetic-user@example.test'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(valid)),
    )
    const config = new RemoteConfig({ ...options(), log })
    config.onUpdate(() => {
      throw new Error(secret)
    })
    config.onUpdate(second)
    config.start()
    try {
      await expect(config.ready()).resolves.toBeUndefined()
      expect(second).toHaveBeenCalledOnce()
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret)
    } finally {
      config.destroy()
    }
  })
})
