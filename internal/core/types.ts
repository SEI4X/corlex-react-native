export type Properties = Record<string, unknown>

/** Any JSON value: what a Remote Config parameter can hold. */
export type ConfigJson =
  null | boolean | number | string | ConfigJson[] | { [key: string]: ConfigJson }

/** The variant a person got in an A/B test (docs/experiments.md). */
export interface ExperimentAssignment {
  /** Variant key: `control`, `variant_b`... */
  variant: string
  /** The value set for the variant in the Corlex screen. */
  value: ConfigJson
}

/** A newer config was downloaded. `applied: false`: it is saved and takes effect at the next launch. */
export interface ConfigUpdate {
  version: number
  applied: boolean
}

/** Remote Config (SPEC §10): values the project sets in the Corlex screen, evaluated on the device. */
export interface ConfigApi {
  /**
   * The value of a parameter for this person, or `fallback` when the parameter does not exist,
   * the rollout does not reach this person, the value is of another type than `fallback`, or the
   * config is not available yet (no consent, first launch before the download). Never throws.
   */
  get<T extends ConfigJson>(key: string, fallback: T): T
  /** Every parameter that applies to this person, by key. */
  getAll(): Record<string, ConfigJson>
  /** Called when a newer config was downloaded; returns the function that stops listening. */
  onUpdate(listener: (update: ConfigUpdate) => void): () => void
  /**
   * Resolves when this launch's download finished or after `config.timeoutMs`, whichever is first.
   * Await it before the first read to see a config published since the last launch.
   */
  ready(): Promise<void>
  /** Downloads now (one request, shared by concurrent calls). */
  refresh(): Promise<void>
}

export interface ConfigOptions {
  /** Apply a downloaded config at once. Default `false`: it takes effect at the next launch. */
  live?: boolean
  /** How long `config.ready()` waits for the download, in milliseconds. Default 1500. */
  timeoutMs?: number
  /** `false` never downloads a config. Default `true`. */
  enabled?: boolean
}

/** Options every SDK has; a platform SDK adds its own. */
export interface BaseInitOptions {
  /** Project key, `ck_live_…` or `ck_test_…`. Sent in the `X-Corlex-Key` header. */
  key: string
  /** Ingest base URL. Default `https://ingest.corlex.ru`. */
  endpoint?: string
  /** Explicit host-app development override for non-loopback HTTP. Keep false in production. */
  allowInsecureHttp?: boolean
  /** `pending` holds events in memory only until `optIn()`. Default `granted`. */
  consent?: 'granted' | 'pending'
  /** Remote Config base URL (edge-config). Default `https://config.corlex.ru`. */
  configEndpoint?: string
  /** Remote Config behaviour; like everything that touches the network it needs consent. */
  config?: ConfigOptions
  /** Log what the SDK drops or retries to the console. */
  debug?: boolean
  /** Opt in to bounded detailed automatic error messages; they can contain personal data. */
  captureErrorMessages?: boolean
  /** Events per request, 1..500. Default 20. */
  batchSize?: number
  /** Milliseconds before a partial batch is sent. Default 5000. */
  flushIntervalMs?: number
}

/** What every platform puts into `context` (the protocol keeps only a fixed set of fields). */
export interface WireContext {
  platform: string
  locale?: string
  app_version?: string
  os?: string
  os_version?: string
  device_model?: string
  sdk: { name: string; version: string }
}

/** An event as `POST /v1/batch` takes it (services/ingest/docs/protocol.md). */
export interface WireEvent {
  event_id: string
  name: string
  timestamp: string
  user_id?: string
  anonymous_id?: string
  properties: Properties
  context: WireContext
}

export type ConsentState = 'granted' | 'pending' | 'denied'

/** The public API of every Corlex SDK. */
export interface CorlexApi<O = BaseInitOptions> {
  init(options: O): void
  track(name: string, properties?: Properties): void
  identify(userId: string, traits?: Properties): void
  setUserProperties(properties: Properties): void
  /** Remote Config: see {@link ConfigApi}. */
  readonly config: ConfigApi
  /**
   * The person's variant in a running A/B test, or `null` when the test is not running, not yet
   * downloaded, or there is no consent (then show the default). Assignment is stable per person
   * and happens on the device. Reading it sends one `corlex.exposure` event per person and test per
   * session: the person enters the analysis then, not before.
   */
  experiment(key: string): ExperimentAssignment | null
  /** Shorthand for `config.get(key, defaultValue)` with a scalar default. */
  flag<T extends boolean | number | string>(key: string, defaultValue: T): T
  reset(): void
  flush(): Promise<void>
  optIn(): void
  optOut(): void
}
