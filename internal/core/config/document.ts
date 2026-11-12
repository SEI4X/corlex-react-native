import type { ConfigDocument } from '#remote-config'
import { isRecord } from '../util'
export const MAX_CONFIG_BYTES = 1024 * 1024
export const MAX_CONFIG_DEPTH = 16
const reserved = new Set(['__proto__', 'constructor', 'prototype'])
const platforms = new Set(['ios', 'android', 'web', 'flutter', 'react-native'])
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max
const httpTag = (value: unknown) =>
  text(value, 256) && [...String(value)].every((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) < 127)
const key = (value: unknown) => text(value, 128) && !reserved.has(String(value))
const integer = (value: unknown, max: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
function json(value: unknown, depth = 0): boolean {
  if (depth > MAX_CONFIG_DEPTH) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => json(item, depth + 1))
  return isRecord(value) && Object.values(value).every((item) => json(item, depth + 1))
}
function valueMatches(type: unknown, value: unknown): boolean {
  if (type === 'bool') return typeof value === 'boolean'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  return type === 'json' && json(value)
}
function param(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !key(value['k']) ||
    !integer(value['r'], 10000) ||
    !valueMatches(value['t'], value['v'])
  )
    return false
  const overrides = value['o']
  return (
    overrides === undefined ||
    (isRecord(overrides) &&
      Object.entries(overrides).every(
        ([name, item]) => platforms.has(name) && valueMatches(value['t'], item),
      ))
  )
}
function experiment(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !key(value['k']) ||
    !text(value['s'], 128) ||
    (value['p'] !== undefined && !key(value['p']))
  )
    return false
  const variants = value['v']
  if (!Array.isArray(variants) || variants.length < 2 || variants.length > 10) return false
  let bound = 0
  const names = new Set<string>()
  for (const variant of variants) {
    if (
      !isRecord(variant) ||
      !text(variant['n'], 128) ||
      !integer(variant['b'], 10000) ||
      Number(variant['b']) <= bound ||
      !json(variant['v']) ||
      names.has(String(variant['n']))
    )
      return false
    bound = Number(variant['b'])
    names.add(String(variant['n']))
  }
  return bound === 10000
}
function unique(items: unknown[], field: string): boolean {
  const values = items
    .map((item) => (isRecord(item) ? item[field] : undefined))
    .filter((value) => value !== undefined)
  return new Set(values).size === values.length
}
/** The same bounded compiled shape is required from the network and persisted cache. */
export function isConfigDocument(value: unknown): value is ConfigDocument {
  if (
    !isRecord(value) ||
    !integer(value['version'], Number.MAX_SAFE_INTEGER) ||
    !httpTag(value['etag'])
  )
    return false
  const params = value['params'],
    experiments = value['experiments']
  return (
    Array.isArray(params) &&
    params.length <= 1000 &&
    params.every(param) &&
    unique(params, 'k') &&
    (experiments === undefined ||
      (Array.isArray(experiments) &&
        experiments.length <= 1000 &&
        experiments.every(experiment) &&
        unique(experiments, 'k') &&
        unique(experiments, 'p')))
  )
}
