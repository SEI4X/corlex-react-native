/**
 * Screens are named by route PATTERN, never by what the person opened: `/user/[id]`, not
 * `/user/8731`. Route parameters often hold ids, emails and search text, so their values never
 * leave the device.
 */

const GROUP = /^\(.*\)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Long digit or hex runs are ids; short numbers (`/page/2` is still a pattern someone wrote). */
const LOOKS_LIKE_ID = /^(\d{4,}|[0-9a-f]{16,})$/i
const MAX_SCREEN = 200

/** Expo Router segments (`useSegments()`): groups like `(tabs)` are not part of the URL. */
export function patternFromSegments(segments: readonly string[]): string {
  const parts = segments.filter((s) => s !== '' && !GROUP.test(s))
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

/**
 * Makes any screen name safe: the query string and fragment are cut off, and a segment that looks
 * like an id becomes `[id]`. A name that is not a path (`Home`, `Settings/Profile`) passes as it is.
 */
export function safeScreenName(name: string): string {
  const bare = (name.split(/[?#]/)[0] ?? '').trim()
  const cleaned = bare
    .split('/')
    .map((part) => (UUID.test(part) || LOOKS_LIKE_ID.test(part) ? '[id]' : part))
    .join('/')
  return cleaned.slice(0, MAX_SCREEN)
}

/** A navigation state of React Navigation, as far as this SDK reads it. */
export interface NavigationStateLike {
  index?: number | undefined
  routes: readonly { name: string; state?: NavigationStateLike | undefined }[]
}

/**
 * The focused screen of a React Navigation state: the route names from the root to the leaf
 * joined with `/` (`Tabs/Profile/Edit`). Names are what the developer wrote in the navigator,
 * route params are not read at all.
 */
export function screenFromNavigationState(
  state: NavigationStateLike | undefined,
): string | undefined {
  const names: string[] = []
  let current = state
  while (current !== undefined && current.routes.length > 0) {
    const route = current.routes[current.index ?? current.routes.length - 1]
    if (route === undefined) break
    names.push(route.name)
    current = route.state
  }
  return names.length === 0 ? undefined : names.join('/')
}

export type ScreenSource = 'expo-router' | 'react-navigation' | 'manual'

/** Sends `screen_view` when the screen changes; the same screen reported twice counts once. */
export class ScreenTracker {
  private current: string | undefined

  constructor(private readonly emit: (properties: Record<string, string>) => void) {}

  view(name: string, source: ScreenSource): void {
    const screen = safeScreenName(name)
    if (screen === '' || screen === this.current) return
    const properties: Record<string, string> = { screen, source }
    if (this.current !== undefined) properties['previous_screen'] = this.current
    this.current = screen
    this.emit(properties)
  }

  /** A new launch or `reset()`: the next screen is a first view again. */
  forget(): void {
    this.current = undefined
  }
}
