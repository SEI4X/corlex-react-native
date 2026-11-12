/** Minimal HTTP surface shared with the native platform adapter, not a global fetch override. */
export interface SDKResponse {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
}
export interface SDKRequestOptions {
  method?: string
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
  redirect: 'error'
  credentials: 'omit'
  keepalive?: true
}
export type SDKRequest = (url: string, options: SDKRequestOptions) => Promise<SDKResponse>
export const standardRequest: SDKRequest = (url, options) => globalThis.fetch(url, options)
export const REQUEST_TIMEOUT_MS = 10000

/** Bounds the complete operation (headers AND body), forwarding consent/lifecycle cancellation. */
export function withRequestDeadline<T>(
  parent: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parent.aborted) return Promise.reject(new Error('SDK request interrupted'))
  const controller = new AbortController()
  let rejectStopped: ((error: Error) => void) | undefined
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject
  })
  const stop = () => {
    controller.abort()
    rejectStopped?.(new Error('SDK request interrupted'))
  }
  parent.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(stop, REQUEST_TIMEOUT_MS)
  let operation: Promise<T>
  try {
    operation = run(controller.signal)
  } catch (failure) {
    operation = Promise.reject(failure)
  }
  return Promise.race([operation, stopped]).finally(() => {
    clearTimeout(timer)
    parent.removeEventListener('abort', stop)
  })
}
