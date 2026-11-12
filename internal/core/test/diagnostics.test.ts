import { afterEach, expect, it, vi } from 'vitest'
import { launch, newDevice } from './kit'
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('does not log or retain unbounded invalid telemetry values', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
    sdk = launch(newDevice(), { config: { enabled: false } })
  try {
    for (let index = 0; index < 10000; index++)
      sdk.track(`synthetic-user@example.test sensitive-token-${index}`)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-user')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-token')
    const retainedSets = Object.values(sdk).filter(
      (value): value is Set<unknown> => value instanceof Set,
    )
    expect(retainedSets.every((set) => set.size <= 1)).toBe(true)
  } finally {
    sdk.destroy()
  }
})
it('oversize-event diagnostics carry only a reason, even with debug enabled', () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {}),
    sdk = launch(newDevice(), { debug: true, config: { enabled: false } })
  const sensitiveName = `ck_test_${'z'.repeat(43)}`
  try {
    sdk.track(
      sensitiveName,
      Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [`field_${index}`, 'x'.repeat(1024)]),
      ),
    )
    expect(debug).toHaveBeenCalled()
    expect(JSON.stringify(debug.mock.calls)).not.toContain(sensitiveName)
  } finally {
    sdk.destroy()
  }
})
