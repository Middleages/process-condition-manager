#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertBuildManifestDigest,
  assertExecutedScriptProvenance,
  assertNormalizedBuildEnvironment,
  captureHeadScriptProvenance,
  captureInstalledBuildToolchain,
} from './build_phase26_dist.mjs'

const LOOPBACK = '127.0.0.1'
const MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export function createDistServer({ dist, apiTarget, buildIdentity, expectedBackendSha }) {
  if (typeof dist !== 'string' || dist.length === 0) throw new TypeError('dist is required')
  const distRoot = path.resolve(dist)
  const target = parseApiTarget(apiTarget)
  assert(buildIdentity && typeof buildIdentity === 'object', 'validated build identity is required')
  assert.equal(buildIdentity.distRoot, distRoot, 'validated build identity does not match --dist')
  assertBuildManifestDigest(buildIdentity.manifest)
  assert.match(expectedBackendSha ?? '', /^[0-9a-f]{40}$/, 'expected backend SHA must be a full Git SHA')
  assert.equal(
    expectedBackendSha,
    buildIdentity.manifest.source.git_sha,
    'expected backend SHA must equal the production manifest Git SHA',
  )
  const identity = {
    ...buildIdentity,
    files: new Map(buildIdentity.manifest.dist.files.map((entry) => [entry.path, entry])),
  }

  return http.createServer(async (request, response) => {
    try {
      const requestTarget = request.url ?? '/'
      if (!isOriginFormRequestTarget(requestTarget)) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Invalid request target\n')
        return
      }
      const requestUrl = new URL(requestTarget, 'http://phase26.local')
      if (requestUrl.origin !== 'http://phase26.local') {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Invalid request target\n')
        return
      }
      if (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/')) {
        proxyApi(request, response, target, requestUrl, identity, expectedBackendSha)
        return
      }
      await serveStatic(request, response, requestUrl, identity)
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      }
      response.end(`Internal server error: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  })
}

export function parseServeArgs(argv) {
  const values = {
    dist: null,
    manifest: null,
    port: null,
    apiTarget: null,
    expectedBackendSha: null,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      values.help = true
      continue
    }
    if (!['--dist', '--manifest', '--port', '--api-target', '--expected-backend-sha'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    index += 1
    if (arg === '--dist') values.dist = value
    if (arg === '--manifest') values.manifest = value
    if (arg === '--api-target') values.apiTarget = value
    if (arg === '--expected-backend-sha') values.expectedBackendSha = value
    if (arg === '--port') values.port = parsePort(value)
  }
  if (values.help) return values
  const missing = []
  if (values.dist === null) missing.push('--dist')
  if (values.manifest === null) missing.push('--manifest')
  if (values.port === null) missing.push('--port')
  if (values.apiTarget === null) missing.push('--api-target')
  if (values.expectedBackendSha === null) missing.push('--expected-backend-sha')
  if (missing.length > 0) throw new Error(`Missing required arguments: ${missing.join(', ')}`)
  const target = parseApiTarget(values.apiTarget)
  if (values.port !== 15174) throw new Error('--port must use isolated Task 15 port 15174')
  if (target.port !== '18000') throw new Error('--api-target must use isolated backend port 18000')
  if (target.pathname !== '/' || target.search !== '' || target.hash !== '') {
    throw new Error('--api-target must be the exact isolated backend origin')
  }
  if (!/^[0-9a-f]{40}$/.test(values.expectedBackendSha)) {
    throw new Error('--expected-backend-sha must be a full Git SHA')
  }
  return values
}

async function serveStatic(request, response, requestUrl, identity) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
    response.end('Method not allowed\n')
    return
  }

  const distRoot = identity.distRoot
  const decodedPath = decodeURIComponent(requestUrl.pathname)
  const relative = decodedPath.replace(/^\/+/, '')
  const candidate = path.resolve(distRoot, relative)
  const safeCandidate = isInside(distRoot, candidate) ? candidate : null
  const selected = safeCandidate === null ? null : await regularFile(safeCandidate, distRoot)
  const filePath = selected ?? (
    isAssetLikePath(decodedPath)
      ? null
      : await regularFile(path.join(distRoot, 'index.html'), distRoot)
  )
  if (filePath === null) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found\n')
    return
  }

  const relativeFile = path.relative(distRoot, filePath).split(path.sep).join('/')
  const expectedFile = identity.files.get(relativeFile)
  if (expectedFile === undefined) throw new Error(`production dist integrity mismatch: unmanifested file ${relativeFile}`)
  const body = await readFile(filePath)
  const bodySha256 = sha256(body)
  if (body.length !== expectedFile.bytes || bodySha256 !== expectedFile.sha256) {
    throw new Error(`production dist integrity mismatch: ${relativeFile}`)
  }
  const extension = path.extname(filePath).toLowerCase()
  const immutable = selected !== null && /-[a-zA-Z0-9_-]{8,}\.[^.]+$/.test(path.basename(filePath))
  response.writeHead(200, {
    'content-type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-phase26-manifest-sha256': identity.manifest.manifest_sha256,
    'x-phase26-dist-identity': identity.manifest.dist.identity_sha256,
    'x-phase26-source-git-sha': identity.manifest.source.git_sha,
    'x-phase26-file-path': relativeFile,
    'x-phase26-file-sha256': bodySha256,
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  response.end(body)
}

function proxyApi(request, response, target, requestUrl, identity, expectedBackendSha) {
  const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, target)
  const headers = filterHeaders(request.headers)
  headers.host = target.host
  headers['x-forwarded-host'] = request.headers.host ?? `${LOOPBACK}`
  headers['x-forwarded-proto'] = 'http'

  const transport = upstreamUrl.protocol === 'https:' ? https : http
  const upstream = transport.request(
    upstreamUrl,
    { method: request.method, headers },
    (upstreamResponse) => {
      const responseHeaders = filterHeaders(upstreamResponse.headers)
      responseHeaders['x-phase26-backend-git-sha'] = expectedBackendSha
      responseHeaders['x-phase26-manifest-sha256'] = identity.manifest.manifest_sha256
      responseHeaders['x-phase26-source-git-sha'] = identity.manifest.source.git_sha
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        responseHeaders,
      )
      upstreamResponse.on('error', (error) => response.destroy(error))
      upstreamResponse.pipe(response)
    },
  )
  upstream.on('error', (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    }
    response.end(JSON.stringify({ code: 'proxy_unavailable', message: error.message }))
  })
  request.on('aborted', () => upstream.destroy())
  request.pipe(upstream)
}

export async function validateDistSnapshot(dist, manifest) {
  assertBuildManifestDigest(manifest)
  const root = await realpath(dist)
  const files = await snapshotFiles(root)
  assert.deepEqual(files, manifest.dist.files, 'production dist file snapshot mismatch')
  assert.equal(sha256Json(files), manifest.dist.identity_sha256, 'production dist identity hash mismatch')
  return { identity_sha256: manifest.dist.identity_sha256, files }
}

export async function loadBuildIdentity({ repoRoot, dist, manifest, expectedBackendSha }) {
  const root = await realpath(repoRoot)
  const distRoot = await realpath(dist)
  const manifestPath = await realpath(manifest)
  assert(isInside(root, distRoot), 'production dist realpath escapes the repository')
  assert(isInside(root, manifestPath), 'build manifest realpath escapes the repository')
  assert.equal(
    path.relative(root, distRoot).split(path.sep).join('/'),
    'frontend/dist',
    'production dist must be the repository frontend/dist realpath',
  )
  assert.equal(
    path.relative(root, manifestPath).split(path.sep).join('/'),
    'docs/superpowers/evidence/phase-2-6/build-manifest.json',
    'build manifest must be the Task 15 evidence manifest realpath',
  )
  const manifestBody = await readFile(manifestPath, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(manifestBody)
  } catch (error) {
    throw new Error(`build manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  assertBuildManifestDigest(parsed)
  assert.equal(parsed.schema_version, 1, 'unsupported build manifest schema')
  assert.equal(parsed.source.git_sha, git(root, ['rev-parse', 'HEAD']).trim(), 'build manifest Git SHA is stale')
  assert.equal(parsed.source.git_tree, git(root, ['rev-parse', 'HEAD^{tree}']).trim(), 'build manifest Git tree is stale')
  assert.equal(parsed.source.frontend_tree, git(root, ['rev-parse', 'HEAD:frontend']).trim(), 'build manifest frontend tree is stale')
  assert.equal(expectedBackendSha, parsed.source.git_sha, 'backend identity input does not match build manifest Git SHA')
  assertNormalizedBuildEnvironment(parsed.build_env)
  assert.deepEqual(parsed.fresh_build, {
    removed_before_build: ['frontend/dist', 'frontend/tsconfig.tsbuildinfo'],
    regenerated_before_build: ['frontend/node_modules'],
    install_command: ['npm', 'ci', '--include=dev', '--no-audit', '--no-fund'],
  }, 'production build did not declare fresh build artifact removal')
  const packageLock = await readFile(path.join(root, 'frontend', 'package-lock.json'))
  assert.deepEqual(parsed.source.package_lock, {
    path: 'frontend/package-lock.json',
    bytes: packageLock.length,
    sha256: sha256(packageLock),
  }, 'build manifest package-lock provenance is stale')
  assert.deepEqual(
    await captureInstalledBuildToolchain(
      path.join(root, 'frontend'),
      packageLock,
      parsed.build_env.variables,
      parsed.toolchain,
    ),
    parsed.toolchain,
    'installed production build toolchain differs from the manifest',
  )
  assert.equal(
    await realpath(process.execPath),
    parsed.toolchain.runtime.node.path,
    'executed dist server Node binary differs from the production build runtime',
  )
  assert.deepEqual(
    parsed.scripts,
    await captureHeadScriptProvenance(root),
    'QA script provenance is stale',
  )
  const executedServer = await readFile(fileURLToPath(import.meta.url))
  assertExecutedScriptProvenance(executedServer, parsed.scripts.dist_server, 'dist server')
  assert.equal(path.resolve(root, parsed.dist.root), distRoot, 'build manifest points at a different dist root')
  await validateDistSnapshot(distRoot, parsed)
  return { distRoot, manifestPath, manifest: parsed }
}

async function snapshotFiles(root) {
  const files = []
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute, relative)
      } else {
        assert(entry.isFile(), `production dist contains a non-file entry: ${relative}`)
        const resolved = await realpath(absolute)
        assert(isInside(root, resolved), `production dist entry escapes through a symlink: ${relative}`)
        const body = await readFile(resolved)
        files.push({ path: relative, bytes: body.length, sha256: sha256(body) })
      }
    }
  }
  await visit(root)
  return files
}

function filterHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name, value]) => value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())),
  )
}

async function regularFile(candidate, distRoot) {
  try {
    const resolved = await realpath(candidate)
    if (!isInside(distRoot, resolved)) return null
    const metadata = await stat(resolved)
    return metadata.isFile() ? resolved : null
  } catch (error) {
    if (error && typeof error === 'object' && ['ENOENT', 'ENOTDIR'].includes(error.code)) return null
    throw error
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function isOriginFormRequestTarget(requestTarget) {
  return requestTarget.startsWith('/') && !requestTarget.startsWith('//')
}

function isAssetLikePath(pathname) {
  return pathname === '/assets' || pathname.startsWith('/assets/') || path.posix.extname(pathname) !== ''
}

function parseApiTarget(value) {
  let target
  try {
    target = new URL(value)
  } catch {
    throw new Error('--api-target must be an HTTP URL')
  }
  if (target.protocol !== 'http:') throw new Error('--api-target must be a loopback HTTP URL')
  if (target.hostname !== LOOPBACK || target.username !== '' || target.password !== '') {
    throw new Error('--api-target must be a loopback HTTP URL')
  }
  return target
}

function parsePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('--port must be 1..65535')
  return port
}

function usage() {
  return [
    'Usage: node scripts/qa/serve_phase26_dist.mjs --dist <directory> --manifest <file>',
    '  --port <port> --api-target <url> --expected-backend-sha <full-git-sha>',
    '',
  ].join('\n')
}

async function main() {
  const args = parseServeArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }
  const repoRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  const identity = await loadBuildIdentity({
    repoRoot,
    dist: args.dist,
    manifest: args.manifest,
    expectedBackendSha: args.expectedBackendSha,
  })
  const server = createDistServer({
    dist: identity.distRoot,
    apiTarget: args.apiTarget,
    buildIdentity: identity,
    expectedBackendSha: args.expectedBackendSha,
  })
  server.listen(args.port, LOOPBACK, () => {
    process.stdout.write(
      `Phase 2.6 production artifact: http://${LOOPBACK}:${args.port} ` +
      `(dist=${identity.distRoot}, manifest=${identity.manifest.manifest_sha256})\n`,
    )
  })
  const shutdown = () => server.close(() => process.exit(0))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256Json(value) {
  return sha256(JSON.stringify(value))
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1])
if (invokedPath !== null && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage()}`)
    process.exitCode = 1
  })
}
