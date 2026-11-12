import { byteLength } from '#core'
import type { AsyncStorageLike } from './storage'
import { readState, STATE_MAX_BYTES, stateValueAllowed } from './state-budget'

interface Bridge {
  readSdkState(): Promise<string>
  writeSdkState(json: string): Promise<void>
}
function stateBridge(value: unknown): value is Bridge {
  return (
    value !== null &&
    typeof value === 'object' &&
    'readSdkState' in value &&
    typeof value.readSdkState === 'function' &&
    'writeSdkState' in value &&
    typeof value.writeSdkState === 'function'
  )
}
const keyOf = (key: string): string => (key.startsWith('@corlex:') ? key.slice(8) : '')
const KEYS = new Set(['corlex_aid', 'corlex_uid', 'corlex_consent', 'corlex_queue', 'corlex_cfg'])

/** Dedicated native state only; no AsyncStorage fallback, host rows or host backup changes. */
class ProtectedStorage implements AsyncStorageLike {
  private rows: Record<string, string> = {}
  private loaded: Promise<void> | undefined
  private readonly changes = new Map<string, string | null>()
  constructor(private readonly bridge: Bridge | undefined) {
    if (!bridge) console.warn('[corlex] persistence_memory_only')
  }
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const disk = new Map(
        Object.entries(this.bridge ? readState(await this.bridge.readSdkState()) : {}),
      )
      for (const [key, value] of this.changes) {
        if (value === null) disk.delete(key)
        else disk.set(key, value)
      }
      this.rows = Object.fromEntries(disk)
      this.changes.clear()
    })().catch((failure: unknown) => {
      this.loaded = undefined
      throw failure
    })
    return this.loaded
  }
  private async write(): Promise<void> {
    const json = JSON.stringify(this.rows)
    if (byteLength(json) > STATE_MAX_BYTES) throw new Error('state_budget_exceeded')
    if (this.bridge) await this.bridge.writeSdkState(json)
  }
  async applyChanges(pairs: readonly (readonly [string, string | null])[]): Promise<void> {
    const next = new Map(Object.entries(this.rows))
    for (const [name, value] of pairs) {
      const key = keyOf(name)
      if (!KEYS.has(key)) continue
      if (value === null) next.delete(key)
      else if (stateValueAllowed(key, value)) next.set(key, value)
      else throw new Error('state_budget_exceeded')
      this.changes.set(key, value)
    }
    this.rows = Object.fromEntries(next)
    await this.load()
    await this.write()
  }
  async multiGet(keys: readonly string[]) {
    await this.load()
    return keys.map((key) => [key, this.rows[keyOf(key)] ?? null] as const)
  }
  multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
    return this.applyChanges(pairs)
  }
  multiRemove(keys: readonly string[]): Promise<void> {
    return this.applyChanges(keys.map((key) => [key, null]))
  }
}
export function protectedStorage(module: unknown): AsyncStorageLike {
  return new ProtectedStorage(stateBridge(module) ? module : undefined)
}
