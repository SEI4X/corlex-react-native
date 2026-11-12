import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { reactNativeRelease, uploadSourceMap } from './upload-sourcemaps.mjs'

const token = `corlex_up_${'A'.repeat(43)}`
const project = '12345678-1234-4234-8234-123456789abc'
const map = {
  version: 3,
  sources: ['src/app.ts'],
  names: [],
  mappings: 'AAAA',
  sourcesContent: ['PRIVATE SOURCE'],
  extra: { sourcesContent: ['NESTED PRIVATE'] },
}
async function fixture(run) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'corlex-map-'))
  const mapPath = join(directory, 'app.js.map')
  await writeFile(mapPath, JSON.stringify(map))
  try {
    await run({ directory, mapPath })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
async function listen(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      }),
  }
}
const env = (url) => ({
  CORLEX_API_URL: url,
  CORLEX_PROJECT_ID: project,
  CORLEX_UPLOAD_TOKEN: token,
  NODE_ENV: 'test',
})

test('sends only map positions before network; strips source content and private bundle path', async () =>
  fixture(async ({ mapPath }) => {
    let received
    const api = await listen(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      assert.equal(request.url, `/api/projects/${project}/sourcemaps`)
      assert.equal(request.headers.authorization, `Bearer ${token}`)
      assert.ok(
        !body.includes('PRIVATE') &&
          !body.includes('sourcesContent') &&
          !body.includes('/private/build'),
      )
      received = JSON.parse(body)
      response.writeHead(201, { 'content-type': 'application/json' }).end('{}')
    })
    try {
      await uploadSourceMap({
        mapPath,
        file: '/private/build/app.123.js?v=1#hash',
        release: '_',
        env: env(api.url),
      })
    } finally {
      await api.close()
    }
    assert.equal(received.file, 'app.123.js')
    assert.equal(received.release, '_')
    assert.deepEqual(JSON.parse(received.sourceMap), {
      version: 3,
      file: 'app.123.js',
      sources: ['src/app.ts'],
      names: [],
      mappings: 'AAAA',
    })
  }))

test('a 307 redirect never sends credentials or map content to a second origin', async () =>
  fixture(async ({ mapPath }) => {
    let foreignRequests = 0
    const foreign = await listen((_req, res) => {
      foreignRequests++
      res.end()
    })
    const api = await listen((_req, res) => res.writeHead(307, { location: foreign.url }).end())
    try {
      await assert.rejects(
        uploadSourceMap({
          mapPath,
          file: 'index.android.bundle',
          release: '2.4.0',
          env: env(api.url),
        }),
        /upload failed/,
      )
    } finally {
      await api.close()
      await foreign.close()
    }
    assert.equal(foreignRequests, 0)
  }))

test('rejects unsafe origins, wrong credential classes, invalid names, symlinks and oversized input before HTTP', async () =>
  fixture(async ({ directory, mapPath }) => {
    let requests = 0
    const api = await listen((_req, res) => {
      requests++
      res.end()
    })
    const base = { mapPath, file: 'app.js', release: '_', env: env(api.url) }
    try {
      for (const url of [
        'http://example.test',
        'https://user:pass@example.test',
        'https://example.test/?secret=1',
        'https://example.test/#secret',
        'https://example.test/path',
      ])
        await assert.rejects(uploadSourceMap({ ...base, env: { ...env(url) } }))
      await assert.rejects(
        uploadSourceMap({ ...base, env: { ...env(api.url), NODE_ENV: 'production' } }),
      )
      await assert.rejects(
        uploadSourceMap({
          ...base,
          env: { ...env(api.url), CORLEX_UPLOAD_TOKEN: 'ck_test_example' },
        }),
      )
      await assert.rejects(uploadSourceMap({ ...base, file: '..' }))
      await assert.rejects(uploadSourceMap({ ...base, release: 'bad/release' }))
      const link = join(directory, 'link.map')
      await symlink(mapPath, link)
      await assert.rejects(uploadSourceMap({ ...base, mapPath: link }))
      await writeFile(mapPath, ' '.repeat(20 * 1024 * 1024 + 1))
      await assert.rejects(uploadSourceMap(base))
      assert.equal(requests, 0)
    } finally {
      await api.close()
    }
  }))

test('indexed/unusable maps are rejected instead of claiming a successful upload', async () =>
  fixture(async ({ mapPath }) => {
    for (const value of [
      { version: 3, sections: [] },
      { ...map, sources: null },
      { ...map, mappings: 1 },
    ]) {
      await writeFile(mapPath, JSON.stringify(value))
      await assert.rejects(
        uploadSourceMap({ mapPath, file: 'app.js', release: '_', env: env('http://127.0.0.1:1') }),
        /source map/,
      )
    }
  }))

test('RN uploader keys match fixed server fixtures and require both native fields', async () => {
  const vectors = JSON.parse(
    await readFile(new URL('./fixtures/source-map-releases.json', import.meta.url), 'utf8'),
  )
  for (const { version, build, expectedRelease } of vectors)
    assert.equal(reactNativeRelease(version, build), expectedRelease)
  assert.throws(() => reactNativeRelease('2.4.0', ''))
  assert.throws(() => reactNativeRelease('', '101'))
})

test('uploader rejects overlong or malformed native identities before network', () => {
  for (const [version, build] of [
    ['a'.repeat(129), '1'],
    ['a'.repeat(125) + '😀', '1'],
    ['1', 'b'.repeat(33)],
    ['1', 'b'.repeat(29) + '😀'],
    ['\uD800', '1'],
    ['1', '\uDFFF'],
  ])
    assert.throws(() => reactNativeRelease(version, build))
})

test('private build roots and source URLs are normalized before upload while retaining map positions', async () =>
  fixture(async ({ mapPath }) => {
    const appRoot = '/Users/PRIVATE_DEVELOPER/work/App'
    const sources = [
      'src/view.ts?session=PRIVATE_PASSWORD#fragment',
      'file:///Users/PRIVATE_DEVELOPER/work/App/src/file.ts',
      'https://user:PRIVATE_PASSWORD@cdn.example.test/src/remote.ts?session=PRIVATE_PASSWORD#f',
      '/Users/OTHER_DEVELOPER/cache/outside.ts',
      '/build/node_modules/pkg/index.js',
      'C:\\Users\\PRIVATE_DEVELOPER\\App\\windows.ts',
      'data:text/javascript;base64,PRIVATE_PASSWORD',
      'webpack:///./src/virtual.ts',
    ]
    await writeFile(mapPath, JSON.stringify({ ...map, sourceRoot: appRoot, sources }))
    let uploaded
    const api = await listen(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      for (const privateText of [
        'PRIVATE_DEVELOPER',
        'OTHER_DEVELOPER',
        'PRIVATE_PASSWORD',
        'sourceRoot',
        'sourcesContent',
        'session=',
      ])
        assert.ok(!body.includes(privateText))
      uploaded = JSON.parse(JSON.parse(body).sourceMap)
      response.writeHead(201).end()
    })
    try {
      await uploadSourceMap({ mapPath, file: 'app.js', release: '_', appRoot, env: env(api.url) })
    } finally {
      await api.close()
    }
    assert.deepEqual(uploaded.sources, [
      'src/view.ts',
      'src/file.ts',
      'remote.ts',
      'outside.ts',
      'node_modules/pkg/index.js',
      'windows.ts',
      'external-source',
      'src/virtual.ts',
    ])
    assert.equal(uploaded.mappings, 'AAAA')
  }))

test('the packaged CLI executes through a pnpm-style symlink and confirms the actual upload', async () =>
  fixture(async ({ directory, mapPath }) => {
    const link = join(directory, 'linked-uploader.mjs')
    await symlink(fileURLToPath(new URL('./upload-sourcemaps.mjs', import.meta.url)), link)
    let requests = 0
    const api = await listen(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const value = JSON.parse(body)
      assert.match(value.release, /^rn_[A-Za-z0-9_-]{43}$/)
      assert.equal(value.file, 'index.android.bundle')
      requests++
      response.writeHead(201).end()
    })
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [link, mapPath, 'index.android.bundle', '--react-native', '2.4.0', '101'],
        { env: env(api.url) },
      )
      assert.match(stdout, /upload confirmed/)
      assert.equal(requests, 1)
    } finally {
      await api.close()
    }
  }))
