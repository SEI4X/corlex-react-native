import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { expect, it } from 'vitest'

type Collector = (
  ast: unknown,
  options: Record<string, unknown>,
) => { dependencies: { name: string; data: { isOptional?: boolean } }[] }
const own = createRequire(import.meta.url)
const expo = createRequire(own.resolve('expo/package.json'))
const config = createRequire(expo.resolve('@expo/metro-config/package.json'))
const metro = createRequire(config.resolve('metro/package.json'))
const parser = metro('@babel/parser') as {
  parse(source: string, options: { sourceType: string }): unknown
}
const collectors = [
  ['Metro', metro('./src/ModuleGraph/worker/collectDependencies.js').default as Collector],
  ['Expo', config('./build/transform-worker/collect-dependencies.js').default as Collector],
] as const

for (const [name, collect] of collectors) {
  it(`${name} preserves missing optional peers in the real SDK adapter`, () => {
    const source = readFileSync(new URL('../optional.ts', import.meta.url), 'utf8')
    const javascript = transpileModule(source, {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
    }).outputText
    const result = collect(parser.parse(javascript, { sourceType: 'module' }), {
      allowOptionalDependencies: true,
      asyncRequireModulePath: 'metro-runtime/src/modules/asyncRequire',
      dynamicRequires: 'reject',
      keepRequireNames: true,
      inlineableCalls: [],
    })
    for (const dependency of [
      'expo-application',
      'expo-device',
      'expo-modules-core',
      '@react-native-community/netinfo',
      'expo/fetch',
      'expo/package.json',
    ]) {
      expect(
        result.dependencies.find((entry) => entry.name === dependency)?.data.isOptional,
        `${dependency} must not break a bundle when absent`,
      ).toBe(true)
    }
  })
}
