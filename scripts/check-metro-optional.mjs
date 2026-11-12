import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const own = createRequire(new URL('../package.json', import.meta.url))
const expo = createRequire(own.resolve('expo/package.json'))
const config = createRequire(expo.resolve('@expo/metro-config/package.json'))
const metro = createRequire(config.resolve('metro/package.json'))
const parse = metro('@babel/parser').parse
const collectors = [
  metro('./src/ModuleGraph/worker/collectDependencies.js').default,
  config('./build/transform-worker/collect-dependencies.js').default,
]
const optional = [
  'expo-application',
  'expo-device',
  'expo-modules-core',
  '@react-native-community/netinfo',
  'expo/fetch',
  'expo/package.json',
]
const dist = new URL('../dist/', import.meta.url)
for (const collect of collectors) {
  const found = new Map()
  for (const file of readdirSync(dist).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, dist), 'utf8')
    const result = collect(parse(source, { sourceType: 'module' }), {
      allowOptionalDependencies: true,
      asyncRequireModulePath: 'metro-runtime/src/modules/asyncRequire',
      dynamicRequires: 'reject',
      keepRequireNames: true,
      inlineableCalls: [],
    })
    for (const dependency of result.dependencies.filter((entry) => optional.includes(entry.name))) {
      assert.equal(dependency.data.isOptional, true, dependency.name)
      found.set(dependency.name, true)
    }
  }
  for (const name of optional) assert.equal(found.get(name), true, name)
}
console.log('Metro and Expo retain all optional native imports in the built SDK')
