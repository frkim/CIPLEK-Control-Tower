import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const APPROVED_REGISTRY = 'https://packagefeedproxy.microsoft.io/npm/'

const root = fileURLToPath(new URL('../', import.meta.url))
const approved = new URL(APPROVED_REGISTRY)
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function isApprovedUrl(value, registry = false) {
  if (typeof value !== 'string' || /[\s\\?#]/u.test(value)) return false

  let url
  let path
  try {
    url = new URL(value)
    path = decodeURIComponent(url.pathname)
  } catch {
    return false
  }

  if (url.origin !== approved.origin || url.username || url.password
    || /[\s\\]/u.test(path) || /%[\da-f]{2}/i.test(path)
    || path.split('/').some((segment) => segment === '.' || segment === '..')) return false

  if (registry) return path === '/npm' || path === '/npm/'
  return url.pathname.startsWith('/npm/') && path.startsWith('/npm/') && path.length > '/npm/'.length
}

export function validateNpmConfig(config) {
  if (!isRecord(config)) return ['Could not read the effective npm configuration']

  const errors = []
  if (!isApprovedUrl(config.registry, true)) {
    errors.push(`The effective npm registry must be ${APPROVED_REGISTRY}`)
  }
  for (const [key, value] of Object.entries(config)) {
    if (/^@[^:]+:registry$/i.test(key) && !isApprovedUrl(value, true)) {
      errors.push(`Scoped npm registry ${key} must be ${APPROVED_REGISTRY}`)
    }
  }
  if (config['replace-registry-host'] !== 'never') {
    errors.push('npm replace-registry-host must be set to never')
  }
  if (config['package-lock'] !== true) {
    errors.push('npm package-lock must be enabled')
  }
  return errors
}

function isDeclaredBundle(packages, location) {
  const separator = '/node_modules/'
  for (let index = location.indexOf(separator); index !== -1; index = location.indexOf(separator, index + separator.length)) {
    const parent = packages[location.slice(0, index)]
    const child = location.slice(index + separator.length).split(separator)[0]
    if (isRecord(parent) && Object.hasOwn(parent, 'resolved')
      && (parent.bundleDependencies === true
        || (Array.isArray(parent.bundleDependencies) && parent.bundleDependencies.includes(child)))) return true
  }
  return false
}

export function validateLockfile(lockfile, hasShrinkwrap = false) {
  const errors = hasShrinkwrap ? ['npm-shrinkwrap.json would override the checked package-lock.json'] : []
  let checked = 0
  if (!isRecord(lockfile) || lockfile.lockfileVersion !== 3
    || !isRecord(lockfile.packages) || !isRecord(lockfile.packages[''])) {
    errors.push('package-lock.json must contain a version 3 packages map and root package')
    return { errors, checked }
  }

  const checkResolved = (location, value) => {
    checked += 1
    if (!isApprovedUrl(value)) {
      errors.push(`${location}: resolved source must be under ${APPROVED_REGISTRY}`)
    }
  }

  for (const [location, entry] of Object.entries(lockfile.packages)) {
    const label = location || '<root>'
    if (!isRecord(entry)) {
      errors.push(`${label}: invalid package entry`)
    } else if (Object.hasOwn(entry, 'resolved')) {
      checkResolved(label, entry.resolved)
    } else if (location && !(entry.inBundle === true && isDeclaredBundle(lockfile.packages, location))) {
      errors.push(`${label}: missing resolved source`)
    }
  }

  const checkLegacyDependencies = (dependencies, parent = 'dependencies') => {
    if (!isRecord(dependencies)) {
      errors.push(`${parent}: invalid dependency map`)
      return
    }
    for (const [name, entry] of Object.entries(dependencies)) {
      const location = `${parent}.${name}`
      if (!isRecord(entry)) {
        errors.push(`${location}: invalid dependency entry`)
        continue
      }
      if (Object.hasOwn(entry, 'resolved')) checkResolved(location, entry.resolved)
      if (Object.hasOwn(entry, 'dependencies')) checkLegacyDependencies(entry.dependencies, location)
    }
  }
  if (Object.hasOwn(lockfile, 'dependencies')) checkLegacyDependencies(lockfile.dependencies)

  return { errors, checked }
}

function readEffectiveNpmConfig() {
  const options = { cwd: root, encoding: 'utf8' }
  const result = process.platform === 'win32'
    ? spawnSync('npm --offline --no-update-notifier --logs-max=0 config list --json', { ...options, shell: true })
    : spawnSync('npm', ['--offline', '--no-update-notifier', '--logs-max=0', 'config', 'list', '--json'], options)
  if (result.error || result.status !== 0) {
    throw new Error('Could not read effective npm configuration with npm config list --json')
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error('npm config list --json did not return valid JSON')
  }
}

function main() {
  try {
    const config = readEffectiveNpmConfig()
    let lockfile
    try {
      lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
    } catch {
      throw new Error('Could not read a valid package-lock.json')
    }
    const { errors: lockErrors, checked } = validateLockfile(
      lockfile,
      existsSync(new URL('../npm-shrinkwrap.json', import.meta.url)),
    )
    const errors = [...validateNpmConfig(config), ...lockErrors]
    if (errors.length) {
      console.error(`npm feed verification failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
      process.exitCode = 1
      return
    }
    console.log(`Verified npm configuration and ${checked} locked sources against ${APPROVED_REGISTRY}`)
  } catch (error) {
    console.error(`npm feed verification failed: ${error.message}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main()
