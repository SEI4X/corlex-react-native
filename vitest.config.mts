import { join } from 'node:path'
import { defineConfig } from 'vitest/config'
const stub = (name: string) => join(import.meta.dirname, 'src/test/stubs/' + name + '.ts')
export default defineConfig({ test: { projects: [
  { extends: true, resolve: { alias: { 'react-native': stub('react-native'), '@react-native-async-storage/async-storage': stub('async-storage') } }, test: { name: 'rn', environment: 'node', globals: true, include: ['src/**/*.test.ts'] } },
  { extends: true, test: { name: 'core', environment: 'node', globals: true, include: ['internal/**/*.test.ts'] } },
] } })
