import { describe, expect, it } from 'vitest'
import { parseJsStack, stripUrlQueries } from '../stack'

describe('parseJsStack', () => {
  it('reads Chrome (V8) frames, with and without a function name, async and new', () => {
    const stack = [
      'TypeError: Cannot read properties of undefined (reading "kcal")',
      '    at summarize (https://app.test/assets/app.3f2a1c.js:1:2345)',
      '    at https://app.test/assets/app.3f2a1c.js?x=1:1:99',
      '    at async load (https://app.test/assets/app.3f2a1c.js?v=7:3:4)',
      '    at new Meal (https://app.test/assets/app.3f2a1c.js:5:6)',
      '    at Array.map (<anonymous>)',
    ].join('\n')
    expect(parseJsStack(stack)).toEqual([
      { fn: 'summarize', file: 'https://app.test/assets/app.3f2a1c.js', line: 1, col: 2345 },
      { fn: 'anonymous', file: 'https://app.test/assets/app.3f2a1c.js', line: 1, col: 99 },
      { fn: 'load', file: 'https://app.test/assets/app.3f2a1c.js', line: 3, col: 4 },
      { fn: 'new Meal', file: 'https://app.test/assets/app.3f2a1c.js', line: 5, col: 6 },
      { fn: 'Array.map' },
    ])
  })

  it('reads Firefox frames, anonymous ones and native code', () => {
    const stack = [
      'summarize@https://app.test/assets/app.js:10:15',
      '@https://app.test/assets/app.js?cache=1:20:5',
      'onClick/<@https://app.test/assets/app.js:30:1',
      'forEach@[native code]',
    ].join('\n')
    expect(parseJsStack(stack)).toEqual([
      { fn: 'summarize', file: 'https://app.test/assets/app.js', line: 10, col: 15 },
      { fn: 'anonymous', file: 'https://app.test/assets/app.js', line: 20, col: 5 },
      { fn: 'onClick/<', file: 'https://app.test/assets/app.js', line: 30, col: 1 },
      { fn: 'forEach' },
    ])
  })

  it('reads Safari frames, with a missing column and global code', () => {
    const stack = [
      'summarize@https://app.test/app.js:10:15',
      'global code@https://app.test/app.js:99',
      '[native code]',
    ].join('\n')
    expect(parseJsStack(stack)).toEqual([
      { fn: 'summarize', file: 'https://app.test/app.js', line: 10, col: 15 },
      { fn: 'global code', file: 'https://app.test/app.js', line: 99 },
    ])
  })

  it('reads Hermes frames: bytecode addresses and native functions', () => {
    const stack = [
      'TypeError: undefined is not an object',
      '    at MealSummary (address at index.android.bundle:1:2345)',
      '    at anonymous (address at index.android.bundle:1:77)',
      '    at map (native)',
    ].join('\n')
    expect(parseJsStack(stack)).toEqual([
      { fn: 'MealSummary', file: 'index.android.bundle', line: 1, col: 2345 },
      { fn: 'anonymous', file: 'index.android.bundle', line: 1, col: 77 },
      { fn: 'map' },
    ])
  })

  it('does not mistake the message head of a V8 stack for a Firefox frame', () => {
    const stack = 'Error: mail me@host.test:25\n    at f (https://a.test/x.js:1:1)'
    expect(parseJsStack(stack)).toEqual([{ fn: 'f', file: 'https://a.test/x.js', line: 1, col: 1 }])
  })

  it('caps the frames and survives garbage', () => {
    const many = Array.from({ length: 300 }, (_, i) => `    at f${i} (a.js:${i}:1)`).join('\n')
    expect(parseJsStack(many)).toHaveLength(100)
    expect(parseJsStack(undefined)).toEqual([])
    expect(parseJsStack('not a stack at all')).toEqual([])
  })
})

describe('stripUrlQueries', () => {
  it('cuts the query and the fragment of URLs in a message', () => {
    expect(
      stripUrlQueries('GET https://api.test/v1/me?token=abc&x=1 failed (see https://a.test/#frag)'),
    ).toBe('GET https://api.test/v1/me failed (see https://a.test/)')
    expect(stripUrlQueries('nothing to cut: 5?3')).toBe('nothing to cut: 5?3')
  })
})
