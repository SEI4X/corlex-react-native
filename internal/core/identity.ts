import { MAX_ID } from './limits'
import { truncateBytes, uuid } from './util'
import type { KeyValueStore } from './store'

export const ANON_KEY = 'corlex_aid'
export const USER_KEY = 'corlex_uid'

const newAnonymousId = (): string => `a_${uuid()}`

/**
 * Who is acting. The anonymous id is a random UUID the SDK makes itself (never an advertising or
 * vendor id); `userId` appears after identify(). Until `persist()` is called (consent pending)
 * nothing is written.
 */
export class Identity {
  anonymousId: string
  userId: string | undefined

  constructor(
    private readonly store: KeyValueStore,
    private shouldPersist: boolean,
  ) {
    this.anonymousId = (shouldPersist ? store.get(ANON_KEY) : null) ?? newAnonymousId()
    this.userId = (shouldPersist ? store.get(USER_KEY) : null) ?? undefined
    if (shouldPersist) this.persist()
  }

  persist(): void {
    this.shouldPersist = true
    this.store.set(ANON_KEY, this.anonymousId)
    if (this.userId !== undefined) this.store.set(USER_KEY, this.userId)
  }

  setUser(userId: string): void {
    this.userId = truncateBytes(userId, MAX_ID)
    if (this.shouldPersist) this.store.set(USER_KEY, this.userId)
  }

  /** Logout: forget the user and start a new anonymous person. */
  reset(): void {
    this.userId = undefined
    this.anonymousId = newAnonymousId()
    this.store.remove(USER_KEY)
    if (this.shouldPersist) this.persist()
  }

  /** Opt-out: remove every trace from storage. */
  wipe(): void {
    this.store.remove(ANON_KEY)
    this.store.remove(USER_KEY)
    this.shouldPersist = false
  }
}
