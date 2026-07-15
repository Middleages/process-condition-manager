import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  assertCleanBuildSource,
  assertExecutedScriptProvenance,
  buildFreshProductionDist,
  captureHeadScriptProvenance,
  captureInstalledBuildToolchain,
  sanitizeBuildEnvironment,
} from './build_phase26_dist.mjs'

const EVIDENCE = 'docs/superpowers/evidence/phase-2-6'

async function fixtureRepository(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-build-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'frontend'), { recursive: true })
  await mkdir(path.join(root, 'scripts', 'qa'), { recursive: true })
  await mkdir(path.join(root, EVIDENCE), { recursive: true })
  await writeFile(path.join(root, 'frontend', 'package-lock.json'), '{"lockfileVersion":3}\n')
  await writeFile(path.join(root, 'scripts', 'qa', 'build_phase26_dist.mjs'), 'export const build = true\n')
  await writeFile(path.join(root, 'scripts', 'qa', 'phase26_browser_qa.mjs'), 'export const browser = true\n')
  await writeFile(path.join(root, 'scripts', 'qa', 'serve_phase26_dist.mjs'), 'export const server = true\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'qa@example.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Phase 26 QA'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

test('preflight allows only the configured evidence leaf', async (t) => {
  const repoRoot = await fixtureRepository(t)
  await writeFile(path.join(repoRoot, EVIDENCE, 'old-result.json'), '{}\n')

  const result = await assertCleanBuildSource({
    repoRoot,
    evidenceRoot: path.join(repoRoot, EVIDENCE),
  })

  assert.deepEqual(result.allowed_changes, [`${EVIDENCE}/old-result.json`])
  assert.deepEqual(result.rejected_changes, [])
})

test('preflight rejects untracked QA scripts and frontend env files even when ignored', async (t) => {
  const repoRoot = await fixtureRepository(t)
  await writeFile(path.join(repoRoot, '.gitignore'), 'frontend/.env*\nscripts/qa/untracked_probe.mjs\n')
  execFileSync('git', ['add', '.gitignore'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-qm', 'ignore local env'], { cwd: repoRoot })
  await writeFile(path.join(repoRoot, 'scripts', 'qa', 'untracked_probe.mjs'), 'throw new Error("not HEAD")\n')
  await writeFile(path.join(repoRoot, 'frontend', '.env.local'), 'VITE_API_URL=https://wrong.invalid\n')

  await assert.rejects(
    assertCleanBuildSource({ repoRoot, evidenceRoot: path.join(repoRoot, EVIDENCE) }),
    /scripts\/qa\/untracked_probe\.mjs.*frontend\/\.env\.local|frontend\/\.env\.local.*scripts\/qa\/untracked_probe\.mjs/s,
  )
})

test('preflight rejects a tracked change outside evidence', async (t) => {
  const repoRoot = await fixtureRepository(t)
  await writeFile(path.join(repoRoot, 'frontend', 'package-lock.json'), '{"changed":true}\n')

  await assert.rejects(
    assertCleanBuildSource({ repoRoot, evidenceRoot: path.join(repoRoot, EVIDENCE) }),
    /frontend\/package-lock\.json/,
  )
})

test('HEAD script provenance rejects absent or different harness/server bytes', async (t) => {
  const repoRoot = await fixtureRepository(t)
  const clean = await captureHeadScriptProvenance(repoRoot)
  assert.deepEqual(Object.keys(clean), ['build_harness', 'browser_harness', 'dist_server'])

  await writeFile(path.join(repoRoot, 'scripts', 'qa', 'phase26_browser_qa.mjs'), 'export const browser = false\n')
  await assert.rejects(captureHeadScriptProvenance(repoRoot), /browser harness.*does not match HEAD/i)

  await rm(path.join(repoRoot, 'scripts', 'qa', 'phase26_browser_qa.mjs'))
  await assert.rejects(captureHeadScriptProvenance(repoRoot), /browser harness.*missing/i)
})

test('build environment removes every ambient VITE value and records the effective empty map', () => {
  const { environment, normalized } = sanitizeBuildEnvironment({
    PATH: '/usr/bin',
    HOME: '/tmp/home',
    VITE_API_URL: 'https://wrong.invalid',
    VITE_SECRET: 'must-not-leak',
  })

  assert.deepEqual(environment, normalized.variables)
  assert.equal(normalized.variables.PATH, '/usr/bin')
  assert.equal(normalized.variables.HOME, '/tmp/home')
  assert.equal(normalized.variables.NODE_ENV, 'production')
  assert.equal(normalized.variables.CI, '1')
  assert.equal(normalized.variables.TZ, 'UTC')
  assert.deepEqual(normalized.vite, {})
  assert.equal(JSON.stringify(normalized).includes('must-not-leak'), false)
})

test('executed trust script bytes must match their recorded provenance', () => {
  const bytes = Buffer.from('trusted script\n')
  const expected = {
    bytes: bytes.length,
    sha256: '97065116f9af50cb3d3c15f77f845048f1eed2df47f4f1b60b707c6c913efdbf',
  }
  assert.doesNotThrow(() => assertExecutedScriptProvenance(bytes, expected, 'test harness'))
  assert.throws(
    () => assertExecutedScriptProvenance(Buffer.from('modified script\n'), expected, 'test harness'),
    /executed test harness.*provenance/,
  )
})

test('fresh build records exact provenance and refuses a clean HEAD change during npm build', async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'pcm-phase26-fresh-build-'))
  t.after(() => rm(repoRoot, { recursive: true, force: true }))
  const qaRoot = path.dirname(fileURLToPath(import.meta.url))
  await mkdir(path.join(repoRoot, 'frontend'), { recursive: true })
  await mkdir(path.join(repoRoot, 'scripts', 'qa'), { recursive: true })
  await mkdir(path.join(repoRoot, EVIDENCE), { recursive: true })
  for (const name of ['build_phase26_dist.mjs', 'phase26_browser_qa.mjs', 'serve_phase26_dist.mjs']) {
    await writeFile(path.join(repoRoot, 'scripts', 'qa', name), await import('node:fs/promises').then(({ readFile }) => readFile(path.join(qaRoot, name))))
  }
  await writeFile(
    path.join(repoRoot, '.gitignore'),
    'frontend/dist/\nfrontend/node_modules/\nfrontend/mutate-head\nfrontend/tsconfig.tsbuildinfo\n',
  )
  const typescriptRoot = path.join(repoRoot, 'frontend', 'tool-fixtures', 'typescript')
  const viteRoot = path.join(repoRoot, 'frontend', 'tool-fixtures', 'vite')
  await mkdir(path.join(typescriptRoot, 'bin'), { recursive: true })
  await mkdir(path.join(viteRoot, 'bin'), { recursive: true })
  await writeFile(path.join(typescriptRoot, 'package.json'), JSON.stringify({
    name: 'typescript', version: '5.9.3', type: 'module', bin: { tsc: 'bin/tsc' },
  }))
  await writeFile(path.join(viteRoot, 'package.json'), JSON.stringify({
    name: 'vite', version: '6.4.1', type: 'module', bin: { vite: 'bin/vite.js' },
  }))
  const fakeTsc = path.join(typescriptRoot, 'bin', 'tsc')
  await writeFile(fakeTsc, [
    '#!/usr/bin/env node',
    "import { execFileSync } from 'node:child_process'",
    "import { access, writeFile } from 'node:fs/promises'",
    "if (process.argv.includes('--version')) { console.log('Version 5.9.3'); process.exit(0) }",
    "try {",
    "  await access('tsconfig.tsbuildinfo')",
    "  throw new Error('stale tsconfig.tsbuildinfo reached the build')",
    "} catch (error) {",
    "  if (error?.code !== 'ENOENT') throw error",
    "}",
    "try {",
    "  await access('mutate-head')",
    "  await writeFile('source.txt', 'changed during build\\n')",
    "  execFileSync('git', ['add', 'source.txt'])",
    "  execFileSync('git', ['commit', '-qm', 'race source during build'])",
    "} catch (error) {",
    "  if (error?.code !== 'ENOENT') throw error",
    "}",
    "await writeFile('tsconfig.tsbuildinfo', 'fresh build info\\n')",
    '',
  ].join('\n'))
  const fakeVite = path.join(viteRoot, 'bin', 'vite.js')
  await writeFile(fakeVite, [
    '#!/usr/bin/env node',
    "import { mkdir, writeFile } from 'node:fs/promises'",
    "if (process.argv.includes('--version')) { console.log('vite/6.4.1 fixture'); process.exit(0) }",
    "await mkdir('dist/assets', { recursive: true })",
    "await writeFile('dist/index.html', '<main>fresh</main>')",
    "await writeFile('dist/assets/z-last.js', 'export const fresh = true\\n')",
    "await writeFile('dist/assets/a-first.css', 'body { color: black }\\n')",
    '',
  ].join('\n'))
  await chmod(fakeTsc, 0o755)
  await chmod(fakeVite, 0o755)
  await writeFile(path.join(repoRoot, 'frontend', 'package.json'), JSON.stringify({
    name: 'phase26-build-fixture',
    version: '1.0.0',
    scripts: { build: 'tsc && vite build' },
    devDependencies: {
      typescript: 'file:tool-fixtures/typescript',
      vite: 'file:tool-fixtures/vite',
    },
  }))
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: path.join(repoRoot, 'frontend'),
    stdio: 'ignore',
  })
  await writeFile(path.join(repoRoot, 'frontend', 'source.txt'), 'pristine source\n')
  execFileSync('git', ['init', '-q'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 'qa@example.invalid'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 'Phase 26 QA'], { cwd: repoRoot })
  execFileSync('git', ['add', '.'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-qm', 'build fixture'], { cwd: repoRoot })
  await mkdir(path.join(repoRoot, 'frontend', 'dist'), { recursive: true })
  await writeFile(path.join(repoRoot, 'frontend', 'dist', 'stale.txt'), 'must disappear')
  await writeFile(path.join(repoRoot, 'frontend', 'tsconfig.tsbuildinfo'), 'stale build info\n')
  await mkdir(path.join(repoRoot, 'frontend', 'node_modules', '.bin'), { recursive: true })
  const rogueTsc = path.join(repoRoot, 'frontend', 'node_modules', '.bin', 'tsc')
  await writeFile(rogueTsc, '#!/bin/sh\necho rogue ignored tsc\n')
  await chmod(rogueTsc, 0o755)

  const manifest = await buildFreshProductionDist({
    repoRoot,
    dist: 'frontend/dist',
    manifest: `${EVIDENCE}/build-manifest.json`,
    evidenceRoot: EVIDENCE,
    sourceEnvironment: {
      PATH: process.env.PATH,
      HOME: process.env.HOME ?? tmpdir(),
      VITE_SECRET: 'must-not-leak',
    },
  })

  assert.equal(manifest.source.git_sha, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim())
  assert.match(manifest.source.git_tree, /^[0-9a-f]{40}$/)
  assert.match(manifest.source.frontend_tree, /^[0-9a-f]{40}$/)
  assert.match(manifest.source.package_lock.sha256, /^[0-9a-f]{64}$/)
  assert.equal(manifest.runtime.node, process.version)
  assert.match(manifest.runtime.npm, /^\d+\.\d+\.\d+/)
  assert.equal(manifest.toolchain.typescript.package_version, '5.9.3')
  assert.equal(manifest.toolchain.typescript.reported_version, 'Version 5.9.3')
  assert.equal(manifest.toolchain.vite.package_version, '6.4.1')
  assert.equal(manifest.toolchain.vite.reported_version, 'vite/6.4.1 fixture')
  assert.match(manifest.toolchain.typescript.executable.sha256, /^[0-9a-f]{64}$/)
  assert.match(manifest.toolchain.vite.executable.sha256, /^[0-9a-f]{64}$/)
  assert.notEqual(
    await readFile(path.join(repoRoot, 'frontend', 'node_modules', '.bin', 'tsc'), 'utf8'),
    '#!/bin/sh\necho rogue ignored tsc\n',
  )
  const buildSandbox = path.join(repoRoot, EVIDENCE, '.build-sandbox')
  await assert.rejects(readdir(buildSandbox), /ENOENT/)
  assert.deepEqual(
    await captureInstalledBuildToolchain(
      path.join(repoRoot, 'frontend'),
      await readFile(path.join(repoRoot, 'frontend', 'package-lock.json')),
      manifest.build_env.variables,
      manifest.toolchain,
    ),
    manifest.toolchain,
  )
  await assert.rejects(readdir(buildSandbox), /ENOENT/)
  assert.deepEqual(manifest.build_env.vite, {})
  assert.equal(manifest.build_env.variables.NODE_ENV, 'production')
  assert.equal(manifest.build_env.variables.CI, '1')
  assert.equal(manifest.build_env.variables.TZ, 'UTC')
  assert.deepEqual(manifest.fresh_build, {
    removed_before_build: ['frontend/dist', 'frontend/tsconfig.tsbuildinfo'],
    regenerated_before_build: ['frontend/node_modules'],
    install_command: ['npm', 'ci', '--include=dev', '--no-audit', '--no-fund'],
  })
  assert.deepEqual(manifest.dist.files.map(({ path: filename }) => filename), [
    'assets/a-first.css',
    'assets/z-last.js',
    'index.html',
  ])
  assert.equal(JSON.stringify(manifest).includes('must-not-leak'), false)
  assert.equal(await readFile(path.join(repoRoot, 'frontend', 'tsconfig.tsbuildinfo'), 'utf8'), 'fresh build info\n')
  assert.deepEqual(
    JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(
      path.join(repoRoot, EVIDENCE, 'build-manifest.json'),
      'utf8',
    ))),
    manifest,
  )

  await writeFile(path.join(repoRoot, 'frontend', 'mutate-head'), 'trigger\n')
  await assert.rejects(
    buildFreshProductionDist({
      repoRoot,
      dist: 'frontend/dist',
      manifest: `${EVIDENCE}/build-manifest.json`,
      evidenceRoot: EVIDENCE,
      sourceEnvironment: {
        PATH: process.env.PATH,
        HOME: process.env.HOME ?? tmpdir(),
      },
    }),
    /source identity changed during production build/,
  )
})
