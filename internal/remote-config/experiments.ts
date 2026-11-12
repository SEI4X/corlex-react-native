import { BUCKETS, bucketOf } from '../flags/bucket'
import type { CompiledExperiment, ConfigJson } from './types'

/**
 * Deterministic assignment of a person to an experiment variant (task 40). The bucket is the
 * Remote Config one (FNV-1a + murmur3 over `key \0 id`, 10 000 buckets) taken over the string
 * `ab:<experiment key>:<salt>`. The `ab:` prefix cannot occur in a parameter key (the colon is not
 * allowed there), so experiments never share buckets with rollouts; the experiment's own salt
 * makes two experiments independent and lets a restarted test reshuffle people. The variants are
 * consecutive ranges of buckets sized by weight: the same person gets the same variant in every
 * language (shared vectors in `packages/domain/test-vectors/remote-config.json`).
 */
export const experimentBucket = (key: string, salt: string, userId: string): number =>
  bucketOf(`ab:${key}:${salt}`, userId)

export interface Assignment {
  /** Variant key: `control`, `variant_b`... */
  variant: string
  /** Its position; 0 is the control. */
  index: number
  value: ConfigJson
}

/** The variant a person gets: the first whose upper bound is above the person's bucket. */
export function assignVariant(experiment: CompiledExperiment, userId: string): Assignment | null {
  const bucket = experimentBucket(experiment.k, experiment.s, userId)
  const index = experiment.v.findIndex((variant) => bucket < variant.b)
  const variant = experiment.v[index]
  return variant === undefined ? null : { variant: variant.n, index, value: variant.v }
}

/** What a variant looks like before it is compiled: a percentage with up to two decimals. */
export interface VariantDefinition {
  key: string
  /** Percent of people, 0.01 to 99.99; all variants of an experiment sum to 100. */
  weight: number
  value: ConfigJson
}

/** Weights as cumulative bucket bounds: 80/20 is 8 000 and 10 000. The last bound is always 10 000. */
export function compileVariants(variants: readonly VariantDefinition[]): CompiledExperiment['v'] {
  let cumulative = 0
  return variants.map((variant, index) => {
    cumulative += variant.weight
    const bound = index === variants.length - 1 ? BUCKETS : Math.round((cumulative * BUCKETS) / 100)
    return { n: variant.key, b: bound, v: variant.value }
  })
}

/** Why a set of variants cannot be compiled, or null. Weights must sum to 100 and each own a bucket. */
export function variantsProblem(variants: readonly VariantDefinition[]): string | null {
  if (variants.length < 2 || variants.length > 10) return 'Нужно от 2 до 10 вариантов'
  if (new Set(variants.map((v) => v.key)).size !== variants.length)
    return 'Ключи вариантов повторяются'
  const total = variants.reduce((sum, v) => sum + Math.round(v.weight * 100), 0)
  if (total !== BUCKETS) return 'Доли вариантов должны давать 100 %'
  const bounds = compileVariants(variants).map((v) => v.b)
  const empty = bounds.some((bound, i) => bound <= (bounds[i - 1] ?? 0))
  return empty ? 'У каждого варианта должна быть доля не меньше 0,01 %' : null
}

/** An experiment as the database holds it, as far as compiling needs it. */
export interface ExperimentSource {
  key: string
  salt: string
  paramKey: string | null
  variants: readonly VariantDefinition[]
}

/** The compact form that goes into the document (`experiments` section). */
export function compileExperiment(source: ExperimentSource): CompiledExperiment {
  const compiled: CompiledExperiment = {
    k: source.key,
    s: source.salt,
    v: compileVariants(source.variants),
  }
  if (source.paramKey !== null) compiled.p = source.paramKey
  return compiled
}
