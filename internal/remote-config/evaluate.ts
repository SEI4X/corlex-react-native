import { BUCKETS, bucketOf } from '../flags/bucket'
import type { CompiledParam, ConfigDocument, ConfigJson, EvalContext } from './types'

/** What a person gets for a parameter: the value, or nothing when the rollout does not reach them. */
export interface Resolved {
  value: ConfigJson
}

/**
 * The value of one compiled parameter for a person. Pure and deterministic, the same in every
 * language (the shared vectors in `packages/domain/test-vectors` pin it down). Order:
 *  1. a platform override wins, whatever the rollout says (it is an explicit rule for the platform);
 *  2. otherwise the parameter applies to people whose stable bucket is below `r` (hundredths of
 *     a percent of the 10 000 buckets). Raising `r` only ever adds people.
 * Outside both, the parameter does not apply and the caller keeps its own default (`null`).
 */
export function resolveParam(param: CompiledParam, context: EvalContext): Resolved | null {
  const { o: overrides } = param
  const { platform } = context
  if (overrides !== undefined && platform !== undefined && Object.hasOwn(overrides, platform)) {
    return { value: (overrides as Record<string, ConfigJson>)[platform] as ConfigJson }
  }
  if (param.r >= BUCKETS || bucketOf(param.k, context.userId) < param.r) return { value: param.v }
  return null
}

/** Every parameter of the document that applies to the person, by key. */
export function resolveAll(
  document: Pick<ConfigDocument, 'params'>,
  context: EvalContext,
): Record<string, ConfigJson> {
  const out: Record<string, ConfigJson> = {}
  for (const param of document.params) {
    const resolved = resolveParam(param, context)
    if (resolved !== null) out[param.k] = resolved.value
  }
  return out
}
