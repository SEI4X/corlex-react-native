type ConfigParamType = 'bool' | 'number' | 'string' | 'json'
type ConfigPlatform = 'ios' | 'android' | 'web' | 'react-native' | 'flutter'

/** Any JSON value. */
export type ConfigJson =
  null | boolean | number | string | ConfigJson[] | { [key: string]: ConfigJson }

/**
 * One parameter of the compiled document, in the compact form edge-config serves and SDKs
 * evaluate. Short names keep the document small (it is fetched on every app launch).
 */
export interface CompiledParam {
  /** Key. */
  k: string
  /** Type. */
  t: ConfigParamType
  /** Value for the people the rollout reaches. */
  v: ConfigJson
  /** Rollout in buckets: percent times 100, 0 to 10 000. */
  r: number
  /** Platform overrides. Absent when there are none. */
  o?: Partial<Record<ConfigPlatform, ConfigJson>>
}

/** One variant of a compiled experiment. */
export interface CompiledVariant {
  /** Variant key. */
  n: string
  /** Upper bound (exclusive) of its bucket range: cumulative weight in buckets. */
  b: number
  /** The variant's value (what `experiment(key).value` returns in the Web SDK). */
  v: ConfigJson
}

/**
 * A running experiment in the compact form of the document (task 40). People are assigned on the
 * device: `ab:<k>:<s>` buckets, ranges `v[i].b`. See `experiments.ts`.
 */
export interface CompiledExperiment {
  /** Experiment key. */
  k: string
  /** Salt of the bucketing, fixed at creation. */
  s: string
  /** Remote Config parameter the experiment is linked to, when it is. */
  p?: string
  v: CompiledVariant[]
}

/** The document in Valkey (`rc:<projectId>`) and in the edge-config response body. */
export interface ConfigDocument {
  version: number
  /** Strong validator, quotes included; also sent as the ETag header. */
  etag: string
  params: CompiledParam[]
  /** Running experiments; absent in documents published before task 40 and when none runs. */
  experiments?: CompiledExperiment[]
}

/** Who asks. `userId` is the user id after identify(), otherwise the anonymous id. */
export interface EvalContext {
  userId: string
  platform?: string | undefined
}
