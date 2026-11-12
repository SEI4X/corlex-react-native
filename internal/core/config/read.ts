import type { SDKResponse } from '../request'
import { MAX_CONFIG_BYTES, MAX_CONFIG_DEPTH } from './document'
import { byteLength } from '../util'
/** Count nesting and object keys before JSON.parse can allocate an excessive tree. */
export function parseBoundedJson(text: string, maxDepth = MAX_CONFIG_DEPTH): unknown {
  if (text.length > MAX_CONFIG_BYTES + 1024 || byteLength(text) > MAX_CONFIG_BYTES + 1024)
    return undefined
  let quoted = false,
    escaped = false,
    depth = 0,
    keys = 0
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{' || char === '[') {
      if (++depth > maxDepth) return undefined
    } else if (char === '}' || char === ']') {
      if (--depth < 0) return undefined
    } else if (char === ':' && ++keys > 65536) return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
/** Bound decoded bytes, independent of missing, false or compressed Content-Length headers. */
export async function readConfigJson(response: SDKResponse, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const stop = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0,
    text = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_CONFIG_BYTES) return undefined
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return parseBoundedJson(text)
  } finally {
    signal.removeEventListener('abort', stop)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
