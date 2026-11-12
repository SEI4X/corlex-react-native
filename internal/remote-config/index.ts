// The part of Remote Config that SDKs bundle: types, bucketing and evaluation. Pure, no I/O and no
// dependency but `flags/bucket`, so it stays a few hundred bytes in the browser bundle.
export { BUCKETS, bucketOf } from '../flags/bucket'
export { resolveAll, resolveParam, type Resolved } from './evaluate'
export type {
  CompiledExperiment,
  CompiledParam,
  CompiledVariant,
  ConfigDocument,
  ConfigJson,
  EvalContext,
} from './types'
export {
  assignVariant,
  compileExperiment,
  compileVariants,
  experimentBucket,
  variantsProblem,
  type Assignment,
  type ExperimentSource,
  type VariantDefinition,
} from './experiments'
