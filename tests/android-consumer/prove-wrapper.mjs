import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyWrapper } from './verify-wrapper.mjs'

export function proveWrapperGuards(android) {
  const temporary = mkdtempSync(join(tmpdir(), 'corlex-wrapper-negative-'))
  try {
    const wrapper = join(temporary, 'gradle/wrapper')
    const source = join(android, 'gradle/wrapper')
    const jar = join(wrapper, 'gradle-wrapper.jar')
    const properties = join(wrapper, 'gradle-wrapper.properties')
    cpSync(source, wrapper, { recursive: true })
    const originalJar = readFileSync(jar)
    const alteredJar = Buffer.from(originalJar)
    alteredJar[0] ^= 1
    writeFileSync(jar, alteredJar)
    assert.throws(() => verifyWrapper(temporary), /Unreviewed Gradle wrapper JAR/)
    writeFileSync(jar, originalJar)
    const originalProperties = readFileSync(properties, 'utf8')
    writeFileSync(properties, originalProperties.replace('services.gradle.org', 'attacker.invalid'))
    assert.throws(() => verifyWrapper(temporary), /Unreviewed Gradle distribution URL/)
    writeFileSync(
      properties,
      originalProperties.replace(
        /distributionSha256Sum=[a-f0-9]+/,
        `distributionSha256Sum=${'0'.repeat(64)}`,
      ),
    )
    assert.throws(() => verifyWrapper(temporary), /Unreviewed Gradle distribution checksum/)
    writeFileSync(properties, originalProperties)
    verifyWrapper(temporary)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  console.log('Gradle guard rejected tampered wrapper JAR, distribution URL and checksum')
}
