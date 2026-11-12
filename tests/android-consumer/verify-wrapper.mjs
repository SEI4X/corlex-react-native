import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Official https://gradle.org/release-checksums/: Expo 58's template embeds the
// Gradle 9.3.1 wrapper JAR and selects the Gradle 9.4.1 binary distribution.
export const wrapperSha256 = 'b3a875ddc1f044746e1b1a55f645584505f4a10438c1afea9f15e92a7c42ec13'
export const distributionSha256 = '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb'

export function verifyWrapper(directory) {
  const wrapper = join(directory, 'gradle/wrapper')
  const digest = createHash('sha256')
    .update(readFileSync(join(wrapper, 'gradle-wrapper.jar')))
    .digest('hex')
  if (digest !== wrapperSha256) throw new Error('Unreviewed Gradle wrapper JAR')
  const properties = join(wrapper, 'gradle-wrapper.properties')
  const text = readFileSync(properties, 'utf8')
  const lines = text.trim().split(/\r?\n/)
  if (
    !lines.includes(
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip',
    )
  ) {
    throw new Error('Unreviewed Gradle distribution URL')
  }
  const checksums = lines.filter((line) => line.startsWith('distributionSha256Sum='))
  if (
    checksums.length > 1 ||
    (checksums.length === 1 && checksums[0] !== `distributionSha256Sum=${distributionSha256}`)
  ) {
    throw new Error('Unreviewed Gradle distribution checksum')
  }
  if (checksums.length === 0)
    writeFileSync(properties, `${text.trim()}\ndistributionSha256Sum=${distributionSha256}\n`)
}
