import { bindingDigest, CorlexCore, isSdkKey } from '#core'
import type {
  CorlexApi,
  ConfigApi,
  ConfigJson,
  ConsentState,
  ExperimentAssignment,
  Properties,
} from '#core'
import { attConsent } from './att'
import { NativePlatform } from './platform'
import type { CoreOptions } from './platform'
import { ScreenTracker } from './screens'
import type { ScreenSource } from './screens'
import type { Runtime } from './runtime'
import type { InitOptions } from './types'

type Job = () => void

/**
 * The SDK for an app. `CorlexCore` does the work; this class adds the one thing a phone needs:
 * AsyncStorage is asynchronous, so `init()` first loads the few stored values into memory.
 * Calls made while that happens (`track()` right after `init()` is the normal case) wait in a
 * list and run in order once it is done; `flag()` and `experiment()` answer "no value yet".
 */
export class NativeClient implements CorlexApi<InitOptions> {
  private core: CorlexCore<CoreOptions> | undefined
  private platform: NativePlatform | undefined
  private runtime: Runtime | undefined
  private ready = false
  private generation = 0
  private unavailable = false
  private attMode = false
  private lastAtt: ConsentState | undefined
  private warnedKey = false
  private warnedEndpoint = false
  private waiting: Job[] = []
  private started: Promise<void> = Promise.resolve()
  private stopAtt: (() => void) | undefined
  private readonly screens = new ScreenTracker((props) => this.track('screen_view', props))

  constructor(private readonly makeRuntime: () => Runtime) {}

  /** Starts the SDK. The returned promise resolves when stored state is loaded; awaiting is optional. */
  init(options: InitOptions): Promise<void> {
    if (this.core !== undefined || this.unavailable) return this.started
    if (!isSdkKey(options?.key)) {
      if (!this.warnedKey) console.warn('[corlex] invalid_sdk_key')
      this.warnedKey = true
      return this.started
    }
    const owner = bindingDigest({
      key: options.key,
      endpoint: options.endpoint ?? 'https://ingest.corlex.ru',
      configEndpoint: options.configEndpoint ?? 'https://config.corlex.ru',
      ...(options.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: options.allowInsecureHttp }),
    })
    if (!owner) {
      if (!this.warnedEndpoint) console.warn('[corlex] invalid_endpoint')
      this.warnedEndpoint = true
      return this.started
    }
    options = { ...options }
    const runtime = this.makeRuntime()
    if (!runtime.request) {
      this.unavailable = true
      console.warn('[corlex] secure_transport_unavailable')
      return this.started
    }
    const generation = ++this.generation
    const platform = new NativePlatform(runtime, options.debug ? console.debug : undefined)
    this.runtime = runtime
    this.platform = platform
    this.core = new CorlexCore(platform)
    this.attMode = options.consent === 'att'
    this.lastAtt = undefined
    this.started = platform
      .prepare(
        owner,
        this.attMode
          ? 'granted'
          : options.consent === 'att'
            ? 'granted'
            : (options.consent ?? 'granted'),
        this.attMode ? () => attConsent(runtime) : undefined,
      )
      .then(() => this.begin(options, generation))
    return this.started
  }

  private begin(options: InitOptions, generation: number): void {
    if (generation !== this.generation) return
    const core = this.core
    if (core === undefined || this.runtime === undefined) return
    const { consent, ...rest } = options
    const coreOptions: CoreOptions = { ...rest }
    if (consent !== 'att' && consent !== undefined) coreOptions.consent = consent
    core.init(coreOptions)
    this.ready = true
    if (this.attMode) this.followAtt()
    for (const job of this.waiting.splice(0)) {
      if (generation !== this.generation) break
      job()
    }
  }

  /** ATT answers can arrive any time the app asks; the foreground is where the SDK notices. */
  private synchronizeAtt(): void {
    if (!this.ready || !this.attMode || !this.runtime || !this.core) return
    const state = attConsent(this.runtime),
      changed = state !== this.lastAtt
    this.lastAtt = state
    this.platform?.observeCeiling()
    const permission = this.core.getConsent()
    if (changed && state === 'granted' && this.platform?.sdkGranted() && permission !== 'granted')
      this.platform?.restorePermission(() => this.core?.optIn())
  }
  private followAtt(): void {
    this.synchronizeAtt()
    const generation = this.generation
    const sub = this.runtime?.appState.addEventListener('change', (state) => {
      if (generation === this.generation && state === 'active') this.synchronizeAtt()
    })
    this.stopAtt = () => sub?.remove()
  }
  private activeCore(): CorlexCore<CoreOptions> | undefined {
    if (!this.ready) return undefined
    this.synchronizeAtt()
    return this.core
  }

  /** Runs now, or after start-up; before `init()` there is nothing to run on. */
  private run(job: Job): void {
    if (this.core === undefined) return
    if (this.ready) {
      this.synchronizeAtt()
      job()
    } else this.waiting.push(job)
  }

  track(name: string, properties?: Properties): void {
    this.run(() => this.core?.track(name, properties))
  }

  /** A screen was shown. Use the route pattern or name, never a path with ids in it. */
  screen(name: string, source: ScreenSource = 'manual'): void {
    this.screens.view(name, source)
  }

  identify(userId: string, traits?: Properties): void {
    this.run(() => this.core?.identify(userId, traits))
  }

  setUserProperties(properties: Properties): void {
    this.run(() => this.core?.setUserProperties(properties))
  }

  reset(): void {
    this.screens.forget()
    this.run(() => this.core?.reset())
  }

  optIn(): void {
    this.run(() => this.core?.optIn())
  }

  optOut(): void {
    this.run(() => this.core?.optOut())
  }

  getConsent(): ConsentState {
    return this.activeCore()?.getConsent() ?? 'pending'
  }

  flag<T extends boolean | number | string>(key: string, defaultValue: T): T {
    return this.activeCore()?.flag(key, defaultValue) ?? defaultValue
  }

  experiment(key: string): ExperimentAssignment | null {
    return this.activeCore()?.experiment(key) ?? null
  }

  /**
   * Resolves when stored state is loaded (not when the config download finished). A component reads
   * its flags after this: the saved config of the last launch is there, and a newer one waits for
   * the next launch.
   */
  initialized(): Promise<void> {
    return this.started
  }

  async flush(): Promise<void> {
    const generation = this.generation
    await this.started
    if (generation !== this.generation) return
    this.synchronizeAtt()
    await this.core?.flush()
    if (generation === this.generation) await this.platform?.flushNow()
  }

  readonly config: ConfigApi = {
    get: <T extends ConfigJson>(key: string, fallback: T): T =>
      this.activeCore()?.config.get(key, fallback) ?? fallback,
    getAll: () => this.activeCore()?.config.getAll() ?? {},
    onUpdate: (listener) => {
      const generation = this.generation
      let active = true
      let off: (() => void) | undefined
      this.run(() => {
        if (active && generation === this.generation) off = this.core?.config.onUpdate(listener)
      })
      return () => {
        active = false
        off?.()
      }
    },
    ready: async () => {
      const generation = this.generation
      await this.started
      if (generation === this.generation) await this.activeCore()?.config.ready()
    },
    refresh: async () => {
      const generation = this.generation
      await this.started
      if (generation === this.generation) await this.activeCore()?.config.refresh()
    },
  }

  /** Stops everything and forgets the instance. For tests and hot reload. */
  destroy(): void {
    this.generation += 1
    this.stopAtt?.()
    this.stopAtt = undefined
    this.runtime = undefined
    this.screens.forget()
    this.core?.destroy()
    this.core = undefined
    this.platform = undefined
    this.ready = false
    this.attMode = false
    this.lastAtt = undefined
    this.unavailable = false
    this.waiting = []
    this.started = Promise.resolve()
  }
}
