import { expect, it, vi } from 'vitest'
import { BindingController } from './controller'
import { memoryStores } from './stores'
import type { BoundScope, PrivacyRead } from './types'
it('installs a refusal without a fresh driver read before invalidation and revoke', () => {
  const privacy: PrivacyRead = { kind: 'valid', generation: 'g1', state: 'granted' }
  const scope: BoundScope = {
    owner: 'a',
    generation: 'g1',
    privacy,
    persistent: true,
    stores: memoryStores(),
  }
  const order: string[] = []
  const revoke = vi.fn(() => {
    order.push('revoke')
  })
  const controller = new BindingController({
    owner: 'a',
    scope,
    requested: 'granted',
    driver: {
      current: () => {
        order.push('read')
        throw new Error('synthetic native lock unavailable')
      },
      fresh: () => privacy,
      grant: () => scope,
      revoke,
    },
    onInvalidate: () => {
      order.push('invalidate')
    },
  })
  controller.revoke()
  expect(order).toEqual(['invalidate', 'revoke'])
  expect(revoke).toHaveBeenCalledWith({ expected: privacy })
})
