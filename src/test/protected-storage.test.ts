import { expect, it, vi } from 'vitest'
import { protectedStorage } from '../protected-storage'

it('persists only SDK state through the own native file and survives a new adapter', async () => {
  let json = '{}'
  const bridge = {
    readSdkState: vi.fn(async () => json),
    writeSdkState: vi.fn(async (text: string) => {
      json = text
    }),
  }
  const first = protectedStorage(bridge)
  await first.multiGet(['@corlex:corlex_aid'])
  await first.multiSet([
    ['@corlex:corlex_aid', 'a_1'],
    ['@app:token', 'synthetic_host_secret'],
    ['@corlex:unknown', 'x'],
  ])
  expect(JSON.parse(json)).toEqual({ corlex_aid: 'a_1' })
  const second = protectedStorage(bridge)
  expect(await second.multiGet(['@corlex:corlex_aid', '@app:token'])).toEqual([
    ['@corlex:corlex_aid', 'a_1'],
    ['@app:token', null],
  ])
})
it('uses memory only without the own bridge and never touches host storage', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const first = protectedStorage(undefined)
    await first.multiSet([['@corlex:corlex_uid', 'u_1']])
    expect(await first.multiGet(['@corlex:corlex_uid'])).toEqual([['@corlex:corlex_uid', 'u_1']])
    expect(await protectedStorage(undefined).multiGet(['@corlex:corlex_uid'])).toEqual([
      ['@corlex:corlex_uid', null],
    ])
    expect(warning.mock.calls[0]).toEqual(['[corlex] persistence_memory_only'])
  } finally {
    warning.mockRestore()
  }
})
it('rejects unexpected native state and oversized values without writing them', async () => {
  const bridge = { readSdkState: vi.fn(async () => 'null'), writeSdkState: vi.fn(async () => {}) }
  const store = protectedStorage(bridge)
  expect(await store.multiGet(['@corlex:corlex_aid'])).toEqual([['@corlex:corlex_aid', null]])
  await expect(
    store.multiSet([['@corlex:corlex_queue', 'x'.repeat(2 * 1024 * 1024 + 1)]]),
  ).rejects.toThrow('state_budget_exceeded')
  expect(bridge.writeSdkState).not.toHaveBeenCalled()
})

import { AsyncKeyValueStore } from '../storage'
it('commits consent and queued removals together in one atomic native snapshot', async () => {
  let json = JSON.stringify({ corlex_consent: 'granted', corlex_queue: '[]', corlex_aid: 'a_1' })
  const bridge = {
    readSdkState: vi.fn(async () => json),
    writeSdkState: vi.fn(async (text: string) => {
      json = text
    }),
  }
  const store = new AsyncKeyValueStore(protectedStorage(bridge))
  await store.hydrate()
  store.set('corlex_consent', 'denied')
  store.remove('corlex_queue')
  store.remove('corlex_aid')
  await store.flushNow()
  expect(bridge.writeSdkState).toHaveBeenCalledTimes(1)
  expect(JSON.parse(json)).toEqual({ corlex_consent: 'denied' })
})

it('does not resurrect removed rows after a transient native write failure', async () => {
  let json = JSON.stringify({ corlex_consent: 'granted', corlex_queue: '[]', corlex_aid: 'old' })
  const bridge = {
    readSdkState: vi.fn(async () => json),
    writeSdkState: vi.fn(async (text: string) => {
      json = text
    }),
  }
  const adapter = protectedStorage(bridge)
  await adapter.multiGet(['@corlex:corlex_queue'])
  bridge.writeSdkState.mockRejectedValueOnce(new Error('synthetic_disk_failure'))
  await expect(
    adapter.applyChanges?.([
      ['@corlex:corlex_consent', 'denied'],
      ['@corlex:corlex_queue', null],
      ['@corlex:corlex_aid', null],
    ]),
  ).rejects.toThrow()
  await adapter.multiSet([['@corlex:corlex_uid', 'new']])
  expect(JSON.parse(json)).toEqual({ corlex_consent: 'denied', corlex_uid: 'new' })
})

it('recovers a transient read failure without restoring deleted rows or old consent', async () => {
  let json = JSON.stringify({ corlex_consent: 'granted', corlex_queue: '[]', corlex_aid: 'old' })
  const bridge = {
    readSdkState: vi.fn(async () => json),
    writeSdkState: vi.fn(async (text: string) => {
      json = text
    }),
  }
  bridge.readSdkState.mockRejectedValueOnce(new Error('synthetic_read_failure'))
  const adapter = protectedStorage(bridge)
  await expect(adapter.multiGet(['@corlex:corlex_aid'])).rejects.toThrow()
  bridge.readSdkState.mockRejectedValueOnce(new Error('synthetic_read_failure'))
  await expect(
    adapter.applyChanges?.([
      ['@corlex:corlex_consent', 'denied'],
      ['@corlex:corlex_queue', null],
      ['@corlex:corlex_aid', null],
    ]),
  ).rejects.toThrow()
  await adapter.multiSet([['@corlex:corlex_uid', 'new']])
  expect(bridge.readSdkState).toHaveBeenCalledTimes(3)
  expect(JSON.parse(json)).toEqual({ corlex_consent: 'denied', corlex_uid: 'new' })
})
