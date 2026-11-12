/** UTF-8 size of a string. Counted by hand: `TextEncoder` is not everywhere in React Native. */
export function byteLength(s: string): number {
  let bytes = 0
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(s.charCodeAt(i + 1))) {
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

/** Cuts a string to at most `max` UTF-8 bytes without splitting a character. */
export function truncateBytes(s: string, max: number): string {
  let bytes = 0,
    end = 0
  for (const char of s) {
    const size = byteLength(char)
    if (bytes + size > max) break
    bytes += size
    end += char.length
  }
  return s.slice(0, end)
}

interface WebCrypto {
  randomUUID?: () => string
  getRandomValues?: (bytes: Uint8Array) => Uint8Array
}

const webCrypto = (): WebCrypto | undefined => (globalThis as { crypto?: WebCrypto }).crypto

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(16)
  const c = webCrypto()
  if (typeof c?.getRandomValues === 'function') return c.getRandomValues(bytes)
  // Hermes has no `crypto` before React Native 0.8x. Ids only need to be unique, not unguessable.
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

/** A UUID v4. `crypto.randomUUID` needs a secure context, so build it from random bytes. */
export function uuid(): string {
  const c = webCrypto()
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = randomBytes()
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
