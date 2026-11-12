import { describe, expect, it, vi } from 'vitest'
import { AsyncKeyValueStore } from '../storage'
import { FakeDisk } from './kit'

describe('AsyncKeyValueStore', () => {
  it('hydrates the SDK keys and nothing else', async () => {
    const disk = new FakeDisk()
    disk.rows.set('@corlex:corlex_aid', 'a_1')
    disk.rows.set('@corlex:other', 'x')
    disk.rows.set('@app:token', 'secret')
    const store = new AsyncKeyValueStore(disk)
    await store.hydrate()
    expect(store.get('corlex_aid')).toBe('a_1')
    expect(store.get('other')).toBeNull()
    expect(store.get('token')).toBeNull()
  })

  it('reads its own writes at once and writes to disk in the background, namespaced', async () => {
    const disk = new FakeDisk()
    const store = new AsyncKeyValueStore(disk)
    store.set('corlex_queue', '[1]')
    expect(store.get('corlex_queue')).toBe('[1]')
    expect(disk.rows.size).toBe(0)
    await store.flushNow()
    expect(disk.rows.get('@corlex:corlex_queue')).toBe('[1]')
  })

  it('coalesces a burst of writes into one disk write of the last value', async () => {
    const disk = new FakeDisk()
    const multiSet = vi.spyOn(disk, 'multiSet')
    const store = new AsyncKeyValueStore(disk)
    for (let i = 0; i < 50; i += 1) store.set('corlex_queue', String(i))
    await store.flushNow()
    expect(multiSet).toHaveBeenCalledTimes(1)
    expect(disk.rows.get('@corlex:corlex_queue')).toBe('49')
  })

  it('removes from memory and from disk', async () => {
    const disk = new FakeDisk()
    disk.rows.set('@corlex:corlex_uid', 'u')
    const store = new AsyncKeyValueStore(disk)
    await store.hydrate()
    store.remove('corlex_uid')
    expect(store.get('corlex_uid')).toBeNull()
    await store.flushNow()
    expect(disk.rows.has('@corlex:corlex_uid')).toBe(false)
  })

  it('a value written while hydrating is newer than the disk', async () => {
    const disk = new FakeDisk()
    disk.rows.set('@corlex:corlex_aid', 'old')
    const store = new AsyncKeyValueStore(disk)
    const loading = store.hydrate()
    store.set('corlex_aid', 'new')
    await loading
    expect(store.get('corlex_aid')).toBe('new')
  })

  it('survives a failing disk: memory keeps working and the error is reported once per write', async () => {
    const disk = new FakeDisk()
    vi.spyOn(disk, 'multiSet').mockRejectedValue(new Error('disk full'))
    const onError = vi.fn()
    const store = new AsyncKeyValueStore(disk, onError)
    store.set('corlex_queue', '[2]')
    await store.flushNow()
    expect(store.get('corlex_queue')).toBe('[2]')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('keeps a value that is too big for the disk in memory only', async () => {
    const disk = new FakeDisk()
    const store = new AsyncKeyValueStore(disk)
    expect(store.set('corlex_queue', 'x'.repeat(2 * 1024 * 1024 + 1))).toBe(false)
    await store.flushNow()
    expect(store.get('corlex_queue')).toHaveLength(2 * 1024 * 1024 + 1)
    expect(disk.rows.size).toBe(0)
  })
})
