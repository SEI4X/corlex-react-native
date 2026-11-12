import { afterEach, expect, it, vi } from 'vitest'
import { fakeNetwork, launch, newDevice } from './kit'
afterEach(() => vi.unstubAllGlobals())
it('stores/sends only generic JS errors and safe bundle locations by default', async () => {
  const device = newDevice(),
    net = fakeNetwork(),
    { sdk, ready } = launch(device, { config: { enabled: false } })
  try {
    await ready
    const error = new Error('alex@example.test synthetic_secret')
    error.name = 'alex@example.test'
    error.stack = 'Error: private\n at save (/Users/alex@example.test/main.jsbundle:4:9)'
    device.errorUtils.throwFatal(error, true)
    await sdk.flush()
    const crash = net.received.find((event) => event.name === 'corlex.crash')
    expect(crash?.properties).toMatchObject({
      name: 'Error',
      message: 'Error details omitted',
      frames: [{ fn: 'save', file: 'main.jsbundle', line: 4, col: 9 }],
    })
    expect(JSON.stringify(crash) + device.native?.recorded.join('')).not.toContain(
      'alex@example.test',
    )
    expect(JSON.stringify(crash) + device.native?.recorded.join('')).not.toContain(
      'synthetic_secret',
    )
  } finally {
    sdk.destroy()
  }
})
it('sanitizes legacy recovered JS files while preserving their original release/build', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  device.native?.files.push(
    JSON.stringify({
      v: 1,
      kind: 'js',
      crash_id: '12345678-1234-4234-9234-123456789012',
      fatal: true,
      name: 'TypeError',
      message: 'alex@example.test synthetic_secret',
      source: 'global_handler',
      timestamp: '2026-01-01T00:00:00Z',
      app_version: '1.0.0',
      build: '7',
      frames: [
        {
          fn: 'save',
          file: 'https://user:synthetic_secret@cdn.test/users/alex@example.test/main.jsbundle',
          line: 4,
          col: 9,
        },
      ],
    }),
  )
  const { sdk, ready } = launch(device, { config: { enabled: false } })
  try {
    await ready
    await sdk.flush()
    const crash = net.received.find((event) => event.name === 'corlex.crash')
    expect(crash?.properties).toMatchObject({
      name: 'TypeError',
      message: 'Error details omitted',
      build: '7',
      frames: [{ fn: 'save', file: 'main.jsbundle', line: 4, col: 9 }],
    })
    expect(crash?.context.app_version).toBe('1.0.0')
    expect(JSON.stringify(crash)).not.toContain('alex@example.test')
    sdk.track('ordinary')
    await sdk.flush()
    expect(net.received.find((event) => event.name === 'ordinary')?.context).toMatchObject({
      platform: 'react-native',
      app_version: '1.2.3',
    })
  } finally {
    sdk.destroy()
  }
})

it('keeps native original OS/release/build while ordinary analytics stays RN', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  device.native?.files.push(
    JSON.stringify({
      kind: 'native',
      platform: 'android',
      app_version: '0.9.0',
      build: '17',
      crash_id: '12345678-1234-4234-9234-123456789012',
      source: 'java_exception',
      timestamp: '2026-01-01T00:00:00Z',
      frames: [{ fn: 'a.b.C.a', file: 'SourceFile', line: 4 }],
    }),
  )
  const { sdk, ready } = launch(device, { config: { enabled: false } })
  try {
    await ready
    await sdk.flush()
    const crash = net.received.find((event) => event.name === 'corlex.crash')
    expect(crash?.context).toMatchObject({ platform: 'android', app_version: '0.9.0' })
    expect(crash?.properties.build).toBe('17')
    sdk.track('ordinary')
    await sdk.flush()
    expect(net.received.find((event) => event.name === 'ordinary')?.context.platform).toBe(
      'react-native',
    )
  } finally {
    sdk.destroy()
  }
})
it('skips an old native binary without passing new arguments through its old ABI', async () => {
  const device = newDevice(),
    net = fakeNetwork(),
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  if (!device.native) throw new Error('missing fixture')
  Reflect.deleteProperty(device.native, 'sdkCapabilities')
  const install = vi.spyOn(device.native, 'install')
  const { sdk, ready } = launch(device, { captureErrorMessages: true, config: { enabled: false } })
  try {
    await expect(ready).resolves.toBeUndefined()
    sdk.optIn()
    await sdk.flush()
    expect(install).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[corlex] native_sdk_rebuild_required')
    expect(net.received.some((event) => event.name === 'app_open')).toBe(true)
  } finally {
    sdk.destroy()
    warn.mockRestore()
  }
})
it('does not crash the app when a new native module installation fails', async () => {
  const device = newDevice()
  fakeNetwork()
  if (!device.native) throw new Error('missing fixture')
  vi.spyOn(device.native, 'install').mockImplementation(() => {
    throw new Error('synthetic_native_failure')
  })
  const { sdk, ready } = launch(device, { config: { enabled: false } })
  try {
    await expect(ready).resolves.toBeUndefined()
    expect(() => sdk.optIn()).not.toThrow()
  } finally {
    sdk.destroy()
  }
})

it('does not attribute a legacy crash with unknown release facts to the current app build', async () => {
  const device = newDevice(),
    net = fakeNetwork()
  device.native?.files.push(
    JSON.stringify({
      kind: 'native',
      platform: 'ios',
      crash_id: '12345678-1234-4234-9234-123456789012',
      source: 'signal',
      timestamp: '2026-01-01T00:00:00Z',
    }),
  )
  const { sdk, ready } = launch(device, { config: { enabled: false } })
  try {
    await ready
    await sdk.flush()
    const crash = net.received.find((event) => event.name === 'corlex.crash')
    expect(crash?.context.app_version).toBeUndefined()
    expect(crash?.properties.build).toBe('')
    sdk.track('ordinary')
    await sdk.flush()
    expect(net.received.find((event) => event.name === 'ordinary')?.context.app_version).toBe(
      '1.2.3',
    )
  } finally {
    sdk.destroy()
  }
})
