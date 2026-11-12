import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'darwin')(
  'native state files and process refusal enforce scoped privacy',
  () => {
    const output = execFileSync(
      'sh',
      [resolve(import.meta.dirname, '../../tests/native-state/test-state.sh')],
      {
        encoding: 'utf8',
        timeout: 60000,
      },
    )
    expect(output).toContain('host isolation passed')
    expect(output).toContain('cleanup-before-explicit-grant passed')
  },
  65000,
)
