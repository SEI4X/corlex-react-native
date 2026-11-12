import { screenFromNavigationState } from './screens'
import type { NavigationStateLike } from './screens'
import { corlex } from './singleton'

export type { NavigationStateLike }

/** The part of a navigation ref this helper reads. */
export interface NavigationRefLike {
  getRootState(): NavigationStateLike | undefined
}

/**
 * `screen_view` for React Navigation:
 *
 *     const navigation = createNavigationTracking(navigationRef)
 *     <NavigationContainer ref={navigationRef} onReady={navigation.onReady}
 *       onStateChange={navigation.onStateChange}>
 *
 * The screen is the chain of route names (`Tabs/Profile`); route params are never read.
 */
export function createNavigationTracking(ref?: NavigationRefLike) {
  const report = (state: NavigationStateLike | undefined): void => {
    const name = screenFromNavigationState(state)
    if (name !== undefined) corlex.screen(name, 'react-navigation')
  }
  return {
    onReady: (): void => report(ref?.getRootState()),
    onStateChange: (state?: NavigationStateLike): void => report(state ?? ref?.getRootState()),
  }
}
