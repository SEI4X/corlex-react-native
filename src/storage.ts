import { stateValueAllowed } from './state-budget'
import type { KeyValueStore } from '#core'

/** The part of AsyncStorage this SDK uses. */
export interface AsyncStorageLike {
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>
  multiSet(pairs: readonly (readonly [string, string])[]): Promise<void>
  multiRemove(keys: readonly string[]): Promise<void>
  applyChanges?(pairs: readonly (readonly [string, string | null])[]): Promise<void>
}

/** Everything the SDK keeps on the device: ids, consent, the queue, the saved config. */
export const PERSISTED_KEYS = [
  'corlex_aid',
  'corlex_uid',
  'corlex_consent',
  'corlex_queue',
  'corlex_cfg',
] as const

const PREFIX = '@corlex:'

/**
 * The SDK's synchronous store on top of AsyncStorage: `hydrate()` loads the few keys into memory
 * once at start, reads then come from memory, and writes go to disk in the background. Writes are
 * serialized and coalesced: while one is in flight later changes of a key only replace its pending
 * value, so a burst of `track()` calls costs one disk write, not one per event.
 */
export class AsyncKeyValueStore implements KeyValueStore {
  private readonly cache = new Map<string, string>()
  /** Keys changed in memory and not yet on disk; `null` is a removal. */
  private readonly pending = new Map<string, string | null>()
  private writing: Promise<void> | undefined
  private scheduled = false

  constructor(
    private readonly storage: AsyncStorageLike,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  /** Loads the SDK's keys into memory. Call before the first `get`. */
  async hydrate(): Promise<void> {
    try {
      const rows = await this.storage.multiGet(PERSISTED_KEYS.map((k) => PREFIX + k))
      for (const [name, value] of rows) {
        const key = name.slice(PREFIX.length)
        // A value written between hydrate() starting and finishing is newer than the disk.
        if (
          value !== null &&
          stateValueAllowed(key, value) &&
          !this.cache.has(key) &&
          !this.pending.has(key)
        ) {
          this.cache.set(key, value)
        }
      }
    } catch (error) {
      this.onError(error)
    }
  }

  get(key: string): string | null {
    return this.cache.get(key) ?? null
  }

  set(key: string, value: string): boolean {
    if (!PERSISTED_KEYS.some((item) => item === key)) return false
    this.cache.set(key, value)
    if (!stateValueAllowed(key, value)) {
      // Too big for the disk: it stays in memory for this launch and is not lost for the session.
      this.pending.delete(key)
      return false
    }
    this.pending.set(key, value)
    this.schedule()
    return true
  }

  remove(key: string): void {
    this.cache.delete(key)
    this.pending.set(key, null)
    this.schedule()
  }

  /** Resolves when everything changed so far is on disk (or failed: errors never throw). */
  async flushNow(): Promise<void> {
    this.scheduled = false
    while (this.pending.size > 0 || this.writing !== undefined) {
      this.writing ??= this.writeOnce().finally(() => {
        this.writing = undefined
      })
      await this.writing
    }
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    // After the current task: every change made in it is written together.
    queueMicrotask(() => {
      if (this.scheduled) void this.flushNow()
    })
  }

  private async writeOnce(): Promise<void> {
    const batch = [...this.pending]
    this.pending.clear()
    const sets = batch.filter((e): e is [string, string] => e[1] !== null)
    const removals = batch.filter(([, value]) => value === null).map(([key]) => PREFIX + key)
    try {
      if (this.storage.applyChanges) {
        await this.storage.applyChanges(batch.map(([key, value]) => [PREFIX + key, value]))
        return
      }
      if (sets.length > 0) await this.storage.multiSet(sets.map(([k, v]) => [PREFIX + k, v]))
      if (removals.length > 0) await this.storage.multiRemove(removals)
    } catch (error) {
      this.onError(error)
    }
  }
}
