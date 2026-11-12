import { afterEach, expect, it, vi } from 'vitest'
import { fakeNetwork, launch, newDevice } from './kit'

afterEach(() => vi.unstubAllGlobals())
it.each([
  'https:example.test',
  'https:/example.test',
  'https:///example.test',
  'https://example.test\\proxy',
  'http://analytics.example.test',
  'ftp://analytics.example.test',
  'https://user:synthetic@analytics.example.test',
  'https://analytics.example.test?token=synthetic',
  'https://analytics.example.test#synthetic',
  'https://@analytics.example.test',
  'https://analytics.example.test\n/path',
])('rejects unsafe endpoint without network or sensitive diagnostics: %s', async (endpoint) => {
  const net = fakeNetwork(),
    warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const sdk = launch(newDevice(), { endpoint, config: { enabled: false } })
  try {
    sdk.track('safe_test')
    await sdk.flush()
    sdk.optIn()
    await sdk.flush()
    expect(net.fn).not.toHaveBeenCalled()
    expect(warning.mock.calls).toEqual([['[corlex] invalid_endpoint']])
  } finally {
    sdk.destroy()
    warning.mockRestore()
  }
})
it('validates config endpoint before either network path starts', async () => {
  const net = fakeNetwork(),
    warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const sdk = launch(newDevice(), { configEndpoint: 'http://config.example.test' })
  try {
    sdk.track('safe_test')
    await sdk.flush()
    await sdk.config.refresh()
    expect(net.fn).not.toHaveBeenCalled()
  } finally {
    sdk.destroy()
    warning.mockRestore()
  }
})
it.each([
  'http://localhost:3102/proxy',
  'http://127.19.20.21:3102/proxy',
  'http://[::1]:3102/proxy',
  'http://10.0.2.2:3102/proxy',
  'http://10.0.3.2:3102/proxy',
  'https://analytics.example.test/proxy',
])('preserves supported development/HTTPS proxy paths: %s', async (endpoint) => {
  const net = fakeNetwork(),
    sdk = launch(newDevice(), { endpoint, config: { enabled: false } })
  try {
    sdk.track('safe_test')
    await sdk.flush()
    expect(net.fn.mock.calls[0]?.[0]).toBe(endpoint + '/v1/batch')
  } finally {
    sdk.destroy()
  }
})
it('allows a consciously enabled HTTP developer endpoint', async () => {
  const net = fakeNetwork(),
    sdk = launch(newDevice(), {
      endpoint: 'http://192.168.1.20/proxy',
      allowInsecureHttp: true,
      config: { enabled: false },
    })
  try {
    sdk.track('safe_test')
    await sdk.flush()
    expect(net.fn.mock.calls[0]?.[0]).toBe('http://192.168.1.20/proxy/v1/batch')
  } finally {
    sdk.destroy()
  }
})
