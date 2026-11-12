#!/usr/bin/env node
// MIT. Build/CI only: never import this file into browser or mobile application code.
import { createHash } from 'node:crypto'
import { constants, realpathSync } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_BYTES = 20 * 1024 * 1024
const SAFE_PART = /^(?!\.+$)[A-Za-z0-9._@+-]{1,200}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Build-only key; native dSYM/R8 tooling continues using its separate version/build fields. */
export function reactNativeRelease(version, build) {
  const valid = (value, limit) =>
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= limit &&
    !/[\uD800-\uDFFF]/u.test(value)
  if (!valid(version, 128) || !valid(build, 32))
    throw new Error(
      'React Native maps require exact native version (128 UTF-8 bytes) and build (32 UTF-8 bytes).',
    )
  return `rn_${createHash('sha256')
    .update(JSON.stringify([version, build]))
    .digest('base64url')}`
}

function destination(env) {
  const url = new URL(env.CORLEX_API_URL ?? '')
  const local =
    ['localhost', '[::1]'].includes(url.hostname) || /^127\.\d+\.\d+\.\d+$/.test(url.hostname)
  const development = env.NODE_ENV !== 'production' && local && url.protocol === 'http:'
  if (
    (url.protocol !== 'https:' && !development) ||
    (env.NODE_ENV === 'production' && local) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Corlex requires a public HTTPS origin (HTTP loopback only for development).')
  if (!UUID.test(env.CORLEX_PROJECT_ID ?? '')) throw new Error('Corlex project ID is invalid.')
  if (!/^corlex_up_[0-9A-Za-z]{43}$/.test(env.CORLEX_UPLOAD_TOKEN ?? ''))
    throw new Error('Corlex requires a build-only symbol upload token.')
  url.pathname = `/api/projects/${env.CORLEX_PROJECT_ID}/sourcemaps`
  return url
}

async function readMap(path) {
  const absolute = resolve(path)
  if ((await realpath(dirname(absolute))) !== dirname(absolute))
    throw new Error('Corlex source map paths must not contain symlinks.')
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error('Corlex source map exceeds the file size limit.')
    // A bounded buffer also handles a file that grows between stat() and read().
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== stat.size) throw new Error('Corlex source map changed while reading.')
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally {
    await handle.close()
  }
}

function sourceLocation(value) {
  let clean = [...value.trim()]
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('')
    .replaceAll('\\', '/')
    .replace(/[?#].*$/, '')
  if (/^[A-Za-z]:\//.test(clean)) return `/${clean}`
  if (!/^[a-z][a-z0-9+.-]*:/i.test(clean)) return clean
  try {
    const virtual = /^webpack(?:-internal)?:\/\/[^/]*\/\.\//i.exec(clean)
    if (virtual) return decodeURIComponent(clean.slice(virtual[0].length)).replace(/[?#].*$/, '')
    const url = new URL(clean)
    clean = decodeURIComponent(url.pathname)
      .trim()
      .replace(/[?#].*$/, '')
    if (url.protocol === 'http:' || url.protocol === 'https:')
      return posix.basename(clean) || 'external-source'
    if (url.protocol === 'file:') return clean
    if (/^webpack(?:-internal)?:$/.test(url.protocol))
      return clean.startsWith('/./') ? clean.slice(3) : clean
  } catch {
    /* Unknown source schemes never become uploaded code or credentials. */
  }
  return 'external-source'
}

/** Resolve build paths on the build host; upload project-relative names, never a home directory. */
function sourceNames(map, appRoot) {
  const root = posix.resolve(sourceLocation(appRoot))
  const base = posix.resolve(root, sourceLocation(map.sourceRoot ?? ''))
  return map.sources.map((source) => {
    const clean = sourceLocation(source)
    const absolute = posix.resolve(
      /^webpack(?:-internal)?:/i.test(source.trim()) ? root : base,
      clean,
    )
    const path = posix.relative(root, absolute)
    if (path && path !== '..' && !path.startsWith('../') && !posix.isAbsolute(path)) return path
    const module = absolute.split('/node_modules/').at(-1)
    if (absolute.includes('/node_modules/') && module) return `node_modules/${module}`
    const name = posix.basename(absolute)
    return name && name !== '.' && name !== '..' ? name : 'unknown-source'
  })
}

function payload(map, { file, release, appRoot }) {
  const name = file
    .replace(/[?#].*$/, '')
    .split(/[/\\]/)
    .at(-1)
  if (!SAFE_PART.test(name ?? '') || !SAFE_PART.test(release) || release.length > 64)
    throw new Error('Corlex bundle filename or release is invalid.')
  const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
  if (
    map?.version !== 3 ||
    !strings(map.sources) ||
    !strings(map.names) ||
    typeof map.mappings !== 'string' ||
    map.sections !== undefined
  )
    throw new Error('Corlex requires a final, flat version 3 source map.')
  // Whitelist lookup fields. Embedded sources and extension fields never leave the build host.
  const clean = {
    version: 3,
    file: name,
    sources: sourceNames(map, appRoot),
    names: map.names,
    mappings: map.mappings,
  }
  const body = JSON.stringify({ release, file: name, sourceMap: JSON.stringify(clean) })
  if (Buffer.byteLength(body) > MAX_BYTES)
    throw new Error('Corlex source map exceeds the upload size limit.')
  return body
}

/** Environment comes from scripts/with-symbols.sh or CI secrets, never application config. */
export async function uploadSourceMap({
  mapPath,
  file,
  release,
  env = process.env,
  appRoot = process.cwd(),
}) {
  const url = destination(env)
  const body = payload(await readMap(mapPath), { file, release, appRoot })
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${env.CORLEX_UPLOAD_TOKEN}`,
        'content-type': 'application/json',
      },
      body,
    })
    // No response bodies are logged or buffered: they can contain untrusted server data.
    await response.body?.cancel()
    if (response.status !== 201) throw new Error('Corlex source-map upload failed.')
  } catch {
    throw new Error(
      'Corlex source-map upload failed. Check the build-only configuration and service availability.',
    )
  }
}

function isCli() {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

function requestedRelease(mode) {
  if (mode.length === 1) return mode[0]
  if (mode.length !== 3 || mode[0] !== '--react-native') return undefined
  try {
    return reactNativeRelease(mode[1], mode[2])
  } catch {
    return undefined
  }
}

if (isCli()) {
  const [mapPath, file, ...mode] = process.argv.slice(2)
  const release = requestedRelease(mode)
  if (!mapPath || !file || !release) {
    console.error(
      'Usage: upload-sourcemaps.mjs <final.map> <bundle filename or URL> <web-release|--react-native native-version native-build>; unversioned web: _',
    )
    process.exitCode = 64
  } else {
    uploadSourceMap({ mapPath, file, release }).then(
      () => console.log('Corlex: source-map upload confirmed.'),
      () => {
        console.error(
          'Corlex: source-map upload failed; check build-only configuration, map format and service.',
        )
        process.exitCode = 1
      },
    )
  }
}
