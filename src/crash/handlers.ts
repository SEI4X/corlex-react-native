export type ErrorHandler = (error: unknown, isFatal?: boolean) => void

/** React Native's `ErrorUtils` global. */
export interface ErrorUtilsLike {
  getGlobalHandler(): ErrorHandler
  setGlobalHandler(handler: ErrorHandler): void
}

/** What `HermesInternal` offers for promise rejections. */
export interface HermesLike {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean
    onUnhandled: (id: number, error: unknown) => void
    onHandled?: (id: number) => void
  }) => void
}

type Marked = ErrorHandler & { [WRAPPED]?: ErrorHandler | undefined }
const WRAPPED = Symbol.for('corlex.errorHandler.wrapped')

const noop = (): void => {}

/**
 * Reports every uncaught JS error, then calls the handler that was there before (the red box in
 * development, the native crash in production), so the app behaves exactly as without the SDK.
 * Installing twice (Fast Refresh runs `init` again) does not nest: the earlier wrapper is looked
 * through. Returns a function that puts the previous handler back, if ours is still the current one.
 */
export function installGlobalHandler(
  utils: ErrorUtilsLike | undefined,
  onError: (error: unknown, fatal: boolean) => void,
): () => void {
  if (utils === undefined) return noop
  const current = utils.getGlobalHandler() as Marked
  const previous: ErrorHandler | undefined = current[WRAPPED] ?? current
  const handler: Marked = (error, isFatal) => {
    try {
      onError(error, isFatal === true)
    } catch {
      // The SDK must never make a crash worse.
    }
    previous(error, isFatal)
  }
  handler[WRAPPED] = previous
  utils.setGlobalHandler(handler)
  return () => {
    if (utils.getGlobalHandler() === handler) utils.setGlobalHandler(previous)
  }
}

/**
 * Reports promise rejections nobody handled (Hermes). React Native's own tracker is replaced by
 * this one (there is a single slot), so the usual development warning is printed here as well.
 * There is no way to remove a tracker: the returned function only stops reporting.
 */
export function installRejectionTracker(
  hermes: HermesLike | undefined,
  onRejection: (error: unknown) => void,
  warn: (message: string) => void = (m) => console.warn(m),
): () => void {
  if (typeof hermes?.enablePromiseRejectionTracker !== 'function') return noop
  let active = true
  let warned = false
  hermes.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (id, error) => {
      if (!warned) {
        warned = true
        warn(`Possible Unhandled Promise Rejection (id: ${id}): details omitted by Corlex`)
      }
      if (!active) return
      try {
        onRejection(error)
      } catch {
        // Never throw out of a rejection hook.
      }
    },
  })
  return () => {
    active = false
  }
}
