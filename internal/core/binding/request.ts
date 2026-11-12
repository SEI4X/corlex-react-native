import type { SDKRequest, SDKResponse } from '../request'
import { interrupted } from './fence'

export function guardedRequest(input: {
  request: SDKRequest
  refresh(): Promise<void>
  check(): void
  attach(controller: AbortController): () => void
}): SDKRequest {
  return async (url, options) => {
    await input.refresh()
    input.check()
    if (options.signal.aborted) throw interrupted()
    const controller = new AbortController()
    const detach = input.attach(controller)
    let reject!: (error: Error) => void
    const cancelled = new Promise<never>((_resolve, fail) => {
      reject = fail
    })
    const stop = () => {
      controller.abort()
      reject(interrupted())
    }
    options.signal.addEventListener('abort', stop, { once: true })
    controller.signal.addEventListener('abort', () => reject(interrupted()), { once: true })
    const cleanup = () => {
      detach()
      options.signal.removeEventListener('abort', stop)
    }
    try {
      const response = await Promise.race([
        input.request(url, { ...options, signal: controller.signal }),
        cancelled,
      ])
      input.check()
      if (controller.signal.aborted) throw interrupted()
      return guardedBody({
        response,
        cleanup,
        cancelled,
        check: () => {
          input.check()
          if (controller.signal.aborted) throw interrupted()
        },
      })
    } catch (failure) {
      cleanup()
      throw failure
    }
  }
}

function guardedBody(input: {
  response: SDKResponse
  cleanup(): void
  cancelled: Promise<never>
  check(): void
}): SDKResponse {
  if (!input.response.body) {
    input.cleanup()
    return input.response
  }
  const reader = input.response.body.getReader()
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          input.check()
          const result = await Promise.race([reader.read(), input.cancelled])
          input.check()
          if (result.done) {
            input.cleanup()
            controller.close()
          } else controller.enqueue(result.value)
        } catch (failure) {
          input.cleanup()
          void reader.cancel().catch(() => {})
          controller.error(failure)
        }
      },
      async cancel() {
        input.cleanup()
        await reader.cancel()
      },
    },
    { highWaterMark: 0 },
  )
  return {
    status: input.response.status,
    ok: input.response.ok,
    headers: input.response.headers,
    body,
  }
}
