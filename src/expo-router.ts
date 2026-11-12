import { useSegments } from 'expo-router'
import { useEffect } from 'react'
import { patternFromSegments } from './screens'
import { corlex } from './singleton'

/**
 * `screen_view` for Expo Router. Call it once in the root layout. The screen is the route
 * PATTERN from `useSegments()` (`/user/[id]`), not `usePathname()` (`/user/8731`): the values of
 * route params never leave the device.
 */
export function useScreenTracking(): void {
  const pattern = patternFromSegments(useSegments())
  useEffect(() => {
    corlex.screen(pattern, 'expo-router')
  }, [pattern])
}

/** The same as a component, to drop into the root layout: `<CorlexScreens />`. */
export function CorlexScreens(): null {
  useScreenTracking()
  return null
}
