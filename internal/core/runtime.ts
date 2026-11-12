import type { Sender } from './sender'
import type { EventQueue } from './queue'
import type { Identity } from './identity'

export type Log = (...args: unknown[]) => void

export interface Runtime {
  sender: Sender
  queue: EventQueue
  identity: Identity
  log: Log
  /** Removes every listener the platform added. */
  teardown: () => void
}
