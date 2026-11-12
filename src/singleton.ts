import { NativeClient } from './client'
import { defaultRuntime } from './runtime'

/** The one instance of the app. The entry points (`index`, `expo-router`, ...) all share it. */
export const corlex = new NativeClient(defaultRuntime)
