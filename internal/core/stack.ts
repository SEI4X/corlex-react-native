import { MAX_ARRAY, MAX_PROPERTY_STRING } from './limits'
import { truncateBytes } from './util'

/** One stack frame of JS code as the grouping and the symbolicator of task #37 want it. */
export interface JsFrame {
  /** Function name, or `native` / `anonymous`. */
  fn: string
  /** The bundle or file, without the query string (it carries tokens and dev-server settings). */
  file?: string
  line?: number
  col?: number
}

const MAX_FN = 200

/**
 * V8 (Chrome, Edge, Node) and Hermes: `at fn (file:1:2)`, `at file:1:2`, `at async fn (file:1:2)`,
 * `at fn (address at file:1:2)` (Hermes bytecode).
 */
const V8_FRAME =
  /^\s*at\s+(?:async\s+)?(?:(.*?)\s+\()?(?:address at\s+)?([^()]*?):(\d+):(\d+)\)?\s*$/
/** `at fn (native)` / `at Array.map (<anonymous>)` / `at native`: a frame without a position. */
const V8_NO_POSITION = /^\s*at\s+(?:async\s+)?(.*?)\s*(?:\((?:native|<anonymous>)\))?\s*$/
/** Firefox and Safari: `fn@file:1:2`, `@file:1:2`; Safari sometimes has no column. */
const GECKO_FRAME = /^\s*(.*?)@(.+?):(\d+)(?::(\d+))?\s*$/
const GECKO_NATIVE = /^\s*(.*?)@\[native code\]\s*$/

const stripQuery = (file: string): string => file.replace(/[?#].*$/, '')

/** `match` is [whole, fn, file, line, col?] of a frame regex. */
function frame(match: RegExpExecArray): JsFrame {
  const [, fn, file = '', line = '0', col] = match
  const out: JsFrame = {
    fn: truncateBytes(fn === undefined || fn === '' ? 'anonymous' : fn, MAX_FN),
    file: truncateBytes(stripQuery(file), MAX_PROPERTY_STRING),
    line: Number(line),
  }
  if (col !== undefined) out.col = Number(col)
  return out
}

function parseV8Line(line: string): JsFrame | undefined {
  if (!/^\s*at\s/.test(line)) return undefined
  const v8 = V8_FRAME.exec(line)
  if (v8) return frame(v8)
  const bare = V8_NO_POSITION.exec(line)
  return bare ? { fn: truncateBytes(bare[1] || 'native', MAX_FN) } : undefined
}

function parseGeckoLine(line: string): JsFrame | undefined {
  const nativeGecko = GECKO_NATIVE.exec(line)
  if (nativeGecko) return { fn: truncateBytes(nativeGecko[1] || 'native', MAX_FN) }
  const gecko = GECKO_FRAME.exec(line)
  return gecko ? frame(gecko) : undefined
}

/**
 * Frames of a JS stack string, innermost first, from any engine: V8 and Hermes (`at ...`),
 * Firefox and Safari (`fn@file:line:col`). Lines that are no frame (the `Name: message` head)
 * are skipped. Query strings are cut from file names. Capped at the protocol's array limit.
 */
export function parseJsStack(stack: string | undefined): JsFrame[] {
  if (stack === undefined) return []
  // A stack is in one dialect. The `Name: message` head of a V8 stack could pass for a Gecko
  // frame (`user@host:25`), so Gecko lines are read only when no line starts with `at`.
  const parseLine = /^\s*at\s/m.test(stack) ? parseV8Line : parseGeckoLine
  const frames: JsFrame[] = []
  for (const line of stack.split('\n')) {
    if (line.trim() === '') continue
    const parsed = parseLine(line)
    if (parsed !== undefined) frames.push(parsed)
    if (frames.length >= MAX_ARRAY) break
  }
  return frames
}

/** URLs in text, minus their query and fragment: `GET https://x/y?token=…` carries both. */
export function stripUrlQueries(text: string): string {
  return text.replace(/(https?:\/\/[^\s?#'")]+)[?#][^\s'")]*/g, '$1')
}
