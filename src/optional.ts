/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles optional peers only from literal require() calls */
// Metro recognizes optional imports only inside a lexical try block; a loader callback hides it.

import { secureExpoRequest } from './request'

type Application = typeof import('expo-application')
type Device = typeof import('expo-device')
type ExpoCore = typeof import('expo-modules-core')
type NetInfoModule = typeof import('@react-native-community/netinfo')

export function expoApplication(): Application | undefined {
  try {
    return require('expo-application') as Application
  } catch {
    return undefined
  }
}
export function expoDevice(): Device | undefined {
  try {
    return require('expo-device') as Device
  } catch {
    return undefined
  }
}
export function expoCore(): ExpoCore | undefined {
  try {
    return require('expo-modules-core') as ExpoCore
  } catch {
    return undefined
  }
}
export function netInfo(): NetInfoModule['default'] | undefined {
  try {
    return (require('@react-native-community/netinfo') as NetInfoModule).default
  } catch {
    return undefined
  }
}

/** Missing/older Expo must not fall back to React Native's redirect-ignoring Fetch polyfill. */
export const expoRequest = () => {
  try {
    const module: unknown = require('expo/fetch')
    const version = (require('expo/package.json') as { version: unknown }).version
    return secureExpoRequest(module, version)
  } catch {
    return undefined
  }
}
