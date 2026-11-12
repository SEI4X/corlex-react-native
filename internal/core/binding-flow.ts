import type { BindingController } from './binding/controller'
import type { ConsentState } from './types'

/** Keeps the public synchronous optIn API while native privacy activation may require IO. */
export class BindingFlow {
  private granting: Promise<void> | undefined
  private revision = 0
  private jobs: (() => void)[] = []
  constructor(
    readonly controller: BindingController,
    private readonly activate: (preserveMemory: boolean) => void,
  ) {}
  defer(job: () => void): boolean {
    if (!this.granting || this.controller.consent() === 'granted') return false
    if (this.jobs.length < 1000) this.jobs.push(job)
    return true
  }
  consent(): ConsentState {
    return this.controller.consent()
  }
  grant(): void {
    if (this.consent() === 'granted') {
      this.controller.stores.persistent.set('corlex_consent', 'granted')
      return
    }
    const pending = this.consent() === 'pending',
      previous = this.controller.scope().generation
    const revision = ++this.revision
    let finished = false
    const finish = ({ preserveMemory }: { preserveMemory: boolean }) => {
      if (finished || revision !== this.revision) return
      finished = true
      if (this.consent() === 'granted') {
        this.activate(preserveMemory)
        for (const job of this.jobs.splice(0)) job()
      } else this.jobs = []
    }
    const result = this.controller.grant()
    if (this.consent() === 'granted')
      finish({ preserveMemory: pending && previous === this.controller.scope().generation })
    this.granting = result.then(finish).finally(() => {
      if (revision === this.revision) this.granting = undefined
    })
  }
  revoke(): void {
    this.cancel()
    this.controller.revoke()
  }
  cancel(): void {
    ++this.revision
    this.jobs = []
    this.granting = undefined
  }
  ready(): Promise<void> | undefined {
    return this.granting
  }
}

export function storedConsent(store: import('./store').KeyValueStore): ConsentState | null {
  const value = store.get('corlex_consent')
  return value === 'granted' || value === 'denied' ? value : null
}
