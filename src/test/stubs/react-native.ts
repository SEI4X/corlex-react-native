// A stand-in for `react-native` in unit tests (see vitest.config.ts).
export const AppState = {
  currentState: 'active',
  addEventListener: (): { remove(): void } => ({ remove() {} }),
}

export const Platform = { OS: 'ios', Version: '18.3' }
