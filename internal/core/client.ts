import { BindingFlow, storedConsent } from './binding-flow'
import type { CaptureMeta } from './capture-meta'
import { buildEvent } from './event'
export type { CaptureMeta } from './capture-meta'
import { initProblem, DEFAULT_ENDPOINT, DEFAULT_CONFIG_ENDPOINT } from './init-problem'
import type { Log, Runtime } from './runtime'
import { Exposures } from './config/exposure'
import { RemoteConfig } from './config/remote-config'
import { Identity } from './identity'
import {
  EVENT_EXPOSURE,
  EVENT_IDENTIFY,
  EVENT_USER_PROPS,
  MAX_BATCH_EVENTS,
  MAX_EVENT_BYTES,
  NAME_PATTERN,
} from './limits'
import { EventQueue } from './queue'
import { Sender } from './sender'
import type { FlushOptions } from './sender'
import { byteLength, isRecord } from './util'
import type { Platform, PlatformHost } from './platform'
import type {
  BaseInitOptions,
  CorlexApi,
  ConfigApi,
  ConsentState,
  ExperimentAssignment,
  Properties,
} from './types'

const DEFAULT_CONFIG_WAIT_MS = 1500
const CONSENT_KEY = 'corlex_consent'

/** Shared event, consent, delivery, identity and configuration lifecycle. */
export class CorlexCore<O extends BaseInitOptions = BaseInitOptions> implements CorlexApi<O> {
  private binding: BindingFlow | undefined
  private rt: Runtime | undefined
  private consent: ConsentState = 'granted'
  private warnedName = false
  private options: O | undefined
  private remote: RemoteConfig | undefined
  private exposures: Exposures | undefined
  private blocked = false
  private readonly warnedValidation = new Set<string>()

  constructor(protected readonly platform: Platform<O>) {}

  init(options: O): void {
    if (this.options) return
    const problem = initProblem(options)
    if (problem) {
      if (!this.warnedValidation.has(problem)) console.warn('[corlex] ' + problem)
      this.warnedValidation.add(problem)
      return
    }
    this.options = { ...options }
    this.blocked = this.platform.isBlocked(options)
    if (this.blocked) return
    const controller = this.platform.bind?.(
      {
        ...options,
        endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
        configEndpoint: options.configEndpoint ?? DEFAULT_CONFIG_ENDPOINT,
      },
      () => this.invalidateBinding(),
    )
    this.blocked = Boolean(this.platform.bind && !controller)
    if (this.blocked) return
    if (controller)
      this.binding = new BindingFlow(controller, (preserve) => this.activateBinding(preserve))
    this.consent =
      this.binding?.consent() ??
      storedConsent(this.platform.stores.persistent) ??
      options.consent ??
      'granted'
    if (this.consent !== 'denied') this.start(options)
  }

  private start(options: O): void {
    const granted = this.consent === 'granted'
    const { stores } = this.platform
    const log: Log = options.debug ? (...a) => console.debug('[corlex]', ...a) : () => {}
    const queue = new EventQueue(stores.persistent, granted)
    const sender = new Sender(queue, {
      endpoint: (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, ''),
      key: options.key,
      batchSize: Math.min(Math.max(1, options.batchSize ?? 20), MAX_BATCH_EVENTS),
      flushIntervalMs: options.flushIntervalMs ?? 5000,
      keepalive: this.platform.keepalive,
      request: this.platform.request,
      log,
    })
    this.remote = this.createRemoteConfig(options, log)
    const rt: Runtime = {
      sender,
      queue,
      identity: new Identity(stores.identity, granted),
      log,
      teardown: () => {},
    }
    this.rt = rt
    rt.teardown = this.platform.start(options, this.host(), granted)
    if (this.rt !== rt || this.binding?.controller.current() === false) {
      rt.teardown()
      rt.sender.stop()
      return
    }
    if (granted) sender.schedule()
    if (granted) this.startRemoteConfig()
  }

  private host(): PlatformHost {
    return {
      track: (name, props) => this.track(name, props),
      capture: (name, props, meta) => this.capture(name, props, meta),
      flush: (options) => this.flush(options),
      consent: () => this.getConsent(),
    }
  }

  private createRemoteConfig(options: O, log: Log) {
    return new RemoteConfig({
      store: this.platform.stores.persistent,
      request: this.platform.request,
      platform: this.platform.name,
      endpoint: (options.configEndpoint ?? DEFAULT_CONFIG_ENDPOINT).replace(/\/+$/, ''),
      key: options.key,
      live: options.config?.live ?? false,
      timeoutMs: options.config?.timeoutMs ?? DEFAULT_CONFIG_WAIT_MS,
      idOf: () => this.rt?.identity.userId ?? this.rt?.identity.anonymousId,
      expose: (experiment, variant) => this.expose(experiment, variant),
      log,
    })
  }

  /** Config is downloaded only with consent: the SDK makes no request without it (SPEC §12.1). */
  private startRemoteConfig(): void {
    if (this.options?.config?.enabled !== false) this.remote?.start()
  }

  /** Remote Config: values set in the Corlex screen, evaluated here (docs/remote-config.md). */
  private get currentConfig(): RemoteConfig | undefined {
    this.getConsent()
    return this.remote
  }
  readonly config: ConfigApi = {
    get: (key, fallback) => this.currentConfig?.get(key, fallback) ?? fallback,
    getAll: () => this.currentConfig?.getAll() ?? {},
    onUpdate: (listener) => this.currentConfig?.onUpdate(listener) ?? (() => undefined),
    ready: () => this.currentConfig?.ready() ?? Promise.resolve(),
    refresh: () => this.currentConfig?.refresh() ?? Promise.resolve(),
  }

  /** One `corlex.exposure` per person and experiment per session; consent decides where it waits. */
  private expose(experiment: string, variant: string): void {
    const id = this.rt?.identity.userId ?? this.rt?.identity.anonymousId
    this.exposures ??= new Exposures(this.platform.stores.session, () => this.consent === 'granted')
    if (id === undefined || !this.exposures.first(experiment, id)) return
    this.track(EVENT_EXPOSURE, { experiment, variant })
  }

  experiment(key: string): ExperimentAssignment | null {
    return this.currentConfig?.experiment(key) ?? null
  }

  track(name: string, properties?: Properties): void {
    this.capture(name, properties, {})
  }

  /** Captures a recovered event with its original time and id. */
  capture(name: string, properties: Properties | undefined, meta: CaptureMeta): void {
    const rt = this.rt
    if (this.binding?.defer(() => this.capture(name, properties, meta))) return
    if (
      !rt ||
      this.getConsent() === 'denied' ||
      (this.binding && !this.binding.controller.current())
    )
      return
    if (!NAME_PATTERN.test(String(name))) return this.rejectName()
    const event = buildEvent({
      identity: rt.identity,
      name,
      properties,
      meta,
      context: this.platform.context(),
      extras: this.platform.eventProperties(),
    })
    if (rt.queue.has(event.event_id)) return
    if (byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) {
      rt.log(`event_too_large: dropping event over ${MAX_EVENT_BYTES} bytes`)
      return
    }
    rt.queue.push(event)
    if (this.consent === 'granted') rt.sender.schedule()
  }

  private rejectName(): void {
    if (this.warnedName) return
    this.warnedName = true
    console.warn('[corlex] event_name_invalid: use 1-128 chars of [a-z0-9_.:-]')
  }

  identify(userId: string, traits?: Properties): void {
    if (this.getConsent() === 'denied' || !this.rt) return
    if (typeof userId !== 'string' || userId === '') return
    this.rt.identity.setUser(userId)
    this.track(EVENT_IDENTIFY, traits)
  }

  setUserProperties(properties: Properties): void {
    if (isRecord(properties)) this.track(EVENT_USER_PROPS, properties)
  }

  flag<T extends boolean | number | string>(key: string, defaultValue: T): T {
    return this.config.get(key, defaultValue)
  }

  reset(): void {
    this.exposures?.clear()
    this.rt?.identity.reset()
  }

  flush(options?: FlushOptions): Promise<void> {
    const pending = this.binding?.ready()
    return pending
      ? pending.then(() => this.flush(options))
      : this.getConsent() === 'granted'
        ? (this.rt?.sender.flush(options) ?? Promise.resolve())
        : Promise.resolve()
  }

  /** Current privacy choice, including browser privacy signals and cross-context fences. */
  getConsent(): ConsentState {
    return this.blocked ? 'denied' : (this.binding?.consent() ?? this.consent)
  }

  optIn(): void {
    if (this.blocked || !this.options) return
    if (this.binding) return this.binding.grant()
    this.resumeGranted()
  }

  private resumeGranted(): void {
    if (!this.options) return
    this.consent = 'granted'
    if (!this.binding) this.platform.stores.persistent.set(CONSENT_KEY, 'granted')
    if (!this.rt) return this.start(this.options)
    const rt = this.rt
    rt.identity.persist()
    rt.queue.enablePersistence()
    this.platform.onConsentGranted()
    rt.sender.resume()
    this.startRemoteConfig()
  }

  /** Stops collecting and removes everything the SDK stored on this device, the saved config too. */
  optOut(): void {
    if (this.binding) return this.binding.revoke()
    this.consent = 'denied'
    this.platform.stores.persistent.set(CONSENT_KEY, 'denied')
    this.remote?.stop(true)
    this.exposures?.clear()
    const rt = this.rt
    if (!rt) return
    rt.sender.stop()
    rt.queue.clear()
    rt.identity.wipe()
    rt.identity = new Identity(this.platform.stores.identity, false)
    this.platform.onOptOut()
  }

  private invalidateBinding(): void {
    this.consent = 'pending'
    this.remote?.destroy()
    this.rt?.sender.stop()
    this.rt?.queue.clear()
    this.rt?.identity.wipe()
    this.rt?.teardown()
    this.rt = undefined
    this.remote = undefined
    this.exposures = undefined
    this.platform.onOptOut()
  }

  private activateBinding(preserve: boolean): void {
    if (!preserve) this.invalidateBinding()
    this.resumeGranted()
  }

  /** Detaches all listeners and timers; the instance cannot be used afterwards. */
  destroy(): void {
    this.binding?.cancel()
    this.remote?.destroy()
    this.rt?.teardown()
    this.rt?.sender.stop()
    this.rt = undefined
  }
}
