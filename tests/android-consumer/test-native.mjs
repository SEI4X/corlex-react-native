import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyWrapper } from './verify-wrapper.mjs'
import { proveWrapperGuards } from './prove-wrapper.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sdk = resolve(here, '../..')
if (JSON.parse(readFileSync(join(here, 'package.json'))).name !== 'corlex-native-android-proof')
  throw new Error('Unexpected fixture')
const env = { ...process.env, CI: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' }
function run(command, args, cwd = here) {
  execFileSync(command, args, { cwd, env, stdio: 'inherit', timeout: 600000 })
}
run('npm', ['audit', '--audit-level=low'])
run(join(here, 'node_modules/.bin/expo'), [
  'prebuild',
  '--clean',
  '--platform',
  'android',
  '--no-install',
])
const android = join(here, 'android')
verifyWrapper(android)
proveWrapperGuards(android)
run(
  join(android, 'gradlew'),
  [
    ':corlex-sdk-react-native:testDebugUnitTest',
    '--no-daemon',
    '--max-workers=2',
    '-Dorg.gradle.parallel=false',
    '-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=1g',
  ],
  android,
)
for (const name of [
  'CorlexBoundStateTest',
  'CorlexCrashReporterTest',
  'CorlexProcessPrivacyTest',
]) {
  const report = readFileSync(
    join(sdk, 'android/build/test-results/testDebugUnitTest', `TEST-ru.corlex.crash.${name}.xml`),
    'utf8',
  )
  for (const field of ['failures', 'errors', 'skipped']) {
    if (!new RegExp(`${field}="0"`).test(report))
      throw new Error(`${name}: incomplete native proof`)
  }
  if (!/tests="[1-9][0-9]*"/.test(report)) throw new Error(`${name}: no native cases executed`)
}
console.log(
  'Standalone Expo Android module compiled; real state and scoped-reporter cases passed without skips',
)
