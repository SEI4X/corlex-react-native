import { MemoryStore, uuid } from '#core'
import type { BindingDriver, BoundScope, ConsentState, PrivacyRead } from '#core'
import { AsyncKeyValueStore } from '../storage'
import { privacyOf, sdkChoiceOf, snapshotOf, stateModule } from './protocol'
import type { Snapshot, StateModule } from './protocol'
const same = (a: PrivacyRead, b: PrivacyRead) =>
  a.kind === b.kind &&
  (a.kind !== 'valid' ||
    (b.kind === 'valid' && a.generation === b.generation && a.state === b.state))

/** Native effective permission is authoritative; SDK choice survives observational ATT changes. */
export class NativeBindingDriver implements BindingDriver {
  private readonly module: StateModule | undefined
  private fault: { raw: string | undefined } | undefined
  private store: AsyncKeyValueStore | undefined
  private memoryChoice: ConsentState | undefined
  private freshMemoryChoice = false
  private observing = false
  private lastRaw: string | undefined
  constructor(
    readonly owner: string,
    value: unknown,
    private readonly options: { log(): void; ceiling?: () => ConsentState },
  ) {
    this.module = stateModule(value)
    if (!this.module) {
      console.warn('[corlex] native_sdk_rebuild_required')
      try {
        if (
          value &&
          typeof value === 'object' &&
          'uninstall' in value &&
          typeof value.uninstall === 'function'
        )
          value.uninstall()
      } catch {
        /* stable zero-argument legacy ABI only */
      }
    }
  }
  private raw(): string | undefined {
    try {
      const raw = this.module?.currentSdkPrivacy()
      if (raw !== undefined) this.lastRaw = raw
      return raw
    } catch {
      return undefined
    }
  }
  private observed(): string | undefined {
    const raw = this.raw()
    try {
      const next =
        this.module &&
        this.options.ceiling &&
        typeof raw === 'string' &&
        privacyOf(raw).kind === 'valid'
          ? this.module.observeSdkCeiling(raw, this.options.ceiling())
          : raw
      if (typeof next === 'string') this.lastRaw = next
      return next
    } catch {
      return undefined
    }
  }
  current(): PrivacyRead {
    const raw = this.observed(),
      p = privacyOf(raw)
    if (
      this.fault &&
      (this.fault.raw === raw ||
        (this.fault.raw === undefined && p.kind === 'valid' && p.state === 'granted'))
    )
      return { kind: 'unavailable' }
    if (p.kind !== 'unavailable') {
      this.fault = undefined
      this.freshMemoryChoice = false
      if (this.memoryChoice === 'granted' && sdkChoiceOf(raw) !== 'granted')
        this.memoryChoice = undefined
    }
    return p
  }
  fresh = (): PrivacyRead => this.current()
  sdkGranted(): boolean {
    const permission = this.current()
    if (this.memoryChoice === 'denied') return false
    if (permission.kind === 'unavailable')
      return this.memoryChoice === 'granted' && this.freshMemoryChoice
    return sdkChoiceOf(this.raw()) === 'granted'
  }

  private async read(): Promise<Snapshot> {
    if (!this.module) throw new Error('native_state_unavailable')
    return snapshotOf(await this.module.readBoundSdkState(this.owner), this.owner)
  }
  async prepare(requested: ConsentState): Promise<BoundScope> {
    this.current()
    try {
      let snapshot = await this.read()
      if (snapshot.privacy.kind === 'missing')
        snapshot = await this.publish(snapshot.raw, snapshot.legacyChoice ?? requested)
      else if (requested === 'denied' && sdkChoiceOf(snapshot.raw) !== 'denied')
        snapshot = await this.publish(snapshot.raw, 'denied')
      else if (
        sdkChoiceOf(snapshot.raw) === 'granted' &&
        requested === 'pending' &&
        snapshot.explicitChoice !== 'granted'
      )
        snapshot = await this.publish(snapshot.raw, 'pending')
      const raw = this.observed()
      if (raw !== snapshot.raw) snapshot = await this.read()
      return this.scope(snapshot)
    } catch {
      this.options.log()
      return this.memory(this.current())
    }
  }
  private effective(choice: ConsentState): ConsentState {
    const ceiling = this.options.ceiling?.() ?? 'granted'
    return choice === 'denied' || ceiling === 'denied'
      ? 'denied'
      : choice === 'pending' || ceiling === 'pending'
        ? 'pending'
        : 'granted'
  }
  private async publish(expected: string, sdkChoice: ConsentState): Promise<Snapshot> {
    if (!this.module) throw new Error('native_state_unavailable')
    const record = JSON.stringify({
      generation: uuid(),
      state: this.effective(sdkChoice),
      sdkChoice,
    })
    if (sdkChoice === 'denied') {
      this.module.revokeSdkPrivacy(expected, record)
      return this.read()
    }
    return snapshotOf(
      await this.module.exchangeSdkState(
        JSON.stringify({ owner: this.owner, expected, privacy: record }),
      ),
      this.owner,
    )
  }
  observeGrant(job: () => void): void {
    this.observing = true
    try {
      job()
    } finally {
      this.observing = false
    }
  }
  async grant({ expected }: { owner: string; expected: PrivacyRead }): Promise<BoundScope> {
    const explicit = !this.observing
    if (!explicit && !this.sdkGranted()) return this.memory(this.current(), 'pending')
    const current = this.current(),
      before = this.raw()
    if (!same(current, expected)) return this.memory(current, 'pending')
    if (explicit) this.memoryChoice = 'granted'
    const state = this.effective('granted')
    if (current.kind === 'unavailable' || !this.module) {
      this.freshMemoryChoice = true
      return this.memory(current, state === 'granted' ? 'granted' : 'pending')
    }
    if (!same(privacyOf(before), current)) return this.memory(privacyOf(before), 'pending')
    const generation =
      current.kind === 'valid' &&
      current.state === 'pending' &&
      sdkChoiceOf(before) === 'pending' &&
      state === 'granted'
        ? current.generation
        : uuid()
    const record = JSON.stringify({ generation, state, sdkChoice: 'granted' })
    try {
      const reply = snapshotOf(
        await this.module.exchangeSdkState(
          JSON.stringify({
            owner: this.owner,
            generation,
            expected: before ?? '',
            privacy: record,
            ...(explicit ? { explicitChoice: 'granted' } : {}),
          }),
        ),
        this.owner,
      )
      if (reply.raw !== record) return this.memory(reply.privacy, 'pending')
      this.fault = undefined
      return this.scope(reply, state === 'granted' ? 'granted' : 'pending')
    } catch {
      this.fault = { raw: before }
      this.freshMemoryChoice = true
      this.options.log()
      return this.memory(this.current(), state === 'granted' ? 'granted' : 'pending')
    }
  }
  revoke(): void {
    this.memoryChoice = 'denied'
    this.freshMemoryChoice = false
    const record = JSON.stringify({ generation: uuid(), state: 'denied', sdkChoice: 'denied' })
    const before = this.lastRaw
    try {
      const result = this.module?.revokeSdkPrivacy(before ?? '', record)
      if (result !== undefined) this.lastRaw = result
      this.fault = undefined
    } catch {
      this.fault = { raw: before }
      this.options.log()
    }
    this.store = undefined
  }

  async flushNow(): Promise<void> {
    await this.store?.flushNow()
  }
  select(scope: { owner: string; generation: string; persistent: boolean }): boolean {
    try {
      const privacy = this.current()
      if (
        !scope.persistent ||
        privacy.kind !== 'valid' ||
        privacy.state !== 'granted' ||
        privacy.generation !== scope.generation ||
        this.module?.sdkCapabilities().crashBinding !== 1
      )
        return false
      this.module.selectSdkScope(scope.owner, scope.generation)
      return true
    } catch {
      this.options.log()
      return false
    }
  }
  private memory(privacy: PrivacyRead, explicit?: ConsentState): BoundScope {
    this.store = undefined
    const store = new MemoryStore()
    return {
      owner: this.owner,
      generation: privacy.kind === 'valid' ? privacy.generation : uuid(),
      privacy,
      persistent: false,
      ...(explicit ? { choice: explicit } : {}),
      stores: { persistent: store, identity: store, session: new MemoryStore() },
    }
  }
  private async scope(snapshot: Snapshot, explicit?: ConsentState): Promise<BoundScope> {
    if (snapshot.privacy.kind !== 'valid' || !this.module)
      return this.memory(snapshot.privacy, explicit)
    const { raw, privacy } = snapshot,
      rows: Record<string, string> = {
        ...snapshot.rows,
        ...(snapshot.explicitChoice ? { corlex_consent: snapshot.explicitChoice } : {}),
      },
      module = this.module,
      owner = this.owner
    const store = new AsyncKeyValueStore(
      {
        multiGet: async (keys) => keys.map((name) => [name, rows[name.slice(8)] ?? null] as const),
        multiSet: async () => {
          throw new Error('atomic_write_required')
        },
        multiRemove: async () => {
          throw new Error('atomic_write_required')
        },
        applyChanges: async (pairs) => {
          await module.exchangeSdkState(
            JSON.stringify({
              owner,
              generation: privacy.generation,
              expected: raw,
              changes: Object.fromEntries(pairs.map(([name, value]) => [name.slice(8), value])),
            }),
          )
        },
      },
      this.options.log,
    )
    await store.hydrate()
    this.store = store
    const selected = explicit ?? snapshot.explicitChoice
    return {
      owner,
      generation: privacy.generation,
      privacy,
      persistent: true,
      ...(selected ? { choice: selected } : {}),
      stores: { persistent: store, identity: store, session: new MemoryStore() },
    }
  }
}
