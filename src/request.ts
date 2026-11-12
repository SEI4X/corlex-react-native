import type { SDKRequest } from '#core'

/** Only the tested Expo major supplies the required native redirect/stream implementation. */
export function secureExpoRequest(module: unknown, version: unknown): SDKRequest | undefined {
  if (typeof version !== 'string') return undefined
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match || Number(match[1]) !== 58) return undefined
  if (Number(match[2]) === 0 && Number(match[3]) < 21) return undefined
  if (typeof module !== 'object' || module === null || !('fetch' in module)) return undefined
  return typeof module.fetch === 'function' ? (module.fetch as SDKRequest) : undefined
}
