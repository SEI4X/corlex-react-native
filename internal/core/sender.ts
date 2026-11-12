import { standardRequest, withRequestDeadline, type SDKRequest } from './request'
import { byteLength } from './util'
import type { EventQueue } from './queue'
import type { WireEvent } from './types'

export interface SenderOptions {
  request?: SDKRequest | undefined
  endpoint: string
  key: string
  batchSize: number
  flushIntervalMs: number
  /**
   * Browsers only: the page may be closing, so the unload flush (`flush({ unload: true })`) sends
   * with `fetch` `keepalive`. Ordinary flushes never do. Apps pass false.
   */
  keepalive: boolean
  log: (...args: unknown[]) => void
}

type Outcome =
  | { kind: 'ok' }
  | { kind: 'drop'; status: number }
  | { kind: 'split' }
  | { kind: 'halt'; status: number }
  | { kind: 'retry'; retryAfterMs?: number }

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 60_000
const RETRY_AFTER_MAX_MS = 5 * 60_000
/**
 * Browsers cap the bodies of all in-flight keepalive requests together at 64 KiB and refuse the
 * rest with a TypeError, so an unload chunk stays well below that.
 */
const KEEPALIVE_MAX_BYTES = 60_000

export interface FlushOptions {
  /** The page is going away: use `keepalive`, in chunks that fit the browser's quota. */
  unload?: boolean
}

/** `Retry-After` as milliseconds; only the seconds form is used. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined
  return Math.min(Number(value) * 1000, RETRY_AFTER_MAX_MS)
}

/** Exponential backoff with equal jitter: half fixed, half random. */
export function backoffDelay(attempt: number): number {
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS)
  return ceiling / 2 + (Math.random() * ceiling) / 2
}

function classify(status: number, retryAfter: string | null, count: number): Outcome {
  if (status >= 200 && status < 300) return { kind: 'ok' }
  if (status === 401 || status === 403) return { kind: 'halt', status }
  if (status === 413) return count > 1 ? { kind: 'split' } : { kind: 'drop', status }
  if (status === 429 || status >= 500) {
    const retryAfterMs = parseRetryAfter(retryAfter)
    return retryAfterMs === undefined ? { kind: 'retry' } : { kind: 'retry', retryAfterMs }
  }
  return { kind: 'drop', status }
}

/**
 * Delivers the queue to `POST /v1/batch`. The key travels in the `X-Corlex-Key` header, never in
 * a URL. In a browser the request uses `keepalive`, so it survives the page being closed;
 * `sendBeacon` (no custom headers) is not used.
 */
export class Sender {
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> | undefined
  private attempts = 0
  private backingOff = false
  private limit: number
  private paused = false
  private generation = 0
  private abort: AbortController | undefined
  private rejected = false
  /** Bytes of keepalive bodies sent and not answered yet (the browser's quota is shared). */
  private keepaliveInFlight = 0
  private unloading = false

  constructor(
    private queue: EventQueue,
    private options: SenderOptions,
  ) {
    this.limit = options.batchSize
  }

  /** Called after an event was queued: send now when a batch is full, else on the interval. */
  schedule(): void {
    if (this.stopped || this.queue.size === 0 || this.backingOff) return
    if (this.queue.size >= this.options.batchSize) {
      void this.flush()
    } else if (this.timer === undefined) {
      this.arm(this.options.flushIntervalMs)
    }
  }

  /**
   * Sends everything queued. Resolves when the queue is empty or delivery failed for real (the
   * server or the network said no, a retry is then scheduled). A refused keepalive request is
   * not a failure: the chunk is sent again without it.
   */
  flush(options: FlushOptions = {}): Promise<void> {
    if (options.unload === true && this.options.keepalive) this.unloading = true
    this.inflight ??= this.drain().finally(() => {
      this.inflight = undefined
      if (!this.stopped && !this.backingOff) this.schedule()
    })
    return this.inflight
  }

  /** Opt-out: stop sending until `resume()`. */
  stop(): void {
    this.paused = true
    this.generation += 1
    this.abort?.abort()
    this.unloading = false
    this.disarm()
  }

  resume(): void {
    this.paused = false
    this.schedule()
  }

  private get stopped(): boolean {
    return this.paused || this.rejected
  }

  private arm(delay: number): void {
    this.disarm()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.backingOff = false
      void this.flush()
    }, delay)
  }

  private disarm(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async drain(): Promise<void> {
    this.disarm()
    this.backingOff = false
    const generation = this.generation
    while (!this.stopped && this.queue.size > 0) {
      const batch = this.nextBatch()
      const outcome = await this.post(batch, generation)
      if (generation !== this.generation) return
      if (!this.apply(outcome, batch)) return
    }
    this.unloading = false
  }

  /** Returns whether the drain loop may continue. */
  private apply(outcome: Outcome, batch: WireEvent[]): boolean {
    const { log } = this.options
    switch (outcome.kind) {
      case 'ok':
        this.attempts = 0
        this.limit = Math.min(this.limit * 2, this.options.batchSize)
        this.queue.drop(batch)
        return true
      case 'drop':
        log(`dropping ${batch.length} event(s): server answered ${outcome.status}`)
        this.queue.drop(batch)
        return true
      case 'split':
        this.limit = Math.max(1, Math.floor(batch.length / 2))
        return true
      case 'halt':
        console.warn(`[corlex] key rejected (${outcome.status}); events are not sent`)
        this.rejected = true
        this.queue.clear()
        return false
      default:
        this.retryLater(outcome.retryAfterMs)
        return false
    }
  }

  private retryLater(retryAfterMs: number | undefined): void {
    this.attempts += 1
    const delay = Math.max(backoffDelay(this.attempts), retryAfterMs ?? 0)
    this.options.log(`delivery failed, retry in ${Math.round(delay)} ms (attempt ${this.attempts})`)
    this.backingOff = true
    this.arm(delay)
  }

  /** An unload chunk is cut by size so that it fits the keepalive quota; otherwise by count. */
  private nextBatch(): WireEvent[] {
    const batch = this.queue.peek(this.limit)
    if (!this.unloading) return batch
    let bytes = 0
    const chunk: WireEvent[] = []
    for (const event of batch) {
      bytes += byteLength(JSON.stringify(event)) + 1
      if (bytes > KEEPALIVE_MAX_BYTES && chunk.length > 0) break
      chunk.push(event)
    }
    return chunk
  }

  private async post(batch: WireEvent[], generation: number): Promise<Outcome> {
    const body = JSON.stringify({ events: batch })
    const size = byteLength(body)
    const useKeepalive =
      this.unloading &&
      size <= KEEPALIVE_MAX_BYTES &&
      this.keepaliveInFlight + size <= KEEPALIVE_MAX_BYTES
    try {
      return await this.send(body, useKeepalive, batch.length)
    } catch {
      // Over the browser's keepalive quota the request is refused before it leaves: that is not
      // the network failing, so the same chunk goes out as an ordinary request.
      if (this.stopped || generation !== this.generation || !useKeepalive) return { kind: 'retry' }
      try {
        return await this.send(body, false, batch.length)
      } catch {
        return { kind: 'retry' }
      }
    }
  }

  private async send(body: string, keepalive: boolean, count: number): Promise<Outcome> {
    const size = byteLength(body)
    const abort = new AbortController()
    this.abort = abort
    if (keepalive) this.keepaliveInFlight += size
    try {
      return await withRequestDeadline(abort.signal, async (signal) => {
        const res = await (this.options.request ?? standardRequest)(
          `${this.options.endpoint}/v1/batch`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Corlex-Key': this.options.key },
            body,
            signal,
            redirect: 'error',
            credentials: 'omit',
            ...(keepalive ? { keepalive: true as const } : {}),
          },
        )
        const outcome = classify(res.status, res.headers.get('Retry-After'), count)
        await res.body?.cancel().catch(() => undefined)
        return outcome
      })
    } finally {
      if (this.abort === abort) this.abort = undefined
      if (keepalive) this.keepaliveInFlight -= size
    }
  }
}
