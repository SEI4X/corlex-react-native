/** Buckets per hundred percent: a rollout moves in steps of 0.01 %. */
export const BUCKETS = 10_000

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a over the UTF-8 bytes, then murmur3's finalizer so nearby inputs spread evenly. */
function hash32(text: string): number {
  let h = FNV_OFFSET
  for (const byte of utf8Bytes(text)) {
    h ^= byte
    h = Math.imul(h, FNV_PRIME)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * The bucket (0 to 9999) of a person for a key. Stable: it depends on nothing but the two
 * strings, so the same person lands in the same bucket on every cell, in every process and
 * after every restart. The key is part of the hash so that two flags at 10 % do not pick the
 * same 10 % of people. Raising a percentage only ever adds people: bucket < threshold.
 */
export function bucketOf(key: string, userId: string): number {
  // The separator cannot occur in a flag key, so ("ab","c") and ("a","bc") differ.
  return hash32(`${key}\u0000${userId}`) % BUCKETS
}

/** Standard URI encoding supplies UTF-8 on native JS hosts without the web TextEncoder global. */
export function utf8Bytes(text: string): Uint8Array {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text)
  // Match TextEncoder's USVString replacement; Unicode mode leaves valid pairs intact.
  const encoded = encodeURIComponent(text.replace(/[\uD800-\uDFFF]/gu, '\uFFFD'))
  const bytes: number[] = []
  for (let index = 0; index < encoded.length; index++) {
    if (encoded.charAt(index) === '%') {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16))
      index += 2
    } else bytes.push(encoded.charCodeAt(index))
  }
  return Uint8Array.from(bytes)
}
