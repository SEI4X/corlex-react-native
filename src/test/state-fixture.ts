import { uuid } from '#core'
import type { FakeDisk } from './kit'
/** Synthetic native bridge; actual file locking, quotas and backup flags are covered natively. */
export class StateFixture {
  constructor(
    private readonly disk: FakeDisk,
    private readonly stop: () => void,
  ) {}
  current = (): string => this.disk.rows.get('@privacy') ?? ''
  async read(owner: string): Promise<string> {
    await this.disk.multiGet([]) // Real startup IO boundary, controllable by lifetime/error tests.
    return this.snapshot(owner)
  }
  snapshot(owner: string): string {
    const raw = this.current(),
      p = raw ? JSON.parse(raw) : undefined,
      rows: Record<string, string> = {}
    const prefix = `s:${owner}:${p?.generation}:`
    if (p?.state === 'granted')
      for (const [k, v] of this.disk.rows) if (k.startsWith(prefix)) rows[k] = v
    const legacy = this.disk.rows.get('@corlex:corlex_consent')
    return JSON.stringify({
      privacy: raw,
      rows,
      ...(this.disk.rows.has(`m:${owner}:consent`)
        ? { explicitChoice: this.disk.rows.get(`m:${owner}:consent`) }
        : {}),
      ...(!raw && (legacy === 'denied' || legacy === 'pending') ? { legacyChoice: legacy } : {}),
    })
  }
  async exchange(command: string): Promise<string> {
    const input = JSON.parse(command)
    if (input.expected !== this.current()) return this.snapshot(input.owner)
    if (input.privacy !== undefined) {
      const next = JSON.parse(input.privacy)
      if ((next.sdkChoice ?? next.state) !== 'granted') this.clearMarkers()
      this.publish(input.privacy)
    }
    if (input.explicitChoice) this.disk.rows.set(`m:${input.owner}:consent`, input.explicitChoice)
    const current = JSON.parse(this.current())
    if (input.changes && current.state === 'granted' && input.generation === current.generation) {
      await this.disk.multiSet([]) // A controllable write failure without touching app-owned rows.
      for (const [k, v] of Object.entries(input.changes)) {
        const physical =
          k === 'corlex_consent'
            ? `m:${input.owner}:consent`
            : `s:${input.owner}:${input.generation}:${k}`
        if (v === null) this.disk.rows.delete(physical)
        else this.disk.rows.set(physical, String(v))
      }
    }
    return this.snapshot(input.owner)
  }
  private publish(raw: string): void {
    const old = this.current(),
      previous = old ? JSON.parse(old) : undefined,
      next = JSON.parse(raw)
    if (previous?.generation !== next.generation) {
      if (previous) this.stop()
      for (const k of [...this.disk.rows.keys()])
        if (k.startsWith('s:') || k.startsWith('@corlex:')) this.disk.rows.delete(k)
    }
    this.disk.rows.set('@privacy', raw)
  }
  private clearMarkers(): void {
    for (const k of [...this.disk.rows.keys()]) if (k.startsWith('m:')) this.disk.rows.delete(k)
  }
  revoke = (expected: string, record: string): string => {
    if (expected === this.current()) {
      this.stop()
      this.clearMarkers()
      this.publish(record)
    }
    return this.current()
  }
  observe = (expected: string, ceiling: string): string => {
    if (expected !== this.current() || !expected) return this.current()
    const p = JSON.parse(expected),
      sdkChoice = p.sdkChoice ?? p.state
    const state =
      sdkChoice === 'denied' || ceiling === 'denied'
        ? 'denied'
        : sdkChoice === 'pending' || ceiling === 'pending'
          ? 'pending'
          : 'granted'
    if (state !== p.state) this.publish(JSON.stringify({ generation: uuid(), state, sdkChoice }))
    return this.current()
  }
  select(owner: string, generation: string): void {
    const p = JSON.parse(this.current())
    if (p.state !== 'granted' || p.generation !== generation || owner.length !== 64)
      throw new Error('scope_inactive')
  }
}
