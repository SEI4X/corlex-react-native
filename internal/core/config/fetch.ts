import { standardRequest, withRequestDeadline, type SDKRequest } from '../request'
import type { ConfigDocument } from '#remote-config'
import { isConfigDocument } from './document'
import { readConfigJson } from './read'

export type Download =
  { kind: 'document'; doc: ConfigDocument } | { kind: 'unchanged' } | { kind: 'none' }

interface DownloadRequest {
  request?: SDKRequest | undefined
  endpoint: string
  key: string
  etag: string | undefined
  signal: AbortSignal
  log: (...args: unknown[]) => void
}

/**
 * `GET /v1/config/document` with the project key in `X-Corlex-Key` (never in the URL) and the
 * saved ETag in `If-None-Match`. The request carries no user id: the device evaluates. Failures
 * are not errors for the app: it keeps what it has.
 */
export async function fetchDocument(request: DownloadRequest): Promise<Download> {
  const headers: Record<string, string> = { 'X-Corlex-Key': request.key }
  if (request.etag !== undefined) headers['If-None-Match'] = request.etag
  try {
    return await withRequestDeadline(request.signal, async (signal) => {
      const res = await (request.request ?? standardRequest)(
        `${request.endpoint}/v1/config/document`,
        { headers, signal, redirect: 'error', credentials: 'omit' },
      )
      if (res.status === 304) return { kind: 'unchanged' }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        request.log(`config: the server answered ${res.status}`)
        return { kind: 'none' }
      }
      const doc = await readConfigJson(res, signal)
      return isConfigDocument(doc) ? { kind: 'document', doc } : { kind: 'none' }
    })
  } catch {
    request.log('config: could not download')
    return { kind: 'none' }
  }
}
