import { describe, expect, it, vi } from 'vitest'
import { installGlobalHandler, installRejectionTracker } from '../crash/handlers'
import { FakeErrorUtils, FakeHermes } from './kit'

describe('installGlobalHandler', () => {
  it('reports, then calls the previous handler with the same arguments', () => {
    const utils = new FakeErrorUtils()
    const order: string[] = []
    utils.setGlobalHandler(() => void order.push('previous'))
    installGlobalHandler(utils, () => void order.push('report'))
    utils.throwFatal(new Error('x'), true)
    expect(order).toEqual(['report', 'previous'])
  })

  it('never lets a failing report stop the previous handler', () => {
    const utils = new FakeErrorUtils()
    const previous = vi.fn()
    utils.setGlobalHandler(previous)
    installGlobalHandler(utils, () => {
      throw new Error('sdk bug')
    })
    utils.throwFatal('boom', true)
    expect(previous).toHaveBeenCalledWith('boom', true)
  })

  it('installing again (Fast Refresh) replaces the first wrapper instead of nesting', () => {
    const utils = new FakeErrorUtils()
    const previous = vi.fn()
    utils.setGlobalHandler(previous)
    const first = vi.fn()
    const second = vi.fn()
    installGlobalHandler(utils, first)
    installGlobalHandler(utils, second)
    utils.throwFatal('x', false)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('uninstall puts the previous handler back, unless somebody else wrapped ours', () => {
    const utils = new FakeErrorUtils()
    const previous = vi.fn()
    utils.setGlobalHandler(previous)
    const stop = installGlobalHandler(utils, vi.fn())
    stop()
    expect(utils.getGlobalHandler()).toBe(previous)

    const stopAgain = installGlobalHandler(utils, vi.fn())
    const theirs = vi.fn()
    utils.setGlobalHandler(theirs)
    stopAgain()
    expect(utils.getGlobalHandler()).toBe(theirs)
  })

  it('does nothing where there is no ErrorUtils', () => {
    expect(() => installGlobalHandler(undefined, vi.fn())()).not.toThrow()
  })
})

describe('installRejectionTracker', () => {
  it('reports a rejection and prints the warning React Native would have', () => {
    const hermes = new FakeHermes()
    const report = vi.fn()
    const warn = vi.fn()
    installRejectionTracker(hermes, report, warn)
    const error = new Error('nope')
    hermes.onUnhandled?.(3, error)
    expect(report).toHaveBeenCalledWith(error)
    expect(warn.mock.calls[0]?.[0]).toContain('(id: 3)')
  })

  it('stops reporting after the stop function, but still warns', () => {
    const hermes = new FakeHermes()
    const report = vi.fn()
    const warn = vi.fn()
    const stop = installRejectionTracker(hermes, report, warn)
    stop()
    hermes.onUnhandled?.(1, 'late')
    expect(report).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does nothing on an engine without a tracker', () => {
    expect(() => installRejectionTracker({}, vi.fn())()).not.toThrow()
    expect(() => installRejectionTracker(undefined, vi.fn())()).not.toThrow()
  })
})
