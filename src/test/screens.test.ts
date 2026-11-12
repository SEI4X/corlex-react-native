import { describe, expect, it, vi } from 'vitest'
import {
  patternFromSegments,
  safeScreenName,
  ScreenTracker,
  screenFromNavigationState,
} from '../screens'

describe('patternFromSegments (Expo Router)', () => {
  it.each([
    [[], '/'],
    [['index'], '/index'],
    [['(tabs)', 'explore'], '/explore'],
    [['(auth)', '(onboarding)', 'welcome'], '/welcome'],
    [['user', '[id]'], '/user/[id]'],
    [['blog', '[...slug]'], '/blog/[...slug]'],
  ])('%j -> %s', (segments, expected) => {
    expect(patternFromSegments(segments)).toBe(expected)
  })
})

describe('safeScreenName', () => {
  it('cuts the query and the fragment', () => {
    expect(safeScreenName('/search?q=my+secret#top')).toBe('/search')
  })

  it('replaces ids with [id] but keeps patterns and short numbers', () => {
    expect(safeScreenName('/orders/84731299/items')).toBe('/orders/[id]/items')
    expect(safeScreenName('/u/550e8400-e29b-41d4-a716-446655440000')).toBe('/u/[id]')
    expect(safeScreenName('/user/[id]')).toBe('/user/[id]')
    expect(safeScreenName('/page/2')).toBe('/page/2')
    expect(safeScreenName('Settings/Profile')).toBe('Settings/Profile')
  })

  it('limits the length', () => {
    expect(safeScreenName('/'.padEnd(500, 'z')).length).toBe(200)
  })
})

describe('screenFromNavigationState (React Navigation)', () => {
  it('joins the focused route names from the root to the leaf and ignores params', () => {
    const state = {
      index: 1,
      routes: [
        { name: 'Login' },
        {
          name: 'Tabs',
          params: { token: 'secret' },
          state: {
            index: 0,
            routes: [{ name: 'Profile', state: { routes: [{ name: 'Edit' }] } }, { name: 'Feed' }],
          },
        },
      ],
    }
    expect(screenFromNavigationState(state)).toBe('Tabs/Profile/Edit')
  })

  it('uses the last route when there is no index, and nothing for an empty state', () => {
    expect(screenFromNavigationState({ routes: [{ name: 'A' }, { name: 'B' }] })).toBe('B')
    expect(screenFromNavigationState({ routes: [] })).toBeUndefined()
    expect(screenFromNavigationState(undefined)).toBeUndefined()
  })
})

describe('ScreenTracker', () => {
  it('emits on change only and remembers the previous screen', () => {
    const emit = vi.fn()
    const tracker = new ScreenTracker(emit)
    tracker.view('Home', 'react-navigation')
    tracker.view('Home', 'react-navigation')
    tracker.view('Details', 'react-navigation')
    expect(emit.mock.calls).toEqual([
      [{ screen: 'Home', source: 'react-navigation' }],
      [{ screen: 'Details', source: 'react-navigation', previous_screen: 'Home' }],
    ])
  })

  it('forget() makes the next screen a first view again', () => {
    const emit = vi.fn()
    const tracker = new ScreenTracker(emit)
    tracker.view('Home', 'manual')
    tracker.forget()
    tracker.view('Home', 'manual')
    expect(emit).toHaveBeenCalledTimes(2)
  })
})
