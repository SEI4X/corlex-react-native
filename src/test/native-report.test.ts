import { describe, expect, it } from 'vitest'
import { crashProperties, parseCrashFile } from '../crash/report'

const id = '01234567-89ab-4cde-8fab-0123456789ab'
const header = JSON.stringify({
  crash_id: id,
  kind: 'native',
  fatal: true,
  platform: 'ios',
  app_version: '1.2.3',
  build: '42',
  timestamp_ms: 1794480000123,
})
const frame = `F\t${id}\t0x100000000\t0x100001234\t/Users/private/MyApp\tknownFunction`

describe('structured native reports', () => {
  it('preserves original native platform, release and millisecond timestamp', () => {
    const report = parseCrashFile(`${header}\n${frame}\n`)
    expect(report).toMatchObject({
      nativePlatform: 'ios',
      appVersion: '1.2.3',
      build: '42',
      timestamp: '2026-11-12T10:40:00.123Z',
    })
    expect(report?.frames).toEqual([
      {
        debug_id: id,
        image_addr: '0x100000000',
        addr: '0x100001234',
        image: 'MyApp',
        fn: 'knownFunction',
      },
    ])
    if (report === undefined) throw new Error('Missing report')
    expect(crashProperties(report)).toMatchObject({ build: '42', symbolicated: false })
  })

  it('caps frames and rejects damaged structured addresses without retaining private paths', () => {
    const report = parseCrashFile(
      `${header}\n${frame.replace('0x100001234', 'secret')}\n${Array(120).fill(frame).join('\n')}`,
    )
    expect(report?.frames).toHaveLength(100)
    expect(JSON.stringify(report?.frames)).not.toContain('/Users/')
    expect(JSON.stringify(report?.frames)).not.toContain('secret')
  })

  it('legacy native free-form text and custom messages do not bypass privacy defaults', () => {
    const raw = JSON.stringify({
      crash_id: id,
      kind: 'native',
      name: 'customer@example.test',
      message: 'secret-token-123',
    })
    const report = parseCrashFile(`${raw}\nCaused by: customer@example.test at /private/file`)
    expect(report).toMatchObject({
      name: 'NativeError',
      message: 'Error details omitted',
      frames: [],
    })
    expect(parseCrashFile(raw, { captureErrorMessages: true })?.message).toBe('secret-token-123')
  })

  it('Android structured Java frames retain retrace input with a basename only', () => {
    const raw = JSON.stringify({
      crash_id: id,
      kind: 'native',
      platform: 'android',
      frames: [{ fn: 'a.b.C.a', file: '/private/SourceFile', line: 5 }],
    })
    expect(parseCrashFile(raw)?.frames).toEqual([{ fn: 'a.b.C.a', file: 'SourceFile', line: 5 }])
  })

  it('retains static JVM exception classes for retrace while keeping messages private', () => {
    const raw = JSON.stringify({
      crash_id: id,
      kind: 'native',
      platform: 'android',
      name: 'a.b.e',
      message: 'customer@example.test',
    })
    expect(parseCrashFile(raw)).toMatchObject({ name: 'a.b.e', message: 'Error details omitted' })
    expect(parseCrashFile(raw.replace('a.b.e', 'customer@example.test'))?.name).toBe('NativeError')
  })

  it('keeps the full shared release metadata bound instead of silently clipping to64', () => {
    const version = 'v'.repeat(128)
    const build = '9'.repeat(32)
    const raw = JSON.stringify({
      crash_id: id,
      kind: 'native',
      platform: 'ios',
      app_version: version,
      build,
    })
    expect(parseCrashFile(raw)).toMatchObject({ appVersion: version, build })
  })

  it('oversized or invalid original release metadata is unknown, never a clipped or current build', () => {
    const raw = JSON.stringify({
      crash_id: id,
      kind: 'native',
      platform: 'ios',
      app_version: 'v'.repeat(129),
      build: '9'.repeat(33),
    })
    expect(parseCrashFile(raw)).toMatchObject({ appVersion: '', build: '' })
    const invalidScalar = JSON.stringify({
      crash_id: id,
      kind: 'native',
      platform: 'ios',
      app_version: '\ud800',
      build: '\udc00',
    })
    expect(parseCrashFile(invalidScalar)).toMatchObject({ appVersion: '', build: '' })
    const missing = JSON.stringify({ crash_id: id, kind: 'native' })
    expect(parseCrashFile(missing)).toMatchObject({ appVersion: '', build: '' })
  })

  it('damaged timestamp cannot throw and oversized local records are discarded', () => {
    expect(() => parseCrashFile('{"crash_id":"id","timestamp_ms":1e300}')).not.toThrow()
    expect(parseCrashFile('x'.repeat(256 * 1024 + 1))).toBeUndefined()
  })
})
