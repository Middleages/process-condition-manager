import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDistServer, parseServeArgs } from './serve_phase26_dist.mjs'

test('CLI accepts only the isolated Task 15 ports and loopback backend', () => {
  assert.deepEqual(parseServeArgs([
    '--dist', 'frontend/dist', '--port', '15174', '--api-target', 'http://127.0.0.1:18000',
  ]), {
    dist: 'frontend/dist', port: 15174, apiTarget: 'http://127.0.0.1:18000', help: false,
  })
  assert.throws(
    () => parseServeArgs(['--dist', 'frontend/dist', '--port', '5173', '--api-target', 'http://127.0.0.1:18000']),
    /15174/,
  )
  assert.throws(
    () => parseServeArgs(['--dist', 'frontend/dist', '--port', '15174', '--api-target', 'http://127.0.0.1:8000']),
    /18000/,
  )
  assert.throws(
    () => parseServeArgs(['--dist', 'frontend/dist', '--port', '15174', '--api-target', 'https://example.invalid']),
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

  const server = createDistServer({ dist, apiTarget: 'http://127.0.0.1:9' })
  const address = await listen(server)
  t.after(() => close(server))
  assert.equal(address.address, '127.0.0.1')

  const base = `http://127.0.0.1:${address.port}`
  const asset = await fetch(`${base}/app-deadbeef.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type') ?? '', /javascript/)
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.match(await asset.text(), /ready = true/)

  const route = await fetch(`${base}/projects/1/sheet`)
  assert.equal(route.status, 200)
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

  const proxy = createDistServer({
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

  const proxy = createDistServer({
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

  const server = createDistServer({ dist, apiTarget: 'http://127.0.0.1:9' })
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

  const server = createDistServer({ dist, apiTarget: 'http://127.0.0.1:9' })
  const address = await listen(server)
  t.after(() => close(server))

  const response = await fetch(`http://127.0.0.1:${address.port}/..%2Fsecret.txt`)
  assert.notEqual(await response.text(), 'must-not-leak')
  const linked = await fetch(`http://127.0.0.1:${address.port}/linked-secret.txt`)
  assert.notEqual(await linked.text(), 'must-not-leak')
})
