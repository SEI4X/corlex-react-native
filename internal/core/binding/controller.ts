import type { SDKRequest } from '../request'
import type { ConsentState } from '../types'
import { initialConsent, interrupted, samePrivacy, usableScope } from './fence'
import { guardedRequest } from './request'
import { guardedStores, memoryStores } from './stores'
import type { BindingOptions, BoundScope, PrivacyRead } from './types'
export { initialConsent } from './fence'

/** One immutable owner; adopting any new privacy generation requires explicit activation. */
export class BindingController {
  private active: BoundScope
  private state: ConsentState
  private invalidated = false
  private revision = 0
  private pendingGrant: number | undefined
  private readonly requests = new Set<AbortController>()
  readonly stores

  constructor(private readonly options: BindingOptions) {
    this.active = options.scope
    this.state =
      usableScope(this.active, options.owner) && this.active.privacy.kind === 'valid'
        ? initialConsent({
            privacy: this.active.privacy,
            choice: this.active.choice,
            requested: options.requested,
          })
        : 'pending'
    this.stores = guardedStores({
      allowed: () => this.current() && this.state === 'granted',
      stores: () => this.active.stores,
    })
  }

  scope(): { owner: string; generation: string; persistent: boolean } {
    return {
      owner: this.options.owner,
      generation: this.active.generation,
      persistent: this.active.persistent,
    }
  }

  consent(): ConsentState {
    this.current()
    return this.state
  }

  current(): boolean {
    if (this.invalidated) return false
    const current = this.read()
    if (!samePrivacy(this.active.privacy, current)) {
      if (this.waitingForGrant(current)) return false
      this.invalidate(current)
    }
    return !this.invalidated
  }

  async grant(): Promise<{ preserveMemory: boolean }> {
    const wasPending = this.current() && this.state === 'pending'
    const previous = this.active
    const revision = ++this.revision
    this.pendingGrant = revision
    this.invalidated = false
    try {
      let next: BoundScope
      try {
        const candidate = this.options.driver.grant({
          owner: this.options.owner,
          expected: this.read(),
        })
        next = 'then' in candidate ? await candidate : candidate
      } catch {
        return { preserveMemory: false }
      }
      if (revision !== this.revision) return { preserveMemory: false }
      if (!this.acceptGrant(next)) {
        this.invalidate(next.privacy)
        return { preserveMemory: false }
      }
      const preserveMemory =
        wasPending &&
        previous.privacy.kind === 'valid' &&
        next.privacy.kind === 'valid' &&
        previous.generation === next.generation
      this.stopRequests()
      this.active = next
      if (next.privacy.kind !== 'valid')
        this.active = { ...next, stores: memoryStores(), persistent: false }
      this.state = 'granted'
      this.invalidated = false
      return { preserveMemory }
    } finally {
      if (this.pendingGrant === revision) this.pendingGrant = undefined
    }
  }

  revoke(): void {
    const expected = this.active.privacy
    ++this.revision
    this.invalidate({ kind: 'valid', generation: this.active.generation, state: 'denied' })
    try {
      void Promise.resolve(this.options.driver.revoke({ expected })).catch(() => {})
    } catch {
      /* local denial remains effective when native cleanup cannot be persisted */
    }
  }

  request(request: SDKRequest): SDKRequest {
    return guardedRequest({
      request,
      refresh: async () => {
        const revision = this.revision
        let fresh: PrivacyRead
        try {
          fresh = await this.options.driver.fresh()
        } catch {
          fresh = { kind: 'unavailable' }
        }
        if (revision !== this.revision) throw interrupted()
        if (!samePrivacy(this.active.privacy, fresh)) {
          if (this.waitingForGrant(fresh)) throw interrupted()
          this.invalidate(fresh)
          throw interrupted()
        }
      },
      check: () => {
        if (!this.current() || this.state !== 'granted') throw interrupted()
      },
      attach: (controller) => {
        this.requests.add(controller)
        return () => this.requests.delete(controller)
      },
    })
  }

  private waitingForGrant(current: PrivacyRead): boolean {
    return (
      this.pendingGrant === this.revision && current.kind === 'valid' && current.state === 'granted'
    )
  }

  private acceptGrant(next: BoundScope): boolean {
    if (!usableScope(next, this.options.owner) || !samePrivacy(next.privacy, this.read()))
      return false
    return next.privacy.kind === 'valid'
      ? next.privacy.state === 'granted' && next.choice === 'granted'
      : !next.persistent && next.choice === 'granted'
  }

  private read(): PrivacyRead {
    try {
      return this.options.driver.current()
    } catch {
      return { kind: 'unavailable' }
    }
  }

  private stopRequests(): void {
    for (const request of this.requests) request.abort()
    this.requests.clear()
  }

  private invalidate(current: PrivacyRead): void {
    this.state = current.kind === 'valid' && current.state === 'denied' ? 'denied' : 'pending'
    if (this.invalidated) return
    this.invalidated = true
    ++this.revision
    this.stopRequests()
    try {
      this.options.onInvalidate()
    } catch {
      /* privacy fencing must survive host callbacks */
    }
  }
}
