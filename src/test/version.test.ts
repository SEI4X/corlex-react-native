import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SDK_VERSION } from '../version'

it('SDK_VERSION equals the version in package.json', () => {
  const file = join(import.meta.dirname, '../../package.json')
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version: string }
  expect(SDK_VERSION).toBe(pkg.version)
})
