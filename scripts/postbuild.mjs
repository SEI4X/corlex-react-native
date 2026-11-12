// Metro finds optional dependencies by looking for `require('name')` calls with a literal name.
// The bundler rewrites those into its own `__require(...)` helper, which Metro cannot see, so the
// optional modules (expo-application, expo-device, expo-modules-core, NetInfo) would never be
// bundled. This puts the plain `require` back and checks that no helper is left.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dist = new URL('../dist/', import.meta.url)
let patched = 0

for (const name of readdirSync(dist)) {
  if (!name.endsWith('.js')) continue
  const file = fileURLToPath(new URL(name, dist))
  const before = readFileSync(file, 'utf8')
  const after = before
    .replace(/__require\(("[^"]+")\)/g, 'require($1)')
    .replace(/var __require = [\s\S]*?\n\}\);\n/, '')
  if (after.includes('__require')) {
    console.error(`${name}: an __require helper is left after patching`)
    process.exit(1)
  }
  if (after !== before) {
    writeFileSync(file, after)
    patched += 1
  }
}
console.log(`postbuild: restored plain require() in ${patched} file(s)`)
