import { isRecord, MAX_ARRAY, safeErrorReport, byteLength, truncateBytes } from '#core'
import type { Properties } from '#core'
import type { JsFrame } from './frames'

/** Error messages can hold user data; a short head is enough to group by and to read. */
const MAX_MESSAGE = 512

export type CrashSource =
  'global_handler' | 'unhandled_rejection' | 'ns_exception' | 'signal' | 'java_exception'

export interface NativeFrame {
  debug_id?: string
  image_addr: string
  addr: string
  image: string
  fn?: string
}

export interface CrashReport {
  /** Identifies the crash in retries and in the crash table. */
  crashId: string
  kind: 'js' | 'native'
  fatal: boolean
  name: string
  message: string
  /** JS frames as objects (for source maps), native frames as the lines the OS gave. */
  frames: (JsFrame | NativeFrame | string)[]
  nativePlatform?: 'ios' | 'android'
  appVersion?: string
  build?: string
  source: CrashSource
  /** RFC 3339 time of the crash. */
  timestamp: string
}

const clip = (value: string, max: number): string => truncateBytes(value, max)

export { reportFromError } from './js-report'

/** The properties of the `corlex.crash` event. Everything fits the protocol's limits. */
export function crashProperties(report: CrashReport): Properties {
  return {
    crash_id: report.crashId,
    kind: report.kind,
    fatal: report.fatal,
    name: report.name,
    message: report.message,
    source: report.source,
    frames: report.frames,
    symbolicated: false,
    ...(report.build === undefined ? {} : { build: report.build }),
  }
}

const SOURCES: readonly string[] = [
  'global_handler',
  'unhandled_rejection',
  'ns_exception',
  'signal',
  'java_exception',
]

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)

function releaseMetadata(value: unknown, limit: number): string {
  if (typeof value !== 'string' || byteLength(value) > limit) return ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return ''
    } else if (code >= 0xdc00 && code <= 0xdfff) return ''
  }
  return value
}

function nativeName(header: Record<string, unknown>): string {
  const name = str(header['name'], 'Error')
  if (header['kind'] === 'js') return clip(name, 128)
  if (/^SIG(?:ABRT|SEGV|BUS|ILL|FPE|TRAP)$/.test(name)) return name
  if (
    (header['platform'] === 'android' || header['source'] === 'java_exception') &&
    name.length <= 128 &&
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(name)
  )
    return name
  return 'NativeError'
}

function timestampOf(header: Record<string, unknown>): string {
  const raw = header['timestamp_ms']
  const seconds = header['timestamp_s']
  const millis = typeof raw === 'number' ? raw : typeof seconds === 'number' ? seconds * 1000 : NaN
  const date = new Date(millis)
  if (Number.isFinite(date.getTime())) return date.toISOString()
  const iso = str(header['timestamp'], '')
  return Number.isNaN(Date.parse(iso)) ? new Date().toISOString() : iso
}

function nativeFrame(line: string): NativeFrame | undefined {
  const [kind, debugId, base, addr, rawImage, fn] = line.split('\t')
  if (
    kind !== 'F' ||
    !base ||
    !addr ||
    !rawImage ||
    !/^0x[0-9a-f]{1,16}$/i.test(base) ||
    !/^0x[0-9a-f]{1,16}$/i.test(addr)
  )
    return undefined
  const image = clip(rawImage.split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? '-', 128)
  const frame: NativeFrame = { image_addr: base, addr, image }
  if (debugId && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(debugId))
    frame.debug_id = debugId
  if (fn && /^[\w.$:<>()[\] +~-]{1,200}$/.test(fn)) frame.fn = fn
  return frame
}

function javaFrame(value: unknown): JsFrame | undefined {
  if (
    !isRecord(value) ||
    typeof value['fn'] !== 'string' ||
    !/^[\w.$<>-]{1,200}$/.test(value['fn'])
  )
    return undefined
  const frame: JsFrame = { fn: value['fn'] }
  if (typeof value['file'] === 'string')
    frame.file = clip(value['file'].split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? '', 128)
  if (typeof value['line'] === 'number' && Number.isSafeInteger(value['line']) && value['line'] > 0)
    frame.line = value['line']
  return frame
}

function framesOf(
  header: Record<string, unknown>,
  lines: string[],
): (JsFrame | NativeFrame | string)[] {
  const own = header['frames']
  if (Array.isArray(own)) {
    if (header['kind'] === 'js') return own.slice(0, MAX_ARRAY) as JsFrame[]
    return own
      .slice(0, MAX_ARRAY)
      .map(javaFrame)
      .filter((frame): frame is JsFrame => frame !== undefined)
  }
  // Legacy free-form native text can contain exception messages or private filesystem paths.
  return lines
    .slice(0, MAX_ARRAY + 1)
    .map(nativeFrame)
    .filter((frame): frame is NativeFrame => frame !== undefined)
    .slice(0, MAX_ARRAY)
}

/**
 * A crash file left by the native module: the first line is a JSON header, the rest are native
 * stack frames as the OS printed them (a JS crash recorded natively has its frames in the header).
 * A damaged file (the process died while writing it) yields what can be read, or nothing.
 */
export function parseCrashFile(
  text: string,
  options: { captureErrorMessages?: boolean } = {},
): CrashReport | undefined {
  if (text.length > 256 * 1024) return undefined
  const [first = '', ...rest] = text.split('\n')
  let header: unknown
  try {
    header = JSON.parse(first)
  } catch {
    return undefined
  }
  if (!isRecord(header) || typeof header['crash_id'] !== 'string') return undefined
  const source = str(header['source'], 'signal')
  const frames = framesOf(header, rest)
  const js =
    header['kind'] === 'js'
      ? safeErrorReport(
          { name: header['name'], message: header['message'], frames },
          options.captureErrorMessages === true,
        )
      : undefined
  return {
    crashId: header['crash_id'],
    kind: header['kind'] === 'js' ? 'js' : 'native',
    fatal: header['fatal'] !== false,
    name: js?.name ?? nativeName(header),
    message:
      js !== undefined
        ? js.message
        : options.captureErrorMessages === true
          ? clip(str(header['message'], ''), MAX_MESSAGE)
          : 'Error details omitted',
    frames: js?.frames ?? frames,
    source: (SOURCES.includes(source) ? source : 'signal') as CrashSource,
    timestamp: timestampOf(header),
    ...((header['platform'] === 'ios' || header['platform'] === 'android') &&
    header['kind'] !== 'js'
      ? { nativePlatform: header['platform'] }
      : {}),
    appVersion: releaseMetadata(header['app_version'], 128),
    build: releaseMetadata(header['build'], 32),
  }
}
