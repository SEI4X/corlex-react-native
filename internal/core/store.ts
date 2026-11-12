/**
 * Where an SDK keeps its few small values (ids, the queue, the saved config, the consent choice).
 * It is synchronous on purpose: the core never awaits storage. A platform with asynchronous
 * storage (React Native's AsyncStorage) loads its keys into memory first and writes behind.
 */
export interface KeyValueStore {
  get(key: string): string | null
  /** Returns false when the value could not be stored (full or blocked storage). */
  set(key: string, value: string): boolean
  remove(key: string): void
}

/** Values that live as long as the process: sessions on mobile, tests, and "no consent yet". */
export class MemoryStore implements KeyValueStore {
  private readonly values = new Map<string, string>()

  get(key: string): string | null {
    return this.values.get(key) ?? null
  }

  set(key: string, value: string): boolean {
    this.values.set(key, value)
    return true
  }

  remove(key: string): void {
    this.values.delete(key)
  }
}
