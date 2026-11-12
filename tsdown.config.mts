import { URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

// Peer dependencies stay external; `#core` and `owned pure RC` (devDependencies) are
// bundled in, so the package has no private dependency.
const banner =
  '/*!\n' + readFileSync(new URL('./THIRD_PARTY_NOTICES', import.meta.url), 'utf8') + '\n*/'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/expo-router.ts', 'src/react-navigation.ts'],
    banner,
    format: 'esm',
    platform: 'neutral', deps: { alwaysBundle: [/^@noble\/hashes(?:\/|$)/] },
    target: 'es2022',
    dts: { eager: true },
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  // The Expo config plugin runs in Node when `expo prebuild` reads the app config: CommonJS.
  {
    entry: ['src/plugin.ts'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    dts: false,
    clean: false,
    outputOptions: { exports: 'named' },
  },
])
