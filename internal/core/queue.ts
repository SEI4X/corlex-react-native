import { eventBytes, MAX_QUEUE_BYTES, queueBytes, readQueue } from './queue-cache'
import type { KeyValueStore } from './store'
import type { WireEvent } from './types'

export const QUEUE_KEY = 'corlex_queue'
/** Oldest events go first when a person stays offline for long. */
export const MAX_QUEUE = 1000

function load(store: KeyValueStore): WireEvent[] {
  try {
    const raw = store.get(QUEUE_KEY)
    if (raw === null) return []
    const parsed = readQueue(raw)
    if (parsed) return parsed
    store.remove(QUEUE_KEY)
    return []
  } catch {
    return []
  }
}

/**
 * Events waiting for delivery: in memory, mirrored to the platform's store so a reload, a crash or
 * a restart does not lose them. An event leaves the queue only after the server acknowledged it
 * (or rejected it for good).
 */
export class EventQueue {
  private items: WireEvent[]
  private bytes: number

  /** `persisted` false keeps events in memory only (consent pending). */
  constructor(
    private readonly store: KeyValueStore,
    private persisted: boolean,
  ) {
    this.items = persisted ? load(store) : []
    this.bytes = queueBytes(this.items)
    const count = this.items.length
    this.trim()
    if (this.items.length !== count) this.save()
  }

  get size(): number {
    return this.items.length
  }

  push(event: WireEvent): void {
    this.bytes += eventBytes(event) + (this.items.length > 0 ? 1 : 0)
    this.items.push(event)
    this.trim()
    this.save()
  }

  has(eventId: string): boolean {
    return this.items.some((e) => e.event_id === eventId)
  }

  peek(count: number): WireEvent[] {
    return this.items.slice(0, count)
  }

  /** Removes exactly the events of a delivered or dropped batch. */
  drop(batch: readonly WireEvent[]): void {
    const ids = new Set(batch.map((e) => e.event_id))
    this.items = this.items.filter((e) => !ids.has(e.event_id))
    this.bytes = queueBytes(this.items)
    this.save()
  }

  clear(): void {
    this.items = []
    this.bytes = 2
    this.store.remove(QUEUE_KEY)
  }

  private trim(): void {
    while (this.items.length > MAX_QUEUE || this.bytes > MAX_QUEUE_BYTES) {
      const oldest = this.items.shift()
      if (!oldest) break
      this.bytes -= eventBytes(oldest) + (this.items.length > 0 ? 1 : 0)
    }
  }

  private save(): void {
    if (this.persisted) this.store.set(QUEUE_KEY, JSON.stringify(this.items))
  }

  /** Consent arrived: start mirroring the queue to storage. */
  enablePersistence(): void {
    this.persisted = true
    this.save()
  }
}
