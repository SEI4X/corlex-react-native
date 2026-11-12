import { bucketOf } from '#remote-config'
import type { KeyValueStore } from '../store'

/** Where the exposures of this tab's session are remembered, so a reload does not repeat them. */
export const EXPOSURE_KEY = 'corlex_exp'

/**
 * «Once per person and experiment in a session» (docs/experiments.md). A person is in the analysis
 * from the first `corlex.exposure` on, and more of them add nothing but noise, so the SDK sends one
 * per experiment per browser tab session, however often the variant is read. The memory is in
 * `sessionStorage` (it dies with the tab) and holds no id: the person is a pair of 14-bit hashes
 * of the experiment and the id, a collision needs both to match (about one in a hundred million).
 * Nothing is written without consent; `reset()` and `optOut()` forget it.
 */
export class Exposures {
  private readonly seen = new Set<string>()

  /** `store` lives as long as one session: `sessionStorage` on the web, memory in an app. */
  constructor(
    private readonly store: KeyValueStore,
    private readonly mayStore: () => boolean,
  ) {
    try {
      const saved: unknown = JSON.parse(store.get(EXPOSURE_KEY) ?? '[]')
      if (Array.isArray(saved)) for (const mark of saved) this.seen.add(String(mark))
    } catch {
      store.remove(EXPOSURE_KEY)
    }
  }

  /** True the first time this person is shown this experiment in this session. */
  first(experiment: string, id: string): boolean {
    const mark = `${experiment}|${bucketOf(`x1:${experiment}`, id)}.${bucketOf(`x2:${experiment}`, id)}`
    if (this.seen.has(mark)) return false
    this.seen.add(mark)
    if (this.mayStore()) this.store.set(EXPOSURE_KEY, JSON.stringify([...this.seen]))
    return true
  }

  clear(): void {
    this.seen.clear()
    this.store.remove(EXPOSURE_KEY)
  }
}
