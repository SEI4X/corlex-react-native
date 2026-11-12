import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { endpointAllowed } from '../endpoint'
import { isSdkKey } from '../key'

export interface BindingInput {
  key: string
  endpoint: string
  configEndpoint: string
  allowInsecureHttp?: boolean
}

/** This is local routing metadata, never a replacement for server authentication. */
export function bindingDigest(input: BindingInput): string | undefined {
  if (!isSdkKey(input.key)) return undefined
  const bases = [input.endpoint, input.configEndpoint]
  if (!bases.every((base) => endpointAllowed(base, input.allowInsecureHttp))) return undefined
  const canonical = bases.map((base) => new URL(base).href.replace(/\/+$/, ''))
  // URL.href percent-encodes paths and punycodes hosts: this validated tuple is ASCII = UTF-8.
  // Native JS need not provide a global TextEncoder; hashing still uses the audited dependency.
  const tuple = JSON.stringify([input.key, ...canonical])
  if (/[^\x20-\x7e]/.test(tuple)) return undefined
  return bytesToHex(sha256(Uint8Array.from(tuple, (char) => char.charCodeAt(0))))
}
