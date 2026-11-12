import { expect, it, vi } from 'vitest'
import { NativeBindingDriver } from '../binding/driver'
import { newDevice, nativeOf } from './kit'
it('uses cached expected native privacy before any potentially blocked current read', async () => {
  const native = nativeOf(newDevice())
  const driver = new NativeBindingDriver('a'.repeat(64), native, { log: () => {} })
  await driver.prepare('granted')
  const order: string[] = []
  vi.spyOn(native, 'currentSdkPrivacy').mockImplementation(() => {
    order.push('read')
    throw new Error('synthetic native file lock unavailable')
  })
  const actual = native.revokeSdkPrivacy
  vi.spyOn(native, 'revokeSdkPrivacy').mockImplementation((expected, record) => {
    order.push('revoke')
    return actual(expected, record)
  })
  driver.revoke()
  expect(order).toEqual(['revoke'])
})

it('does not reuse newer grant metadata to retry a superseded withdrawal', async () => {
  const device = newDevice(),
    native = nativeOf(device)
  const driver = new NativeBindingDriver('a'.repeat(64), native, { log: () => {} })
  await driver.prepare('granted')
  const newer = JSON.stringify({
    generation: crypto.randomUUID(),
    state: 'granted',
    sdkChoice: 'granted',
  })
  const revoke = vi.spyOn(native, 'revokeSdkPrivacy').mockImplementation(() => {
    device.disk.rows.set('@privacy', newer)
    return newer
  })
  driver.revoke()
  expect(revoke).toHaveBeenCalledTimes(1)
  expect(native.currentSdkPrivacy()).toBe(newer)
  expect(driver.sdkGranted()).toBe(false)
})
it('caches an observed ATT floor before a later explicit SDK refusal', async () => {
  const native = nativeOf(newDevice())
  let ceiling: 'granted' | 'denied' = 'granted'
  const driver = new NativeBindingDriver('a'.repeat(64), native, {
    log: () => {},
    ceiling: () => ceiling,
  })
  await driver.prepare('granted')
  ceiling = 'denied'
  driver.current()
  const known = native.currentSdkPrivacy()
  const revoke = vi.spyOn(native, 'revokeSdkPrivacy')
  driver.revoke()
  expect(revoke.mock.calls[0]?.[0]).toBe(known)
  expect(JSON.parse(native.currentSdkPrivacy()).sdkChoice).toBe('denied')
})
