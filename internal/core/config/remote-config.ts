import type { SDKRequest } from '../request'
import { assignVariant, resolveAll, resolveParam } from '#remote-config'
import type { CompiledExperiment, ConfigDocument } from '#remote-config'
import type { KeyValueStore } from '../store'
import type { ConfigJson, ConfigUpdate, ExperimentAssignment } from '../types'
import { isConfigDocument, MAX_CONFIG_DEPTH } from './document'
import { parseBoundedJson } from './read'
import { fetchDocument } from './fetch'

/** Where the last document lives between launches. It holds no personal data. */
export const CONFIG_KEY = 'corlex_cfg'

export interface RemoteConfigOptions {
  request?: SDKRequest | undefined
  /** Where the last document is kept between launches. */
  store: KeyValueStore
  /** `web`, `ios`, `react-native`...: what a platform override in the config is matched with. */
  platform: string
  /** `https://config.corlex.ru`, no trailing slash. */
  endpoint: string
  key: string
  /** Apply a downloaded document at once instead of at the next launch. */
  live: boolean
  /** How long `ready()` waits for the first download. */
  timeoutMs: number
  /** The user id after identify(), otherwise the anonymous id: what the rollout buckets on. */
  idOf: () => string | undefined
  /** A variant was shown: the client sends the exposure (once per session; see exposure.ts). */
  expose: (experiment: string, variant: string) => void
  log: (...args: unknown[]) => void
}

/** The type of a value as `get` compares it with the fallback: arrays and objects differ. */
const kindOf = (v: unknown): string => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)

/**
 * The project's published config on this device (SPEC §10, docs/remote-config.md).
 *
 * The document is downloaded once per launch (a conditional GET, usually a 304), kept in
 * the store, and evaluated HERE with the same stable bucketing as the server and the other
 * SDKs, so no request names a person. A value must not flip while the app is running: the new
 * document is applied at once only if nothing was read yet in this launch (or `live` is on);
 * otherwise it waits for the next launch, which is what the screen promises.
 */
export class RemoteConfig {
  private active: ConfigDocument | undefined
  private etag: string | undefined
  private started = false
  private generation = 0
  /** A value was handed out: from now on a new document waits for the next launch. */
  private handedOut = false
  private inflight: Promise<void> | undefined
  private abort: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly listeners = new Set<(update: ConfigUpdate) => void>()

  constructor(private readonly options: RemoteConfigOptions) {}

  /** Reads the saved document and downloads the current one. Needs consent: the caller checks. */
  start(): void {
    if (this.started) return
    this.started = true
    ++this.generation
    this.load()
    // After the current task: the page is not slowed down, and an opt-out right after init()
    // cancels the download before it leaves.
    this.timer = setTimeout(() => void this.refresh(), 0)
  }

  /** Stops downloads; `wipe` also forgets the saved document (opt-out). */
  stop(wipe = false): void {
    this.started = false
    ++this.generation
    this.inflight = undefined
    clearTimeout(this.timer)
    this.abort?.abort()
    if (wipe) {
      this.options.store.remove(CONFIG_KEY)
      this.active = undefined
      this.etag = undefined
    }
  }

  /** Stops for good: listeners are dropped too. */
  destroy(): void {
    this.stop()
    this.listeners.clear()
  }

  /**
   * The variant of a running experiment for this visitor, or null when the experiment is not
   * running, not downloaded yet, or there is no consent. Reading it IS the exposure: the visitor
   * enters the analysis here, not when they are assigned.
   */
  experiment(key: string): ExperimentAssignment | null {
    this.handedOut = true
    const experiment = this.active?.experiments?.find((e) => e.k === key)
    const id = this.options.idOf()
    if (experiment === undefined || id === undefined) return null
    const assigned = assignVariant(experiment, id)
    if (assigned === null) return null
    this.options.expose(experiment.k, assigned.variant)
    return { variant: assigned.variant, value: assigned.value }
  }

  /** The experiment that takes over a parameter (`p`), if one is running. */
  private linked(key: string): CompiledExperiment | undefined {
    return this.active?.experiments?.find((e) => e.p === key)
  }

  get<T extends ConfigJson>(key: string, fallback: T): T {
    this.handedOut = true
    const param = this.active?.params.find((p) => p.k === key)
    const id = this.options.idOf()
    if (id === undefined) return fallback
    const linked = this.linked(key)
    const assigned = linked === undefined ? null : assignVariant(linked, id)
    if (linked !== undefined && assigned !== null) {
      // A parameter under test gives the visitor their variant's value, and that is the exposure.
      if (kindOf(assigned.value) !== kindOf(fallback)) return fallback
      this.options.expose(linked.k, assigned.variant)
      return assigned.value as T
    }
    if (param === undefined) return fallback
    const resolved = resolveParam(param, { userId: id, platform: this.options.platform })
    return resolved !== null && kindOf(resolved.value) === kindOf(fallback)
      ? (resolved.value as T)
      : fallback
  }

  getAll(): Record<string, ConfigJson> {
    this.handedOut = true
    const id = this.options.idOf()
    if (this.active === undefined || id === undefined) return {}
    const values = resolveAll(this.active, { userId: id, platform: this.options.platform })
    // Variants of linked parameters are listed, but listing is not an exposure.
    for (const experiment of this.active.experiments ?? []) {
      const assigned = experiment.p === undefined ? null : assignVariant(experiment, id)
      if (experiment.p !== undefined && assigned !== null) values[experiment.p] = assigned.value
    }
    return values
  }

  onUpdate(listener: (update: ConfigUpdate) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Resolves when the launch's download finished, or after `timeoutMs`: whichever is first. */
  ready(): Promise<void> {
    if (!this.started) return Promise.resolve()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.options.timeoutMs)
    })
    return Promise.race([this.refresh(), timeout]).finally(() => clearTimeout(timer))
  }

  /** Downloads now. Concurrent calls share one request. Never rejects. */
  refresh(): Promise<void> {
    if (!this.started) return Promise.resolve()
    clearTimeout(this.timer)
    const generation = this.generation
    this.inflight ??= this.download(generation).finally(() => {
      if (generation === this.generation) this.inflight = undefined
    })
    return this.inflight
  }

  private load(): void {
    try {
      const saved = parseBoundedJson(
        this.options.store.get(CONFIG_KEY) ?? 'null',
        MAX_CONFIG_DEPTH + 1,
      ) as {
        etag?: unknown
        doc?: ConfigDocument
      } | null
      if (isConfigDocument(saved?.doc) && saved?.etag === saved.doc.etag) {
        this.active = saved.doc
        this.etag = saved.etag
      } else this.options.store.remove(CONFIG_KEY)
    } catch {
      this.options.store.remove(CONFIG_KEY)
    }
  }

  private async download(generation: number): Promise<void> {
    this.abort = new AbortController()
    const result = await fetchDocument({
      ...this.options,
      etag: this.etag,
      signal: this.abort.signal,
    })
    if (result.kind !== 'document' || !this.started || generation !== this.generation) return
    this.etag = result.doc.etag
    this.options.store.set(CONFIG_KEY, JSON.stringify({ etag: result.doc.etag, doc: result.doc }))
    const apply = this.options.live || !this.handedOut || this.active === undefined
    if (apply) this.active = result.doc
    this.options.log(
      `config v${result.doc.version} ${apply ? 'applied' : 'saved for the next launch'}`,
    )
    for (const listener of [...this.listeners]) {
      if (!this.started || generation !== this.generation) return
      try {
        listener({ version: result.doc.version, applied: apply })
      } catch {
        this.options.log('config: update listener failed')
      }
    }
  }
}
