import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CorlexCore } from '../client'
import { CONFIG_ENDPOINT, ENDPOINT, FakePlatform, KEY, fakeNetwork, newDevice } from './kit'
import type { ConfigJson } from '../types'

/**
 * The shared Remote Config vectors (packages/domain/test-vectors): every SDK, TypeScript or
 * native, must give these answers, or people move between rollout groups when they update.
 */
const FILE = fileURLToPath(
  new URL('../../../test-vectors/remote-config.json', import.meta.url),
)

interface Param {
  k: string
  t: string
  v: ConfigJson
  r: number
  o?: Record<string, ConfigJson>
}
interface ResolveCase {
  name: string
  param: Param
  context: { userId: string; platform?: string }
  expected: { value: ConfigJson } | null
}
interface ExperimentCase {
  name: string
  experiment: { k: string; s: string; p?: string; v: { n: string; b: number; v: ConfigJson }[] }
  userId: string
  expected: { variant: string; value: ConfigJson } | null
}

const vectors = JSON.parse(readFileSync(FILE, 'utf8')) as {
  resolve: ResolveCase[]
  experiments: ExperimentCase[]
}

afterEach(() => vi.unstubAllGlobals())

async function sdkWith(doc: object, platform: string, userId: string) {
  const net = fakeNetwork()
  net.state.config = JSON.stringify({ version: 1, etag: '"v1"', ...doc })
  const sdk = new CorlexCore(new FakePlatform(newDevice(), platform))
  sdk.init({ key: KEY, endpoint: ENDPOINT, configEndpoint: CONFIG_ENDPOINT })
  sdk.identify(userId)
  await sdk.config.ready()
  return sdk
}

describe('shared Remote Config vectors', () => {
  const resolvable = vectors.resolve.filter((c) => c.context.userId !== '')
  it.each(resolvable)('resolve: $name', async ({ param, context, expected }) => {
    const sdk = await sdkWith(
      { params: [param] },
      context.platform ?? 'react-native',
      context.userId,
    )
    // The SDK only returns a value of the fallback's type; 'sentinel' of the same type tells "no value".
    const sentinel: ConfigJson = JSON.parse(JSON.stringify(param.v))
    const fallback =
      typeof sentinel === 'boolean' ? !sentinel : typeof sentinel === 'number' ? -1 : sentinel
    const got = sdk.config.get(param.k, fallback)
    if (expected === null) expect(got).toEqual(fallback)
    else expect(got).toEqual(expected.value)
    sdk.destroy()
  })

  it.each(vectors.experiments.filter((c) => c.userId !== ''))(
    'experiment: $name',
    async ({ experiment, userId, expected }) => {
      const sdk = await sdkWith({ params: [], experiments: [experiment] }, 'react-native', userId)
      const got = sdk.experiment(experiment.k)
      if (expected === null) expect(got).toBeNull()
      else expect(got).toEqual({ variant: expected.variant, value: expected.value })
      sdk.destroy()
    },
  )
})
