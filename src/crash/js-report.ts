import { errorDetails, exactUtf8, uuid } from '#core'
import type { CrashReport, CrashSource } from './report'
export interface JsReportOptions {
  fatal: boolean
  source: CrashSource
  captureErrorMessages?: boolean
  appVersion?: string | undefined
  build?: string | undefined
}
export function reportFromError(error: unknown, options: JsReportOptions): CrashReport {
  return {
    crashId: uuid(),
    kind: 'js',
    fatal: options.fatal,
    ...errorDetails(error, options.captureErrorMessages === true),
    source: options.source,
    timestamp: new Date().toISOString(),
    appVersion: exactUtf8(options.appVersion, 128) ? options.appVersion : '',
    build: exactUtf8(options.build, 32) ? options.build : '',
  }
}
