import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'darwin')(
  'native reporters enforce immutable scoped tuples and default privacy',
  () => {
    expect(
      execFileSync('sh', [resolve(import.meta.dirname, '../../tests/native-scope/test-scope.sh')], {
        encoding: 'utf8',
        timeout: 60000,
      }),
    ).toContain('withdrawal, rearm, native default privacy passed')
  },
  65000,
)
