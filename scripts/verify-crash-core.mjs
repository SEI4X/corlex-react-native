import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const core = fileURLToPath(new URL('../ios/CorlexCrashCore/', import.meta.url))
const manifest = JSON.parse(await readFile(join(core, 'manifest.json'), 'utf8'))
const expected = [
  'CorlexRNCrash.c',
  'CorlexRNImages.c',
  'CorlexRNStack.c',
  'CorlexRNOutput.c',
  'CorlexRNInternal.h',
  'include/CorlexRNCrash.h',
].sort()
if (
  manifest.version !== 1 ||
  manifest.license !== 'MIT' ||
  manifest.namespace !== 'corlex_rn_' ||
  JSON.stringify(manifest.files.map((row) => row.target).sort()) !== JSON.stringify(expected)
) {
  throw new Error('Unexpected RN crash core manifest')
}
const actual = (await readdir(core, { recursive: true }))
  .filter((file) => file !== 'include' && file !== 'manifest.json')
  .sort()
if (JSON.stringify(actual) !== JSON.stringify(expected))
  throw new Error('Unexpected RN crash core files')
for (const row of manifest.files) {
  const source = await readFile(join(core, row.target))
  const hash = createHash('sha256').update(source).digest('hex')
  if (row.vendoredSha256 !== hash || !/^[a-f0-9]{64}$/.test(row.sourceSha256))
    throw new Error(`RN crash core checksum mismatch: ${row.target}`)
}
console.log('Vendored MIT native crash core checksums passed')
