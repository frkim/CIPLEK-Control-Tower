import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPROVED_REGISTRY,
  validateLockfile,
  validateNpmConfig,
} from '../scripts/verify-npm-feed.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = fileURLToPath(new URL('../scripts/verify-npm-feed.mjs', import.meta.url))
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const source = `${APPROVED_REGISTRY}example/-/example-1.0.0.tgz`
const config = {
  registry: APPROVED_REGISTRY,
  'replace-registry-host': 'never',
  'package-lock': true,
}

function lockfile(resolved: unknown = source) {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { resolved: '^1.0.0' } },
      'node_modules/example': { resolved },
    },
  }
}

function runVerifier(overrides: Record<string, string> = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.toLowerCase().startsWith('npm_config_')) delete env[key]
  }
  const userConfig = join(root, 'tests', '__absent_feed_user_config__')
  const globalConfig = join(root, 'tests', '__absent_feed_global_config__')
  assert.equal(existsSync(userConfig), false)
  assert.equal(existsSync(globalConfig), false)
  return spawnSync(process.execPath, [script], {
    cwd: join(root, 'tests'),
    encoding: 'utf8',
    env: {
      ...env,
      npm_config_userconfig: userConfig,
      npm_config_globalconfig: globalConfig,
      npm_config_logs_max: '0',
      ...overrides,
    },
  })
}

test('effective default and scoped registries accept only the normalized approved endpoint', () => {
  assert.deepEqual(validateNpmConfig({
    ...config,
    registry: 'https://PACKAGEFEEDPROXY.MICROSOFT.IO:443/npm',
    '@approved:registry': APPROVED_REGISTRY,
  }), [])

  for (const registry of [
    'https://example.invalid/',
    'http://packagefeedproxy.microsoft.io/npm/',
    'https://packagefeedproxy.microsoft.io.example.invalid/npm/',
    'https://packagefeedproxy.microsoft.io@EXAMPLE.INVALID/npm/',
    'https://user:password@packagefeedproxy.microsoft.io/npm/',
    'https://packagefeedproxy.microsoft.io:444/npm/',
    'https://packagefeedproxy.microsoft.io/npm-other/',
    'https://packagefeedproxy.microsoft.io/npm/extra/',
    'https://packagefeedproxy.microsoft.io/npm/?redirect=https://example.invalid/',
    'https://packagefeedproxy.microsoft.io/npm/#fragment',
    'not a URL',
    '',
    undefined,
  ]) {
    assert.ok(validateNpmConfig({ ...config, registry }).some((error: string) => error.includes('effective npm registry')),
      `Accepted registry ${String(registry)}`)
  }
})

test('configuration checks scoped overrides, host rewriting and lockfile use', () => {
  const errors = validateNpmConfig({
    ...config,
    '@outside:registry': 'https://example.invalid/',
    'replace-registry-host': 'always',
    'package-lock': false,
  })
  assert.ok(errors.some((error: string) => error.includes('@outside:registry')))
  assert.ok(errors.some((error: string) => error.includes('replace-registry-host')))
  assert.ok(errors.some((error: string) => error.includes('package-lock')))
  assert.ok(validateNpmConfig(null).length > 0)
})

test('every locked source is checked, including legacy nested entries', () => {
  const lock = {
    ...lockfile(),
    dependencies: {
      outer: {
        resolved: source,
        dependencies: { inner: { resolved: 'https://example.invalid/example.tgz' } },
      },
    },
  }
  const { errors, checked } = validateLockfile(lock)
  assert.equal(checked, 3)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /dependencies\.outer\.inner/)
  assert.doesNotMatch(errors[0], /example\.invalid/)
})

test('resolved sources require the approved normalized origin and npm path', () => {
  for (const resolved of [
    'https://example.invalid/example.tgz',
    'http://packagefeedproxy.microsoft.io/npm/example.tgz',
    'https://packagefeedproxy.microsoft.io.example.invalid/npm/example.tgz',
    'https://packagefeedproxy.microsoft.io@EXAMPLE.INVALID/npm/example.tgz',
    'https://user:password@packagefeedproxy.microsoft.io/npm/example.tgz',
    'https://packagefeedproxy.microsoft.io:444/npm/example.tgz',
    'https://packagefeedproxy.microsoft.io/npm-other/example.tgz',
    'https://packagefeedproxy.microsoft.io/npm/../outside/example.tgz',
    'https://packagefeedproxy.microsoft.io/npm/%2e%2e%2foutside/example.tgz',
    'https://packagefeedproxy.microsoft.io/npm/%252e%252e%252foutside/example.tgz',
    'https://packagefeedproxy.microsoft.io/npm/example.tgz?redirect=https://example.invalid/',
    'https://packagefeedproxy.microsoft.io/npm/example.tgz#fragment',
    'file:../example.tgz',
    'git+https://example.invalid/repository.git',
    '',
    null,
  ]) {
    const { errors } = validateLockfile(lockfile(resolved))
    assert.equal(errors.length, 1, `Accepted source ${String(resolved)}`)
    assert.match(errors[0], /node_modules\/example/)
  }
  assert.deepEqual(validateLockfile(lockfile(
    'https://PACKAGEFEEDPROXY.MICROSOFT.IO:443/npm/@scope%2fexample/-/example-1.0.0.tgz',
  )).errors, [])
})

test('unresolved entries are rejected except declared dependencies bundled in a locked package', () => {
  const bundled = {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/parent': { resolved: source, bundleDependencies: ['child'] },
      'node_modules/parent/node_modules/child': { inBundle: true },
      'node_modules/parent/node_modules/child/node_modules/grandchild': { inBundle: true },
    },
  }
  assert.deepEqual(validateLockfile(bundled), { errors: [], checked: 1 })

  const resolvedBundle = structuredClone(bundled)
  Object.assign(resolvedBundle.packages['node_modules/parent/node_modules/child'], {
    resolved: 'https://example.invalid/child.tgz',
  })
  assert.ok(validateLockfile(resolvedBundle).errors.some((error: string) => error.includes('node_modules/child')))

  for (const packages of [
    { '': {}, 'node_modules/example': {} },
    { '': {}, 'node_modules/example': { inBundle: true } },
    {
      '': {},
      'node_modules/parent': { resolved: source, bundleDependencies: ['other'] },
      'node_modules/parent/node_modules/child': { inBundle: true },
    },
  ]) {
    assert.ok(validateLockfile({ lockfileVersion: 3, packages }).errors.some(
      (error: string) => error.includes('missing resolved source'),
    ))
  }
})

test('malformed lockfiles fail closed', () => {
  for (const lock of [
    null,
    {},
    { lockfileVersion: 1, packages: { '': {} } },
    { lockfileVersion: 3, packages: {} },
    { lockfileVersion: 3, packages: { '': {}, 'node_modules/example': null } },
    { ...lockfile(), dependencies: { example: null } },
  ]) {
    assert.ok(validateLockfile(lock).errors.length > 0)
  }
})

test('a shrinkwrap file cannot silently replace the checked package lock', () => {
  const { errors } = validateLockfile(lockfile(), true)
  assert.ok(errors.some((error: string) => error.includes('npm-shrinkwrap.json')))
})

test('the repository lockfile has only approved sources', () => {
  const lock = JSON.parse(read('../package-lock.json'))
  const { errors, checked } = validateLockfile(lock)
  assert.deepEqual(errors, [])
  assert.ok(checked > 0)
  assert.equal(checked, Object.values(lock.packages).filter((entry) => Object.hasOwn(entry as object, 'resolved')).length)
  for (const [location, entry] of Object.entries(lock.packages) as [string, { resolved?: string, inBundle?: boolean }][]) {
    if (location && !Object.hasOwn(entry, 'resolved')) assert.equal(entry.inBundle, true)
  }
  const [location, entry] = Object.entries(lock.packages).find(
    ([name, value]) => name !== '' && Object.hasOwn(value as object, 'resolved'),
  ) as [string, { resolved?: string }]
  delete entry.resolved
  assert.ok(validateLockfile(lock).errors.some((error: string) => error.includes(`${location}: missing resolved source`)))
})

test('the preflight uses project configuration even on a clean host and from another directory', () => {
  const result = runVerifier()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Verified npm configuration and \d+ locked sources/)
})

test('verification functions can be imported without running the preflight', () => {
  const moduleUrl = new URL('../scripts/verify-npm-feed.mjs', import.meta.url).href
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`, '__not_a_file__',
  ], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
})

test('the preflight rejects effective configuration overrides without making requests', () => {
  for (const [overrides, message] of [
    [{ npm_config_registry: 'https://example.invalid/' }, /effective npm registry/],
    [{ 'npm_config_@outside:registry': 'https://example.invalid/' }, /@outside:registry/],
    [{ npm_config_replace_registry_host: 'always' }, /replace-registry-host/],
    [{ npm_config_package_lock: 'false' }, /package-lock/],
  ] as const) {
    const result = runVerifier(overrides)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, message)
    assert.doesNotMatch(result.stderr, /example\.invalid/)
  }
})

test('the preflight fails closed when npm configuration cannot be read', () => {
  const result = runVerifier({ PATH: '' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Could not read effective npm configuration/)
})

test('CI tests and runs the feed preflight before installing dependencies', () => {
  const workflow = read('../.github/workflows/ci-cd.yml').replace(/\r\n/g, '\n')
  const build = workflow.split('\n  infrastructure:')[0]
  const setup = build.indexOf('uses: actions/setup-node@')
  const tests = build.indexOf('run: node --experimental-strip-types --test tests/npm-feed.test.ts')
  const verify = build.indexOf('run: node scripts/verify-npm-feed.mjs')
  const install = build.indexOf('run: npm ci')
  assert.ok(setup >= 0 && setup < tests && tests < verify && verify < install)
})
