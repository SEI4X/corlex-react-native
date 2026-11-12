import { TextEncoder as NativeEncoder } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { bucketOf, utf8Bytes } from './bucket'

const values = [
  'user-1',
  'Привет',
  '用户',
  '😀',
  '\uD800',
  '\uDC00',
  '\uD800😀\uDFFF',
  '%+/?#\u0000',
  'e\u0301',
  'é',
]

describe('native bucketing without TextEncoder', () => {
  it('keeps the exact existing Unicode and replacement-scalar bucket assignments', () => {
    const expected = values.map((userId) => bucketOf('flag_key', userId))
    vi.stubGlobal('TextEncoder', undefined)
    try {
      expect(values.map((userId) => bucketOf('flag_key', userId))).toEqual(expected)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('matches native UTF8 bytes at scalar boundaries and for every UTF16 code unit', () => {
    const boundary = [0, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff].map(
      (point) => String.fromCodePoint(point),
    )
    const samples = [
      ...values,
      ...boundary,
      Array.from({ length: 65536 }, (_, unit) => String.fromCharCode(unit)).join(''),
    ]
    const encoder = new NativeEncoder()
    const expected = samples.map((text) => encoder.encode(text))
    vi.stubGlobal('TextEncoder', undefined)
    try {
      expect(samples.map(utf8Bytes)).toEqual(expected)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
