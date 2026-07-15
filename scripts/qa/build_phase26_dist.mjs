#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_SOURCE_FILES = Object.freeze([
  Object.freeze({ key: 'build_harness', label: 'build harness', path: 'scripts/qa/build_phase26_dist.mjs' }),
  Object.freeze({ key: 'browser_harness', label: 'browser harness', path: 'scripts/qa/phase26_browser_qa.mjs' }),
  Object.freeze({ key: 'dist_server', label: 'dist server', path: 'scripts/qa/serve_phase26_dist.mjs' }),
])

export function sanitizeBuildEnvironment(source = process.env, paths = {}) {
  assert.equal(typeof source.PATH, 'string', 'PATH is required for the production build')
  const variables = {
    PATH: source.PATH,
    HOME: paths.home ?? source.HOME ?? '/tmp',
    TMPDIR: paths.tmpdir ?? source.TMPDIR ?? '/tmp',
    NODE_ENV: 'production',
    CI: '1',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    NPM_CONFIG_USERCONFIG: paths.npmUserConfig ?? '/tmp/pcm-phase26-user-npmrc',
    NPM_CONFIG_GLOBALCONFIG: '/dev/null',
    NPM_CONFIG_CACHE: paths.npmCache ?? '/tmp/pcm-phase26-npm-cache',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_AUDIT: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
  return { environment: { ...variables }, normalized: { variables, vite: {} } }
}

export function assertNormalizedBuildEnvironment(buildEnvironment) {
  assert.deepEqual(buildEnvironment?.vite, {}, 'production VITE environment must be empty')
  const variables = buildEnvironment?.variables
  assert(variables && typeof variables === 'object' && !Array.isArray(variables), 'normalized build variables are missing')
  assert.equal(typeof variables.PATH, 'string')
  assert.equal(typeof variables.HOME, 'string')
  assert.equal(typeof variables.TMPDIR, 'string')
  assert.equal(typeof variables.NPM_CONFIG_CACHE, 'string')
  assert.equal(typeof variables.NPM_CONFIG_USERCONFIG, 'string')
  const fixed = {
    NODE_ENV: 'production',
    CI: '1',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    NPM_CONFIG_GLOBALCONFIG: '/dev/null',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_AUDIT: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
  for (const [key, value] of Object.entries(fixed)) assert.equal(variables[key], value, `unexpected build env ${key}`)
  assert.deepEqual(
    Object.keys(variables).sort(),
    ['PATH', 'HOME', 'TMPDIR', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_USERCONFIG', ...Object.keys(fixed)].sort(),
    'normalized build environment contains undeclared variables',
  )
  return buildEnvironment
}

export function assertExecutedScriptProvenance(bytes, expected, label) {
  assert.deepEqual(
    { bytes: bytes.length, sha256: sha256(bytes) },
    { bytes: expected?.bytes, sha256: expected?.sha256 },
    `executed ${label} does not match the manifest/HEAD provenance`,
  )
}

export async function assertCleanBuildSource({ repoRoot, evidenceRoot }) {
  const root = path.resolve(repoRoot)
  const evidence = path.resolve(evidenceRoot)
  const evidenceRelative = repositoryRelative(root, evidence, 'evidence root')
  const tracked = splitNull(git(root, ['diff', '--name-only', '-z', 'HEAD', '--']))
  const untracked = splitNull(git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
  const ignoredQa = splitNull(git(root, [
    'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', 'scripts/qa',
  ]))
  const frontendEntries = await readdir(path.join(root, 'frontend'), { withFileTypes: true })
  const environmentFiles = frontendEntries
    .filter((entry) => entry.name === '.env' || entry.name.startsWith('.env.'))
    .map((entry) => `frontend/${entry.name}`)
  const changes = [...new Set([...tracked, ...untracked, ...ignoredQa, ...environmentFiles])]
    .map(normalizeGitPath)
    .sort(compareText)
  const allowed = changes.filter((entry) => entry === evidenceRelative || entry.startsWith(`${evidenceRelative}/`))
  const rejected = changes.filter((entry) => !allowed.includes(entry))
  if (rejected.length > 0) {
    throw new Error(`production build source is not clean; rejected paths:\n${rejected.join('\n')}`)
  }
  return { allowed_changes: allowed, rejected_changes: rejected }
}

export async function captureHeadScriptProvenance(repoRoot) {
  const provenance = {}
  for (const source of QA_SOURCE_FILES) {
    const absolute = path.join(repoRoot, ...source.path.split('/'))
    let current
    try {
      current = await readFile(absolute)
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        throw new Error(`${source.label} is missing from the worktree: ${source.path}`)
      }
      throw error
    }
    let committed
    try {
      committed = git(repoRoot, ['show', `HEAD:${source.path}`], null)
    } catch {
      throw new Error(`${source.label} is missing from HEAD: ${source.path}`)
    }
    if (!current.equals(committed)) {
      throw new Error(`${source.label} does not match HEAD: ${source.path}`)
    }
    provenance[source.key] = {
      path: source.path,
      bytes: current.length,
      sha256: sha256(current),
      git_blob: git(repoRoot, ['rev-parse', `HEAD:${source.path}`]).trim(),
    }
  }
  return provenance
}

export async function captureBuildSourceIdentity(repoRoot) {
  const startingGitSha = git(repoRoot, ['rev-parse', 'HEAD']).trim()
  const packageLock = await readFile(path.join(repoRoot, 'frontend', 'package-lock.json'))
  const identity = {
    git_sha: startingGitSha,
    git_tree: git(repoRoot, ['rev-parse', 'HEAD^{tree}']).trim(),
    frontend_tree: git(repoRoot, ['rev-parse', 'HEAD:frontend']).trim(),
    package_lock: {
      path: 'frontend/package-lock.json',
      bytes: packageLock.length,
      sha256: sha256(packageLock),
    },
    scripts: await captureHeadScriptProvenance(repoRoot),
  }
  assert.equal(
    git(repoRoot, ['rev-parse', 'HEAD']).trim(),
    startingGitSha,
    'source identity changed while it was being captured',
  )
  return identity
}

export async function captureInstalledBuildToolchain(frontendRoot, packageLockBytes, environment, expected = null) {
  const root = path.resolve(frontendRoot)
  const packageLock = JSON.parse(Buffer.isBuffer(packageLockBytes) ? packageLockBytes.toString('utf8') : packageLockBytes)
  const runtime = {
    node: await runtimeExecutableIdentity('node', ['--version'], environment, expected?.runtime?.node?.version),
    npm: await runtimeExecutableIdentity('npm', ['--version'], environment, expected?.runtime?.npm?.version),
  }
  const captureLocalTool = async ({ packageName, binaryName }) => {
    const installedRoot = await realpath(path.join(root, 'node_modules', packageName))
    const packageJsonPath = path.join(installedRoot, 'package.json')
    const packageJsonBytes = await readFile(packageJsonPath)
    const packageJson = JSON.parse(packageJsonBytes.toString('utf8'))
    const lockedVersion = lockedPackageVersion(packageLock, packageName)
    assert.equal(packageJson.version, lockedVersion, `${packageName} installed version differs from package-lock`)
    const declaredBin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binaryName]
    assert.equal(typeof declaredBin, 'string', `${packageName} does not declare ${binaryName}`)
    const declaredExecutable = await realpath(path.resolve(installedRoot, declaredBin))
    const npmShim = await realpath(path.join(root, 'node_modules', '.bin', binaryName))
    assert.equal(npmShim, declaredExecutable, `${binaryName} npm shim resolves outside the locked package executable`)
    const executableBytes = await readFile(declaredExecutable)
    const reportedVersion = expected?.[packageName === 'typescript' ? 'typescript' : 'vite']?.reported_version ??
      execFileSync(npmShim, ['--version'], {
        cwd: root,
        env: environment,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      }).trim()
    assert(
      reportedVersion.includes(packageJson.version),
      `${binaryName} reported version does not match installed ${packageName} ${packageJson.version}`,
    )
    return {
      package_name: packageName,
      package_path: toolchainPath(root, installedRoot),
      package_version: packageJson.version,
      locked_version: lockedVersion,
      package_json: {
        path: toolchainPath(root, packageJsonPath),
        bytes: packageJsonBytes.length,
        sha256: sha256(packageJsonBytes),
      },
      executable: {
        path: toolchainPath(root, declaredExecutable),
        bytes: executableBytes.length,
        sha256: sha256(executableBytes),
      },
      reported_version: reportedVersion,
    }
  }
  return {
    runtime,
    typescript: await captureLocalTool({ packageName: 'typescript', binaryName: 'tsc' }),
    vite: await captureLocalTool({ packageName: 'vite', binaryName: 'vite' }),
  }
}

async function runtimeExecutableIdentity(command, versionArgs, environment, expectedVersion = null) {
  const executable = await resolveExecutable(command, environment.PATH)
  const bytes = await readFile(executable)
  return {
    path: executable,
    version: expectedVersion ?? execFileSync(executable, versionArgs, {
      env: environment,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    }).trim(),
    bytes: bytes.length,
    sha256: sha256(bytes),
  }
}

async function resolveExecutable(command, searchPath) {
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory.length === 0) continue
    const candidate = path.join(directory, command)
    try {
      await access(candidate, constants.X_OK)
      return await realpath(candidate)
    } catch (error) {
      if (error && typeof error === 'object' && ['EACCES', 'ENOENT', 'ENOTDIR'].includes(error.code)) continue
      throw error
    }
  }
  throw new Error(`unable to resolve ${command} from sanitized PATH`)
}

function lockedPackageVersion(packageLock, packageName) {
  const entry = packageLock?.packages?.[`node_modules/${packageName}`]
  assert(entry && typeof entry === 'object', `${packageName} is absent from package-lock`)
  if (typeof entry.version === 'string') return entry.version
  if (entry.link === true && typeof entry.resolved === 'string') {
    const linked = packageLock.packages[entry.resolved.replace(/^\.\//, '')]
    if (typeof linked?.version === 'string') return linked.version
  }
  throw new Error(`${packageName} package-lock version is missing`)
}

function toolchainPath(frontendRoot, absolute) {
  const relative = path.relative(frontendRoot, absolute)
  return `frontend/${normalizeGitPath(relative)}`
}

export async function snapshotDist(distRoot) {
  const root = await realpath(distRoot)
  const rootMetadata = await stat(root)
  assert(rootMetadata.isDirectory(), `production dist is not a directory: ${root}`)
  const files = []
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => compareText(left.name, right.name))
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute, relative)
      } else {
        assert(entry.isFile(), `production dist contains a non-file entry: ${relative}`)
        const resolved = await realpath(absolute)
        assert(isInside(root, resolved), `production dist file escapes through a symlink: ${relative}`)
        const body = await readFile(resolved)
        files.push({ path: relative, bytes: body.length, sha256: sha256(body) })
      }
    }
  }
  await visit(root)
  assert(files.some(({ path: filename }) => filename === 'index.html'), 'production dist has no index.html')
  assert(files.some(({ path: filename }) => /^assets\/.*\.js$/.test(filename)), 'production dist has no JavaScript asset')
  return {
    identity_sha256: sha256Json(files),
    files,
  }
}

export function finalizeBuildManifest(payload) {
  return { ...payload, manifest_sha256: sha256Json(payload) }
}

export function assertBuildManifestDigest(manifest) {
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'build manifest must be an object')
  const { manifest_sha256: claimed, ...payload } = manifest
  assert.match(claimed ?? '', /^[0-9a-f]{64}$/, 'build manifest has no valid manifest_sha256')
  assert.equal(claimed, sha256Json(payload), 'build manifest digest mismatch')
  return manifest
}

export async function buildFreshProductionDist({ repoRoot, dist, manifest, evidenceRoot, sourceEnvironment = process.env }) {
  const root = path.resolve(repoRoot)
  const distRoot = path.resolve(root, dist)
  const manifestPath = path.resolve(root, manifest)
  const evidence = path.resolve(root, evidenceRoot)
  assert.equal(path.dirname(manifestPath), evidence, 'build manifest must be written directly in the configured evidence leaf')
  assert.equal(path.basename(manifestPath), 'build-manifest.json', 'build manifest filename must be build-manifest.json')
  repositoryRelative(root, distRoot, 'dist root')
  repositoryRelative(root, evidence, 'evidence root')

  await assertCleanBuildSource({ repoRoot: root, evidenceRoot: evidence })
  const sourceIdentity = await captureBuildSourceIdentity(root)
  const { scripts, ...source } = sourceIdentity
  const packageLockBytes = await readFile(path.join(root, 'frontend', 'package-lock.json'))
  assert.deepEqual(source.package_lock, {
    path: 'frontend/package-lock.json',
    bytes: packageLockBytes.length,
    sha256: sha256(packageLockBytes),
  }, 'package-lock changed after source identity capture')
  const executedBuildHarness = await readFile(fileURLToPath(import.meta.url))
  assertExecutedScriptProvenance(executedBuildHarness, scripts.build_harness, 'build harness')
  const frontendRoot = path.join(root, 'frontend')
  const sandbox = path.join(evidence, '.build-sandbox')
  const sandboxHome = path.join(sandbox, 'home')
  const sandboxTmp = path.join(sandbox, 'tmp')
  const sandboxNpmCache = path.join(sandbox, 'npm-cache')
  const sandboxNpmUserConfig = path.join(sandbox, 'user-npmrc')
  await rm(sandbox, { recursive: true, force: true })
  await mkdir(sandboxHome, { recursive: true })
  await mkdir(sandboxTmp, { recursive: true })
  await mkdir(sandboxNpmCache, { recursive: true })
  await writeFile(sandboxNpmUserConfig, '')
  const { environment, normalized } = sanitizeBuildEnvironment(sourceEnvironment, {
    home: sandboxHome,
    tmpdir: sandboxTmp,
    npmCache: sandboxNpmCache,
    npmUserConfig: sandboxNpmUserConfig,
  })
  const runtimeBeforeInstall = {
    node: await runtimeExecutableIdentity('node', ['--version'], environment),
    npm: await runtimeExecutableIdentity('npm', ['--version'], environment),
  }
  let toolchain
  try {
    execFileSync(runtimeBeforeInstall.npm.path, ['ci', '--include=dev', '--no-audit', '--no-fund'], {
      cwd: frontendRoot,
      env: environment,
      stdio: 'inherit',
    })
    await rm(distRoot, { recursive: true, force: true })
    await rm(path.join(frontendRoot, 'tsconfig.tsbuildinfo'), { recursive: true, force: true })
    toolchain = await captureInstalledBuildToolchain(frontendRoot, packageLockBytes, environment)
    assert.deepEqual(toolchain.runtime, runtimeBeforeInstall, 'npm ci changed the resolved Node/npm runtime')
    execFileSync(runtimeBeforeInstall.npm.path, ['run', 'build'], {
      cwd: frontendRoot,
      env: environment,
      stdio: 'inherit',
    })
    assert.deepEqual(
      await captureInstalledBuildToolchain(
        frontendRoot,
        packageLockBytes,
        environment,
      ),
      toolchain,
      'installed build toolchain changed during production build',
    )
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
  await assertCleanBuildSource({ repoRoot: root, evidenceRoot: evidence })
  assert.deepEqual(
    await captureBuildSourceIdentity(root),
    sourceIdentity,
    'source identity changed during production build',
  )
  const distSnapshot = await snapshotDist(distRoot)
  const payload = {
    schema_version: 1,
    source,
    runtime: {
      node: toolchain.runtime.node.version,
      npm: toolchain.runtime.npm.version,
    },
    toolchain,
    build_env: normalized,
    fresh_build: {
      removed_before_build: ['frontend/dist', 'frontend/tsconfig.tsbuildinfo'],
      regenerated_before_build: ['frontend/node_modules'],
      install_command: ['npm', 'ci', '--include=dev', '--no-audit', '--no-fund'],
    },
    scripts,
    dist: {
      root: normalizeGitPath(path.relative(root, distRoot)),
      ...distSnapshot,
    },
  }
  const buildManifest = finalizeBuildManifest(payload)
  await mkdir(evidence, { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(buildManifest, null, 2)}\n`, { flag: 'w' })
  assert.deepEqual(
    await captureBuildSourceIdentity(root),
    sourceIdentity,
    'source identity changed while the production manifest was written',
  )
  return buildManifest
}

export function parseBuildArgs(argv) {
  const values = { dist: null, manifest: null, evidenceRoot: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      values.help = true
      continue
    }
    if (!['--dist', '--manifest', '--evidence-root'].includes(argument)) throw new Error(`Unknown argument: ${argument}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
    index += 1
    if (argument === '--dist') values.dist = value
    if (argument === '--manifest') values.manifest = value
    if (argument === '--evidence-root') values.evidenceRoot = value
  }
  if (values.help) return values
  const missing = Object.entries(values)
    .filter(([key, value]) => key !== 'help' && value === null)
    .map(([key]) => `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
  if (missing.length > 0) throw new Error(`Missing required arguments: ${missing.join(', ')}`)
  return values
}

function repositoryRelative(repoRoot, candidate, label) {
  const relative = path.relative(repoRoot, candidate)
  assert(
    relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${label} must be inside the repository`,
  )
  return normalizeGitPath(relative)
}

function splitNull(value) {
  return value.toString('utf8').split('\0').filter(Boolean)
}

function normalizeGitPath(value) {
  return value.split(path.sep).join('/')
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256Json(value) {
  return sha256(JSON.stringify(value))
}

function git(repoRoot, args, encoding = 'utf8', executable = 'git') {
  return execFileSync(executable, executable === 'git' ? ['-C', repoRoot, ...args] : args, {
    encoding,
    maxBuffer: 32 * 1024 * 1024,
  })
}

function usage() {
  return [
    'Usage: node scripts/qa/build_phase26_dist.mjs --dist frontend/dist',
    '  --manifest docs/superpowers/evidence/phase-2-6/build-manifest.json',
    '  --evidence-root docs/superpowers/evidence/phase-2-6',
    '',
  ].join('\n')
}

async function main() {
  const args = parseBuildArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }
  const repoRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  const manifest = await buildFreshProductionDist({
    repoRoot,
    dist: args.dist,
    manifest: args.manifest,
    evidenceRoot: args.evidenceRoot,
  })
  process.stdout.write(`Phase 2.6 production manifest ${manifest.manifest_sha256}\n`)
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1])
if (invokedPath !== null && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n${usage()}`)
    process.exitCode = 1
  })
}
