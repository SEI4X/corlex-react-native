import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { bindingDigest } from './digest'

const input = {
  key: `ck_test_${'x'.repeat(43)}`,
  endpoint: 'https://ingest.example.test',
  configEndpoint: 'https://config.example.test',
}

describe('SDK storage binding digest', () => {
  it('matches independent Node SHA256 over the exact JSON tuple and standard SHA vectors', () => {
    expect(bytesToHex(sha256(utf8ToBytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(bindingDigest(input)).toBe(
      createHash('sha256')
        .update(JSON.stringify([input.key, input.endpoint, input.configEndpoint]))
        .digest('hex'),
    )
    expect(bindingDigest(input)).toMatch(/^[a-f0-9]{64}$/)
    expect(bindingDigest(input)).not.toContain(input.key)
  })
  it('works without a global TextEncoder in native JS while retaining exact UTF8 digest parity', () => {
    const endpoint = 'https://ingest.example.test/путь/😀'
    const expected = createHash('sha256')
      .update(JSON.stringify([input.key, new URL(endpoint).href, input.configEndpoint]))
      .digest('hex')
    vi.stubGlobal('TextEncoder', undefined)
    try {
      expect(bindingDigest({ ...input, endpoint })).toBe(expected)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('canonicalizes host/default port/trailing slash but preserves proxy path/cell boundaries', () => {
    const expected = bindingDigest(input)
    expect(
      bindingDigest({
        ...input,
        endpoint: 'https://INGEST.example.test:443///',
        configEndpoint: 'https://CONFIG.example.test:443/',
      }),
    ).toBe(expected)
    for (const override of [
      { key: `ck_live_${'x'.repeat(43)}` },
      { endpoint: 'https://other.example.test' },
      { endpoint: 'https://ingest.example.test:444' },
      { endpoint: 'http://ingest.example.test', allowInsecureHttp: true },
      { endpoint: 'https://ingest.example.test/cell-a' },
      { configEndpoint: 'https://config.example.test/cell-a' },
    ])
      expect(bindingDigest({ ...input, ...override })).not.toBe(expected)
    expect(bindingDigest({ ...input, endpoint: `${input.endpoint}/cell-a/` })).toBe(
      bindingDigest({ ...input, endpoint: `${input.endpoint}/cell-a` }),
    )
    expect(bindingDigest({ ...input, endpoint: `${input.endpoint}/cell-b` })).not.toBe(
      bindingDigest({ ...input, endpoint: `${input.endpoint}/cell-a` }),
    )
  })
  it('rejects non-SDK keys and nonpublic endpoint credentials without any IO', () => {
    for (const key of ['cm_example', 'corlex_up_example', 'sk-example', '', `${input.key}x`])
      expect(bindingDigest({ ...input, key })).toBeUndefined()
    for (const endpoint of [
      'https://user:secret@example.test',
      `${input.endpoint}?key=example`,
      `${input.endpoint}#fragment`,
      'http://example.test',
      'file:///tmp/events',
      'invalid',
    ])
      expect(bindingDigest({ ...input, endpoint })).toBeUndefined()
    expect(bindingDigest({ ...input, endpoint: 'http://localhost:3102' })).toMatch(/^[a-f0-9]{64}$/)
  })
})
