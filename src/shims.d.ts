// The parts of React Native and the Expo modules this SDK touches, typed by hand. The real
// packages are peer dependencies of the app, not of this repository: keeping the monorepo free of
// react-native keeps its install small and its audit clean, and the unit tests mock these modules.

declare module 'react-native' {
  export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension'
  export const AppState: {
    currentState: AppStateStatus
    addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void }
  }
  export const Platform: { OS: string; Version: string | number }
}

declare module '@react-native-async-storage/async-storage' {
  interface AsyncStorageStatic {
    multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>
    multiSet(pairs: readonly (readonly [string, string])[]): Promise<void>
    multiRemove(keys: readonly string[]): Promise<void>
  }
  const AsyncStorage: AsyncStorageStatic
  export default AsyncStorage
}

declare module 'expo-modules-core' {
  export function requireOptionalNativeModule<T>(name: string): T | null
}

declare module 'expo-application' {
  export const nativeApplicationVersion: string | null
  export const nativeBuildVersion: string | null
}

declare module 'expo-device' {
  export const modelName: string | null
  export const modelId: string | null
  export const osName: string | null
  export const osVersion: string | null
}

declare module '@react-native-community/netinfo' {
  interface NetInfoState {
    isConnected: boolean | null
    isInternetReachable: boolean | null | undefined
  }
  const NetInfo: {
    addEventListener(listener: (state: NetInfoState) => void): () => void
  }
  export default NetInfo
}

declare module 'expo-router' {
  export function useSegments(): string[]
}

// Metro's `require`, used inside try/catch for the optional peer dependencies (optional.ts).
declare function require(id: string): unknown

// Hermes and React Native globals.
declare const ErrorUtils: ErrorUtilsShape | undefined
interface ErrorUtilsShape {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void
}
