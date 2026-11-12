import { MAX_ARRAY } from './limits'
import { parseJsStack, stripUrlQueries, type JsFrame } from './stack'
import { isRecord, truncateBytes } from './util'

const TYPES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'UnhandledRejection',
])
const CREDENTIAL =
  /(?:sk[-_]|ck_(?:live|test)_|cm_|cs_|cu_|corlex_up_)[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]*/
const CODE_FILE = /^[A-Za-z0-9._+-]{1,200}\.(?:[cm]?js|jsx|tsx?|bundle|jsbundle|hbc)$/i
const FUNCTION = /^(?:(?:new|async) )?[\p{L}_$][\p{L}\p{N}_.$<>/]*$/u

export function safeJsFrames(value: unknown): JsFrame[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_ARRAY)
    .filter(isRecord)
    .map((frame) => {
      const raw = typeof frame.fn === 'string' ? frame.fn : ''
      const fn =
        raw.length <= 200 && FUNCTION.test(raw) && !CREDENTIAL.test(raw)
          ? truncateBytes(raw, 200)
          : 'anonymous'
      const out: JsFrame = { fn }
      const file =
        typeof frame.file === 'string'
          ? (frame.file
              .replace(/[?#].*$/, '')
              .split(/[/\\]/)
              .at(-1) ?? '')
          : ''
      if (CODE_FILE.test(file) && !CREDENTIAL.test(file)) out.file = file
      for (const key of ['line', 'col'] as const) {
        const value = frame[key]
        if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) out[key] = value
      }
      return out
    })
}
function details(message: string): string {
  return truncateBytes(
    stripUrlQueries(truncateBytes(message, 2048))
      .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1')
      .replace(new RegExp(CREDENTIAL.source, 'g'), '[redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._~-]{16,}/gi, 'Bearer [redacted]')
      .replace(/\s+/g, ' ')
      .trim(),
    512,
  )
}
/** Safe defaults apply to fresh and recovered reports; detailed messages require explicit opt-in. */
export function safeErrorReport(
  input: { name?: unknown; message?: unknown; frames?: unknown },
  detailed = false,
) {
  return {
    name: typeof input.name === 'string' && TYPES.has(input.name) ? input.name : 'Error',
    message:
      detailed && typeof input.message === 'string'
        ? details(input.message)
        : 'Error details omitted',
    frames: safeJsFrames(input.frames),
  }
}
export function errorDetails(error: unknown, detailed = false, fallback = '') {
  const field = (key: string): string | undefined => {
    try {
      const value = isRecord(error) ? error[key] : undefined
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }
  const stack = field('stack')
  return safeErrorReport(
    {
      name: field('name'),
      message: detailed
        ? (field('message') ?? (typeof error === 'string' ? error : fallback))
        : undefined,
      frames: parseJsStack(stack?.slice(0, 128 * 1024)),
    },
    detailed,
  )
}
