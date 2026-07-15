import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDistServer, parseServeArgs, validateDistSnapshot } from './serve_phase26_dist.mjs'

const SOURCE_SHA = 'a'.repeat(40)

async function buildIdentityFor(dist) {
  const distRoot = await realpath(dist)
  const names = await import('node:fs/promises').then(({ readdir }) => readdir(distRoot))
  const files = []
  for (const name of names.sort()) {
    const body = await readFile(path.join(distRoot, name))
    files.push({
      path: name,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    })
  }
  const identitySha256 = createHash('sha256').update(JSON.stringify(files)).digest('hex')
  const payload = {
    schema_version: 1,
    source: { git_sha: SOURCE_SHA },
    dist: { root: 'frontend/dist', identity_sha256: identitySha256, files },
  }
  return {
    distRoot,
    manifestPath: '/tmp/phase26-test-build-manifest.json',
    manifest: {
      ...payload,
      manifest_sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    },
  }
}

async function distServer({ dist, apiTarget, expectedBackendSha = SOURCE_SHA }) {
  return createDistServer({
    dist,
    apiTarget,
    expectedBackendSha,
    buildIdentity: await buildIdentityFor(dist),
  })
}

test('CLI accepts only the isolated Task 15 ports and loopback backend', () => {
  const valid = [
    '--dist', 'frontend/dist', '--manifest', 'docs/evidence/build-manifest.json',
    '--port', '15174', '--api-target', 'http://127.0.0.1:18000', '--expected-backend-sha', SOURCE_SHA,
  ]
  assert.deepEqual(parseServeArgs(valid), {
    dist: 'frontend/dist', manifest: 'docs/evidence/build-manifest.json', port: 15174,
    apiTarget: 'http://127.0.0.1:18000', expectedBackendSha: SOURCE_SHA, help: false,
  })
  assert.throws(
    () => parseServeArgs(valid.map((value) => value === '15174' ? '5173' : value)),
    /15174/,
  )
  assert.throws(
    () => parseServeArgs(valid.map((value) => value === 'http://127.0.0.1:18000' ? 'http://127.0.0.1:8000' : value)),
    /18000/,
  )
  assert.throws(
    () => parseServeArgs(valid.map((value) => value === 'http://127.0.0.1:18000' ? 'https://example.invalid' : value)),
    /loopback/,
  )
})

async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  return address
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

async function rawRequest({ port, path: requestTarget }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'GET',
        path: requestTarget,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolve({
          status: response.statusCode,
          body: Buffer.concat(chunks).toString(),
        }))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

test('serves immutable assets and SPA routes from loopback only', async (t) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-dist-test-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  await writeFile(path.join(dist, 'index.html'), '<main>phase26 shell</main>')
  await writeFile(path.join(dist, 'app-deadbeef.js'), 'export const ready = true\n')

  const server = await distServer({ dist, apiTarget: 'http://127.0.0.1:9' })
  const address = await listen(server)
  t.after(() => close(server))
  assert.equal(address.address, '127.0.0.1')

  const base = `http://127.0.0.1:${address.port}`
  const asset = await fetch(`${base}/app-deadbeef.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type') ?? '', /javascript/)
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(asset.headers.get('x-phase26-source-git-sha'), SOURCE_SHA)
  assert.match(asset.headers.get('x-phase26-manifest-sha256') ?? '', /^[0-9a-f]{64}$/)
  assert.match(asset.headers.get('x-phase26-dist-identity') ?? '', /^[0-9a-f]{64}$/)
  assert.equal(asset.headers.get('x-phase26-file-path'), 'app-deadbeef.js')
  assert.match(asset.headers.get('x-phase26-file-sha256') ?? '', /^[0-9a-f]{64}$/)
  assert.match(await asset.text(), /ready = true/)

  const route = await fetch(`${base}/projects/1/sheet`)
  assert.equal(route.status, 200)
  assert.equal(route.headers.get('x-phase26-file-path'), 'index.html')
  assert.match(route.headers.get('content-type') ?? '', /text\/html/)
  assert.match(await route.text(), /phase26 shell/)

  const head = await fetch(`${base}/projects`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})

test('proxies every API method, body, status, and end-to-end header', async (t) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-dist-test-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  await writeFile(path.join(dist, 'index.html'), '<main>shell</main>')

  const upstream = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      response.writeHead(422, {
        'content-type': 'application/json',
        'x-phase26-upstream': 'preserved',
      })
      response.end(
        JSON.stringify({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString() }),
      )
    })
  })
  const upstreamAddress = await listen(upstream)
  t.after(() => close(upstream))

  const proxy = await distServer({
    dist,
    apiTarget: `http://127.0.0.1:${upstreamAddress.port}`,
  })
  const proxyAddress = await listen(proxy)
  t.after(() => close(proxy))

  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/projects/7?mode=qa`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ exact: '001.5000' }),
  })
  assert.equal(response.status, 422)
  assert.equal(response.headers.get('x-phase26-upstream'), 'preserved')
  assert.equal(response.headers.get('x-phase26-backend-git-sha'), SOURCE_SHA)
  assert.match(response.headers.get('x-phase26-manifest-sha256') ?? '', /^[0-9a-f]{64}$/)
  assert.deepEqual(await response.json(), {
    method: 'PATCH',
    url: '/api/projects/7?mode=qa',
    body: '{"exact":"001.5000"}',
  })
})

test('rejects absolute-form API request targets instead of overriding the configured upstream', async (t) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-dist-test-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  await writeFile(path.join(dist, 'index.html'), '<main>shell</main>')

  let configuredHits = 0
  const configured = http.createServer((_request, response) => {
    configuredHits += 1
    response.end('configured')
  })
  const configuredAddress = await listen(configured)
  t.after(() => close(configured))

  let overrideHits = 0
  const override = http.createServer((_request, response) => {
    overrideHits += 1
    response.end('override')
  })
  const overrideAddress = await listen(override)
  t.after(() => close(override))

  const proxy = await distServer({
    dist,
    apiTarget: `http://127.0.0.1:${configuredAddress.port}`,
  })
  const proxyAddress = await listen(proxy)
  t.after(() => close(proxy))

  const result = await rawRequest({
    port: proxyAddress.port,
    path: `http://127.0.0.1:${overrideAddress.port}/api/escape`,
  })
  assert.equal(result.status, 400)
  const backslashResult = await rawRequest({
    port: proxyAddress.port,
    path: `/\\127.0.0.1:${overrideAddress.port}/api/escape`,
  })
  assert.equal(backslashResult.status, 400)
  assert.equal(configuredHits, 0)
  assert.equal(overrideHits, 0)
})

test('returns 404 for missing assets instead of hiding them behind the SPA shell', async (t) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-dist-test-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  await writeFile(path.join(dist, 'index.html'), '<main>shell</main>')

  const server = await distServer({ dist, apiTarget: 'http://127.0.0.1:9' })
  const address = await listen(server)
  t.after(() => close(server))
  const base = `http://127.0.0.1:${address.port}`

  for (const assetPath of ['/assets/missing-deadbeef.js', '/missing.css']) {
    const response = await fetch(`${base}${assetPath}`)
    assert.equal(response.status, 404, assetPath)
    assert.doesNotMatch(await response.text(), /phase26 shell/, assetPath)
  }
})

test('never serves files outside the distribution root', async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-dist-test-'))
  const dist = path.join(parent, 'dist')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(dist))
  t.after(() => rm(parent, { recursive: true, force: true }))
  await writeFile(path.join(dist, 'index.html'), '<main>shell</main>')
  await writeFile(path.join(parent, 'secret.txt'), 'must-not-leak')
  await symlink(path.join(parent, 'secret.txt'), path.join(dist, 'linked-secret.txt'))

  const server = await distServer({ dist, apiTarget: 'http://127.0.0.1:9' })
  const address = await listen(server)
  t.after(() => close(server))

  const response = await fetch(`http://127.0.0.1:${address.port}/..%2Fsecret.txt`)
  assert.notEqual(await response.text(), 'must-not-leak')
  const linked = await fetch(`http://127.0.0.1:${address.port}/linked-secret.txt`)
  assert.notEqual(await linked.text(), 'must-not-leak')
})

test('a query containing /api/ remains a static request', async (t) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-dist-test-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  await writeFile(path.join(dist, 'index.html'), '<main>shell</main>')
  await writeFile(path.join(dist, 'app-deadbeef.js'), 'export const staticAsset = true\n')
  let upstreamHits = 0
  const upstream = http.createServer((_request, response) => {
    upstreamHits += 1
    response.end('wrong target')
  })
  const upstreamAddress = await listen(upstream)
  t.after(() => close(upstream))

  const server = await distServer({ dist, apiTarget: `http://127.0.0.1:${upstreamAddress.port}` })
  const address = await listen(server)
  t.after(() => close(server))
  const response = await fetch(
    `http://127.0.0.1:${address.port}/app-deadbeef.js?next=/api/projects`,
  )
  assert.equal(response.status, 200)
  assert.match(await response.text(), /staticAsset/)
  assert.equal(upstreamHits, 0)
})

test('refuses a stale dist snapshot and a file tampered after server validation', async (t) => {
  const dist = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-dist-test-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  const asset = path.join(dist, 'app-deadbeef.js')
  await writeFile(path.join(dist, 'index.html'), '<main>shell</main>')
  await writeFile(asset, 'export const pristine = true\n')
  const identity = await buildIdentityFor(dist)

  await writeFile(asset, 'export const stale = true\n')
  await assert.rejects(validateDistSnapshot(dist, identity.manifest), /dist.*(bytes|hash|snapshot)/i)

  await writeFile(asset, 'export const pristine = true\n')
  const server = createDistServer({
    dist,
    apiTarget: 'http://127.0.0.1:9',
    expectedBackendSha: SOURCE_SHA,
    buildIdentity: identity,
  })
  const address = await listen(server)
  t.after(() => close(server))
  await writeFile(asset, 'export const tampered = true\n')
  const response = await fetch(`http://127.0.0.1:${address.port}/app-deadbeef.js`)
  assert.notEqual(response.status, 200)
  assert.match(await response.text(), /integrity/i)
})
