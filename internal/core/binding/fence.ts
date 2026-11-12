import type { ConsentState } from '../types'
import type { BoundScope, PrivacyRead } from './types'

export function initialConsent(input: {
  privacy: PrivacyRead
  choice?: ConsentState | undefined
  requested: ConsentState
}): ConsentState {
  if (input.privacy.kind === 'unavailable') return 'pending'
  if (input.requested === 'denied') return 'denied'
  if (input.privacy.kind === 'missing') return input.requested
  if (input.privacy.state !== 'granted') return input.privacy.state
  return input.choice ?? input.requested
}

export function samePrivacy(left: PrivacyRead, right: PrivacyRead): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind !== 'valid') return true
  return (
    right.kind === 'valid' && left.generation === right.generation && left.state === right.state
  )
}

export function usableScope(scope: BoundScope, owner: string): boolean {
  return (
    scope.owner === owner &&
    scope.generation.length > 0 &&
    (scope.privacy.kind !== 'valid' || scope.privacy.generation === scope.generation)
  )
}

export const interrupted = () => new Error('SDK request interrupted')
