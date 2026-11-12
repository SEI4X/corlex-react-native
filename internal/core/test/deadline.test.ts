import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { launch, newDevice } from './kit'
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('releases a hung event delivery after ten seconds and actively aborts it', async () => {
  let signal: AbortSignal | undefined,
    settled = false
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    }),
  )
  const sdk = launch(newDevice(), { config: { enabled: false } })
  try {
    sdk.track('safe_test')
    const pending = sdk.flush().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(9999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(signal?.aborted).toBe(true)
    await pending
  } finally {
    sdk.destroy()
  }
})
it('bounds config body lifetime independently of the shorter ready timeout', async () => {
  let cancelled = false,
    signal: AbortSignal | undefined,
    settled = false,
    ready = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"version":1,'))
          },
          cancel() {
            cancelled = true
          },
        }),
      )
    }),
  )
  const sdk = launch(newDevice(), { config: { timeoutMs: 1500 } })
  try {
    const pending = sdk.config.refresh().then(() => {
      settled = true
    })
    void sdk.config.ready().then(() => {
      ready = true
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(ready).toBe(true)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(8500)
    expect(settled).toBe(true)
    expect(signal?.aborted).toBe(true)
    expect(cancelled).toBe(true)
    await pending
  } finally {
    sdk.destroy()
  }
})
it('disposes an unneeded ingest body without consuming an infinite response', async () => {
  let cancelled = false
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true
            },
          }),
          { status: 202 },
        ),
    ),
  )
  const sdk = launch(newDevice(), { config: { enabled: false } })
  try {
    sdk.track('safe_test')
    await sdk.flush()
    expect(cancelled).toBe(true)
  } finally {
    sdk.destroy()
  }
})
