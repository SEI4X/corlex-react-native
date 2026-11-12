import { afterEach, describe, expect, it, vi } from 'vitest'
import { CorlexCore } from '../client'
import type { Platform } from '../platform'
import type { BaseInitOptions, WireEvent } from '../types'
import { KEY, newDevice } from './kit'
function browserSdk() {
  const platform: Platform<BaseInitOptions> = {
    name: 'web',
    keepalive: true,
    stores: newDevice(),
    context: () => ({ platform: 'web', sdk: { name: 'corlex-test', version: 'test' } }),
    eventProperties: () => ({}),
    isBlocked: () => false,
    start: () => () => {},
    onConsentGranted: () => {},
    onOptOut: () => {},
  }
  const sdk = new CorlexCore(platform)
  sdk.init({ key: KEY, endpoint: 'https://ingest.test', config: { enabled: false }, batchSize: 20 })
  return sdk
}
afterEach(() => vi.unstubAllGlobals())
describe('consent withdrawal while a request is pending', () => {
  for (const regrant of [false, true])
    it(`never resends an old keepalive body after optOut, regrant=${regrant}`, async () => {
      let rejectFirst: ((failure: Error) => void) | undefined
      const sent: WireEvent[][] = []
      const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        sent.push((JSON.parse(String(init?.body)) as { events: WireEvent[] }).events)
        if (sent.length === 1)
          return new Promise<Response>((_resolve, reject) => {
            rejectFirst = reject
          })
        return new Response('{}', { status: 202 })
      })
      vi.stubGlobal('fetch', fetch)
      const sdk = browserSdk()
      try {
        sdk.track('before_withdrawal')
        const first = sdk.flush({ unload: true })
        expect(fetch).toHaveBeenCalledTimes(1)
        sdk.optOut()
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
        if (regrant) {
          sdk.optIn()
          sdk.track('after_new_consent')
        }
        rejectFirst?.(new TypeError('keepalive refused'))
        await first
        if (regrant) await sdk.flush()
        expect(sent.flat().filter((event) => event.name === 'before_withdrawal')).toHaveLength(1)
        expect(sent.flat().filter((event) => event.name === 'after_new_consent')).toHaveLength(
          regrant ? 1 : 0,
        )
        if (!regrant) expect(fetch).toHaveBeenCalledTimes(1)
      } finally {
        sdk.destroy()
      }
    })
})
