import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchDocument } from '../config/fetch'
import { KEY, launch, newDevice } from './kit'
let redirect: Server,
  target: Server,
  origin: string,
  targetOrigin: string,
  status = 302,
  received = 0
const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
const close = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
beforeAll(async () => {
  target = createServer((request, response) => {
    received++
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ version: 1, etag: '"one"', params: [] }))
  })
  targetOrigin = await listen(target)
  redirect = createServer((request, response) => {
    request.resume()
    response.writeHead(status, { location: `${targetOrigin}${request.url}` })
    response.end()
  })
  origin = await listen(redirect)
})
afterAll(async () => {
  await close(redirect)
  await close(target)
})
describe('SDK credential redirect boundary using actual HTTP servers', () => {
  for (const redirectStatus of [301, 302, 303, 307, 308]) {
    it(`does not forward ingest events or X-Corlex-Key across a ${redirectStatus} redirect`, async () => {
      status = redirectStatus
      received = 0
      const sdk = launch(newDevice(), { endpoint: origin, config: { enabled: false } })
      try {
        sdk.track('safe_test_launch')
        await sdk.flush()
        expect(received).toBe(0)
      } finally {
        sdk.destroy()
      }
    })
    it(`does not forward config credentials across a ${redirectStatus} redirect`, async () => {
      status = redirectStatus
      received = 0
      const result = await fetchDocument({
        endpoint: origin,
        key: KEY,
        etag: undefined,
        signal: new AbortController().signal,
        log: () => {},
      })
      expect(received).toBe(0)
      expect(result.kind).toBe('none')
    })
  }
})
