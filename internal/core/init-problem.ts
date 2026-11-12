import { endpointAllowed } from './endpoint'
import { isSdkKey } from './key'
import type { BaseInitOptions } from './types'
export const DEFAULT_ENDPOINT = 'https://ingest.corlex.ru'
export const DEFAULT_CONFIG_ENDPOINT = 'https://config.corlex.ru'
export function initProblem(
  options: BaseInitOptions,
): 'invalid_sdk_key' | 'invalid_endpoint' | undefined {
  if (!isSdkKey(options?.key)) return 'invalid_sdk_key'
  if (
    !endpointAllowed(options.endpoint ?? DEFAULT_ENDPOINT, options.allowInsecureHttp) ||
    !endpointAllowed(options.configEndpoint ?? DEFAULT_CONFIG_ENDPOINT, options.allowInsecureHttp)
  )
    return 'invalid_endpoint'
  return undefined
}
