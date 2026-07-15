#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

export function createDistServer({ dist, apiTarget }) {
  if (typeof dist !== 'string' || dist.length === 0) throw new TypeError('dist is required')
  const distRoot = path.resolve(dist)
  const target = parseApiTarget(apiTarget)

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
        proxyApi(request, response, target, requestUrl)
        return
      }
      await serveStatic(request, response, requestUrl, distRoot)
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      }
      response.end(`Internal server error: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  })
}

export function parseServeArgs(argv) {
  const values = { dist: null, port: null, apiTarget: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      values.help = true
      continue
    }
    if (!['--dist', '--port', '--api-target'].includes(arg)) throw new Error(`Unknown argument: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    index += 1
    if (arg === '--dist') values.dist = value
    if (arg === '--api-target') values.apiTarget = value
    if (arg === '--port') values.port = parsePort(value)
  }
  if (values.help) return values
  const missing = []
  if (values.dist === null) missing.push('--dist')
  if (values.port === null) missing.push('--port')
  if (values.apiTarget === null) missing.push('--api-target')
  if (missing.length > 0) throw new Error(`Missing required arguments: ${missing.join(', ')}`)
  const target = parseApiTarget(values.apiTarget)
  if (values.port !== 15174) throw new Error('--port must use isolated Task 15 port 15174')
  if (target.port !== '18000') throw new Error('--api-target must use isolated backend port 18000')
  if (target.pathname !== '/' || target.search !== '' || target.hash !== '') {
    throw new Error('--api-target must be the exact isolated backend origin')
  }
  return values
}

async function serveStatic(request, response, requestUrl, distRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
    response.end('Method not allowed\n')
    return
  }

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

  const metadata = await stat(filePath)
  const extension = path.extname(filePath).toLowerCase()
  const immutable = selected !== null && /-[a-zA-Z0-9_-]{8,}\.[^.]+$/.test(path.basename(filePath))
  response.writeHead(200, {
    'content-type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
    'content-length': metadata.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = createReadStream(filePath)
  stream.on('error', (error) => response.destroy(error))
  stream.pipe(response)
}

function proxyApi(request, response, target, requestUrl) {
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
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        filterHeaders(upstreamResponse.headers),
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
  return 'Usage: node scripts/qa/serve_phase26_dist.mjs --dist <directory> --port <port> --api-target <url>\n'
}

async function main() {
  const args = parseServeArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }
  const dist = await realpath(args.dist)
  const server = createDistServer({ dist, apiTarget: args.apiTarget })
  server.listen(args.port, LOOPBACK, () => {
    process.stdout.write(`Phase 2.6 production artifact: http://${LOOPBACK}:${args.port} (dist=${dist})\n`)
  })
  const shutdown = () => server.close(() => process.exit(0))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1])
if (invokedPath !== null && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage()}`)
    process.exitCode = 1
  })
}
