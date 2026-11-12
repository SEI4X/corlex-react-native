import type { KeyValueStore } from '../store'
import { MemoryStore } from '../store'
import type { PlatformStores } from '../platform'

/** The driver must already enforce physical owner/generation isolation and native write CAS. */
export function guardedStores(input: {
  allowed(): boolean
  stores(): PlatformStores
}): PlatformStores {
  const wrap = (name: keyof PlatformStores): KeyValueStore => ({
    get(key) {
      if (!input.allowed()) return null
      try {
        const value = input.stores()[name].get(key)
        return input.allowed() ? value : null
      } catch {
        return null
      }
    },
    set(key, value) {
      if (!input.allowed()) return false
      const target = input.stores()[name]
      try {
        const saved = target.set(key, value)
        if (input.allowed()) return saved
        // This target is immutable old-generation storage; never remove a newer scope's row.
        target.remove(key)
      } catch {
        /* unavailable persistence must not escape into host code */
      }
      return false
    },
    remove(key) {
      if (!input.allowed()) return
      try {
        input.stores()[name].remove(key)
      } catch {
        /* best-effort SDK-only cleanup */
      }
    },
  })
  return { persistent: wrap('persistent'), identity: wrap('identity'), session: wrap('session') }
}

export const memoryStores = (): PlatformStores => ({
  persistent: new MemoryStore(),
  identity: new MemoryStore(),
  session: new MemoryStore(),
})
