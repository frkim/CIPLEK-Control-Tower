import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import {
  readFile as readFileFromDisk,
  readdir as readDirectoryFromDisk,
  realpath as realpathOnDisk,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = fileURLToPath(new URL('../', import.meta.url))
const javascriptTypes = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
])
const contentTypes = new Map([
  ['html', new Set(['text/html'])],
  ['css', new Set(['text/css'])],
  ['svg', new Set(['image/svg+xml'])],
  ['png', new Set(['image/png'])],
  ['jpg', new Set(['image/jpeg'])],
  ['jpeg', new Set(['image/jpeg'])],
  ['gif', new Set(['image/gif'])],
  ['webp', new Set(['image/webp'])],
  ['avif', new Set(['image/avif'])],
  ['ico', new Set(['image/vnd.microsoft.icon', 'image/x-icon'])],
  ['woff', new Set(['font/woff', 'application/font-woff'])],
  ['woff2', new Set(['font/woff2'])],
  ['wasm', new Set(['application/wasm'])],
])
const upgradeStatuses = new Set([301, 302, 303, 307, 308])

export const DEFAULT_REQUEST_OPTIONS = Object.freeze({
  retries: 12,
  retryDelayMs: 5_000,
  timeoutMs: 30_000,
})

class VerificationError extends Error {}
class RetryableValidationError extends VerificationError {}
class RequestTimeoutError extends Error {}
class HttpStatusError extends Error {
  constructor(status) {
    super()
    this.status = status
  }
}

export function validateAppUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new VerificationError('APP_URL is required and must be an absolute HTTPS URL')
  }
  if (!/^https:\/\//i.test(value) || /[\s\\]/u.test(value)) {
    throw new VerificationError('APP_URL must be an absolute HTTPS URL')
  }
  if (/[?#]/u.test(value)) {
    throw new VerificationError('APP_URL must not contain a query string or fragment')
  }
  if (/^https:\/\/[^/]*@/i.test(value)) {
    throw new VerificationError('APP_URL must not contain credentials')
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new VerificationError('APP_URL must be a valid absolute HTTPS URL')
  }
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new VerificationError('APP_URL must be an absolute HTTPS URL')
  }
  if (url.username || url.password) {
    throw new VerificationError('APP_URL must not contain credentials')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function validateHttpProbeUrl(value, baseUrl) {
  if (value === undefined) {
    const url = new URL(baseUrl)
    url.protocol = 'http:'
    return url
  }
  if (typeof value !== 'string' || !/^http:\/\//i.test(value)
    || /[\p{Cc}\s\\?#]/u.test(value) || /^http:\/\/[^/]*@/i.test(value)) {
    throw new VerificationError('APP_HTTP_URL must be an absolute HTTP URL without credentials, a query, or a fragment')
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new VerificationError('APP_HTTP_URL must be a valid absolute HTTP URL')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password
    || url.hostname !== baseUrl.hostname || url.pathname !== baseUrl.pathname) {
    throw new VerificationError('APP_HTTP_URL must use the same hostname and path as APP_URL')
  }
  return url
}

const characterReferences = new Map([
  ['amp', '&'], ['apos', "'"], ['bsol', '\\'], ['colon', ':'],
  ['equals', '='], ['gt', '>'], ['lt', '<'], ['NewLine', '\n'],
  ['num', '#'], ['percnt', '%'], ['period', '.'], ['quest', '?'],
  ['quot', '"'], ['semi', ';'], ['sol', '/'], ['Tab', '\t'],
])

function decodeAttribute(value) {
  let unsupported = false
  const decoded = value.replace(
    /&(?:#x([0-9a-f]+);?|#([0-9]+);?|([a-z][a-z0-9]+);)/gi,
    (reference, hexadecimal, decimal, name) => {
      if (name) {
        if (characterReferences.has(name)) return characterReferences.get(name)
        unsupported = true
        return reference
      }
      const codePoint = Number.parseInt(hexadecimal ?? decimal, hexadecimal ? 16 : 10)
      if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        unsupported = true
        return reference
      }
      return String.fromCodePoint(codePoint)
    },
  )
  return { value: decoded.replace(/[\t\r\n]/gu, '').trim(), unsupported }
}

function decodedAssetPath(rawPath) {
  let decoded
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    throw new VerificationError('Invalid encoding in an /assets/ path in dist/index.html')
  }

  const segments = decoded.slice(1).split('/')
  if (!decoded.startsWith('/assets/') || segments.length < 2
    || segments.some((segment) => !segment || segment === '.' || segment === '..'
      || /[\p{Cc}\\<>:"|?*%]/u.test(segment)
      || /[. ]$/u.test(segment)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) {
    throw new VerificationError('Unsafe /assets/ path in dist/index.html')
  }
  return decoded
}

function referencedAsset(value) {
  const decoded = decodeAttribute(value)
  if (!decoded.value.startsWith('/assets/')) return null
  if (decoded.unsupported) {
    throw new VerificationError('Unsupported HTML character reference in an /assets/ URL')
  }

  const hashIndex = decoded.value.indexOf('#')
  const requestPath = hashIndex === -1 ? decoded.value : decoded.value.slice(0, hashIndex)
  const queryIndex = requestPath.indexOf('?')
  const rawPath = queryIndex === -1 ? requestPath : requestPath.slice(0, queryIndex)
  const pathname = decodedAssetPath(rawPath)
  const extension = /\.(js|css)$/iu.exec(pathname)?.[1].toLowerCase()
  return extension ? { pathname, requestPath, kind: extension } : null
}

export function discoverBuildAssets(indexHtml) {
  let html
  try {
    html = typeof indexHtml === 'string'
      ? indexHtml
      : new TextDecoder('utf-8', { fatal: true }).decode(indexHtml)
  } catch {
    throw new VerificationError('dist/index.html must contain valid UTF-8')
  }

  const tags = /<!--[\s\S]*?(?:-->|$)|<([a-z][a-z0-9:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi
  const assets = []
  const seen = new Set()
  let tag
  while ((tag = tags.exec(html)) !== null) {
    if (!tag[1]) continue
    const attributes = tag[0].slice(tag[1].length + 1, -1)
    const attributePattern = /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`<>]+)))?/gu
    for (const attribute of attributes.matchAll(attributePattern)) {
      if (!/^(?:src|href)$/iu.test(attribute[1])) continue
      const asset = referencedAsset(attribute[2] ?? attribute[3] ?? attribute[4] ?? '')
      if (asset && !seen.has(asset.requestPath)) {
        seen.add(asset.requestPath)
        assets.push(asset)
      }
    }

    if (/^(?:script|style|textarea|title|xmp|iframe|noembed|noframes)$/iu.test(tag[1])) {
      const closingTag = new RegExp(`<\\/${tag[1]}\\s*>`, 'gi')
      closingTag.lastIndex = tags.lastIndex
      const closing = closingTag.exec(html)
      tags.lastIndex = closing ? closingTag.lastIndex : html.length
    }
  }
  if (assets.length === 0) {
    throw new VerificationError('dist/index.html references no /assets/ JavaScript or CSS build assets')
  }
  return assets
}

function isWithin(directory, file) {
  const relative = path.relative(directory, file)
  return relative !== '' && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function resolveCheckedAssetPath(distDirectory, pathname) {
  const safePath = pathname === '/theme.js' || pathname === '/favicon.svg'
    ? pathname
    : decodedAssetPath(pathname)
  const directory = path.resolve(distDirectory)
  const file = path.resolve(directory, ...safePath.slice(1).split('/'))
  if (!isWithin(directory, file)) throw new VerificationError('Asset path escapes dist')
  return file
}

function safeErrorCode(error) {
  const code = error?.cause?.code ?? error?.code
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/u.test(code) ? ` (${code})` : ''
}

async function loadCheckedFile(file, label, distRoot, realpath, readFile) {
  let canonical
  try {
    canonical = await realpath(file)
  } catch (error) {
    throw new VerificationError(`Cannot resolve checked ${label}${safeErrorCode(error)}`)
  }
  if (!isWithin(distRoot, canonical)) {
    throw new VerificationError(`Checked ${label} resolves outside dist`)
  }
  try {
    return Buffer.from(await readFile(canonical))
  } catch (error) {
    throw new VerificationError(`Cannot read checked ${label}${safeErrorCode(error)}`)
  }
}

async function loadGlobalHeaders(projectRoot, readFile) {
  let config
  try {
    config = JSON.parse(await readFile(path.join(projectRoot, 'public', 'staticwebapp.config.json'), 'utf8'))
  } catch {
    throw new VerificationError('Cannot read valid public/staticwebapp.config.json')
  }
  const headers = config?.globalHeaders
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length === 0) {
    throw new VerificationError('public/staticwebapp.config.json must configure globalHeaders')
  }
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu.test(name)
      || typeof value !== 'string' || value.trim() === '' || /[\r\n]/u.test(value)) {
      throw new VerificationError('public/staticwebapp.config.json contains an invalid global header')
    }
  }
  return headers
}

async function discoverBundledAssets(distDirectory, distRoot, realpath, readDirectory) {
  const assetDirectory = path.join(distDirectory, 'assets')
  let canonical
  try {
    canonical = await realpath(assetDirectory)
  } catch (error) {
    throw new VerificationError(`Cannot resolve checked assets directory${safeErrorCode(error)}`)
  }
  if (!isWithin(distRoot, canonical)) {
    throw new VerificationError('Checked assets directory resolves outside dist')
  }

  const assets = []
  async function visit(directory, segments) {
    let entries
    try {
      entries = await readDirectory(directory, { withFileTypes: true })
    } catch (error) {
      throw new VerificationError(`Cannot read checked assets directory${safeErrorCode(error)}`)
    }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      const parts = [...segments, entry.name]
      const pathname = `/assets/${parts.join('/')}`
      if (decodedAssetPath(pathname) !== pathname || entry.isSymbolicLink()) {
        throw new VerificationError('Unsafe entry in checked assets directory')
      }
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), parts)
      } else if (entry.isFile()) {
        assets.push({
          pathname,
          requestPath: `/assets/${parts.map(encodeURIComponent).join('/')}`,
          kind: path.extname(entry.name).slice(1).toLowerCase(),
        })
      } else {
        throw new VerificationError('Unsupported entry in checked assets directory')
      }
    }
  }
  await visit(assetDirectory, [])
  return assets
}

function discardBody(body) {
  try {
    if (body && typeof body.cancel === 'function') Promise.resolve(body.cancel()).catch(() => {})
  } catch {
    // A failed cancellation must not hide the HTTP error.
  }
}

async function readBoundedBody(response, limit, signal) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = Buffer.from(await response.arrayBuffer())
    return body.length > limit ? { tooLarge: true } : { body }
  }
  const reader = response.body.getReader()
  const cancel = () => {
    try {
      Promise.resolve(reader.cancel()).catch(() => {})
    } catch {
      // The reader may already have completed.
    }
  }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw new RequestTimeoutError()
      if (done) return { body: Buffer.concat(chunks, length) }
      length += value.byteLength
      if (length > limit) {
        cancel()
        return { tooLarge: true }
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

async function requestAttempt(url, request, settings) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new RequestTimeoutError()
      reject(error)
      controller.abort(error)
    }, settings.timeoutMs)
  })
  const work = (async () => {
    const response = await settings.fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: request.accept ? { Accept: request.accept } : {},
      signal: controller.signal,
    })
    if (!response || !Number.isInteger(response.status) || response.status < 100
      || response.status > 599 || typeof response.headers?.get !== 'function') {
      throw new VerificationError(`${request.label}: invalid HTTP response`)
    }
    if (response.status >= 300 && response.status < 400) {
      discardBody(response.body)
      if (request.expectUpgrade && upgradeStatuses.has(response.status)) {
        return { headers: response.headers }
      }
      throw new VerificationError(`${request.label}: HTTP ${response.status} redirect is not followed`)
    }
    if (response.status !== request.expectedStatus) {
      discardBody(response.body)
      throw new HttpStatusError(response.status)
    }
    return {
      headers: response.headers,
      ...await readBoundedBody(response, request.maxBytes, controller.signal),
    }
  })()

  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function requestWithRetry(url, request, settings) {
  for (let attempt = 1; attempt <= settings.retries + 1; attempt += 1) {
    let response
    try {
      response = await requestAttempt(url, request, settings)
    } catch (error) {
      if (error instanceof VerificationError) throw error
      const retryable = !(error instanceof HttpStatusError) || error.status >= 400
      if (!retryable || attempt > settings.retries) {
        const reason = error instanceof HttpStatusError
          ? `HTTP ${error.status} (expected ${request.expectedStatus})`
          : error instanceof RequestTimeoutError
            ? `timed out after ${settings.timeoutMs} ms`
            : `network request failed${safeErrorCode(error)}`
        const attempts = attempt > 1 ? ` after ${attempt} attempts` : ''
        throw new VerificationError(`${request.label}: ${reason}${attempts}`)
      }
      await settings.sleep(settings.retryDelayMs)
      continue
    }

    try {
      if (request.validate) request.validate(response)
    } catch (error) {
      if (!(error instanceof RetryableValidationError)) throw error
      if (attempt > settings.retries) {
        const attempts = attempt > 1 ? ` after ${attempt} attempts` : ''
        throw new VerificationError(`${error.message}${attempts}`)
      }
      await settings.sleep(settings.retryDelayMs)
      continue
    }
    return response
  }
}

function checkContentType(headers, kind, label) {
  const contentType = headers.get('content-type')
  const essence = contentType?.split(';', 1)[0].trim().toLowerCase()
  const valid = kind === 'js' || kind === 'mjs'
    ? javascriptTypes.has(essence)
    : contentTypes.get(kind)?.has(essence) ?? Boolean(essence && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(essence))
  if (!valid) {
    const actual = essence && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(essence) ? essence : 'missing or invalid'
    throw new RetryableValidationError(`${label}: invalid Content-Type (${actual}) for ${kind || 'asset'}`)
  }
}

function checkBytes(response, expected, label) {
  if (response.tooLarge || !response.body.equals(expected)) {
    throw new RetryableValidationError(`${label}: live bytes differ from the checked file`)
  }
}

function checkGlobalHeaders(headers, expected, label) {
  for (const [name, value] of Object.entries(expected)) {
    const actual = headers.get(name)
    if (actual === null) throw new RetryableValidationError(`${label}: missing security header ${name}`)
    if (actual.trim() !== value.trim()) {
      throw new RetryableValidationError(`${label}: security header ${name} differs from the configured value`)
    }
  }
}

function checkHttpUpgrade(headers, targetUrl, label) {
  const location = headers.get('location')
  if (!location || /[\p{Cc}\s\\]/u.test(location)) {
    throw new VerificationError(`${label}: missing or invalid Location header`)
  }
  if (!/^https:\/\/[^/?#]+/iu.test(location) || /^https:\/\/[^/?#]*@/iu.test(location)) {
    throw new VerificationError(`${label}: Location does not match the verified HTTPS URL`)
  }
  let target
  try {
    target = new URL(location)
  } catch {
    throw new VerificationError(`${label}: missing or invalid Location header`)
  }
  if (target.href !== targetUrl.href) {
    throw new VerificationError(`${label}: Location does not match the verified HTTPS URL`)
  }
}

function httpUrlForTarget(probeUrl, targetUrl) {
  const url = new URL(targetUrl)
  url.protocol = 'http:'
  url.port = probeUrl.port
  return url
}

async function missingAssetProbe(distDirectory, realpath, makeId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = makeId()
    if (typeof id !== 'string' || !/^[a-z0-9_-]{1,128}$/iu.test(id)) {
      throw new VerificationError('Cannot generate a safe missing-asset probe')
    }
    const pathname = `/assets/__live_deployment_missing_${id}.js`
    try {
      await realpath(resolveCheckedAssetPath(distDirectory, pathname))
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { id, pathname }
      throw new VerificationError(`Cannot check the missing-asset probe${safeErrorCode(error)}`)
    }
  }
  throw new VerificationError('Cannot select a missing asset that is absent from dist')
}

export async function verifyDeployment({
  appUrl,
  httpUrl,
  projectRoot = projectDirectory,
  fetchImpl = globalThis.fetch,
  readFile = readFileFromDisk,
  readDirectory = readDirectoryFromDisk,
  realpath = realpathOnDisk,
  retries = DEFAULT_REQUEST_OPTIONS.retries,
  retryDelayMs = DEFAULT_REQUEST_OPTIONS.retryDelayMs,
  timeoutMs = DEFAULT_REQUEST_OPTIONS.timeoutMs,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  makeId = randomUUID,
} = {}) {
  const baseUrl = validateAppUrl(appUrl)
  const probeUrl = validateHttpProbeUrl(httpUrl, baseUrl)
  if (!Number.isSafeInteger(retries) || retries < 0
    || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
    || typeof fetchImpl !== 'function' || typeof readFile !== 'function'
    || typeof readDirectory !== 'function' || typeof realpath !== 'function'
    || typeof sleep !== 'function' || typeof makeId !== 'function') {
    throw new VerificationError('Invalid verifier configuration')
  }

  const distDirectory = path.resolve(projectRoot, 'dist')
  let distRoot
  try {
    distRoot = await realpath(distDirectory)
  } catch (error) {
    throw new VerificationError(`Cannot resolve checked dist directory${safeErrorCode(error)}`)
  }
  const index = await loadCheckedFile(path.join(distDirectory, 'index.html'), 'dist/index.html', distRoot, realpath, readFile)
  const headers = await loadGlobalHeaders(projectRoot, readFile)
  const buildAssets = discoverBuildAssets(index)
  const referencedPaths = new Set(buildAssets.map((asset) => asset.pathname))
  const bundledAssets = await discoverBundledAssets(distDirectory, distRoot, realpath, readDirectory)
  buildAssets.push(...bundledAssets.filter((asset) => !referencedPaths.has(asset.pathname)))
  const assets = [
    ...buildAssets,
    { pathname: '/theme.js', requestPath: '/theme.js', kind: 'js' },
    { pathname: '/favicon.svg', requestPath: '/favicon.svg', kind: 'svg' },
  ]
  for (const asset of assets) {
    asset.bytes = await loadCheckedFile(
      resolveCheckedAssetPath(distDirectory, asset.pathname),
      `asset ${asset.pathname}`,
      distRoot,
      realpath,
      readFile,
    )
  }
  const probe = await missingAssetProbe(distDirectory, realpath, makeId)
  const settings = { fetchImpl, retries, retryDelayMs, timeoutMs, sleep }
  const upgradeTargets = [{ url: baseUrl, label: 'Root document', accept: 'text/html' }]

  await requestWithRetry(baseUrl.href, {
    label: 'Root document', expectedStatus: 200, maxBytes: index.length, accept: 'text/html',
    validate(response) {
      checkContentType(response.headers, 'html', 'Root document')
      checkGlobalHeaders(response.headers, headers, 'Root document')
      checkBytes(response, index, 'Root document')
    },
  }, settings)

  for (const asset of assets) {
    const label = `Asset ${asset.pathname}`
    const url = new URL(asset.requestPath, baseUrl)
    await requestWithRetry(url.href, {
      label, expectedStatus: 200, maxBytes: asset.bytes.length,
      validate(response) {
        checkContentType(response.headers, asset.kind, label)
        checkGlobalHeaders(response.headers, headers, label)
        checkBytes(response, asset.bytes, label)
      },
    }, settings)
    upgradeTargets.push({ url, label })
  }

  const fallbackUrl = new URL(`__live_deployment_verifier_${probe.id}/navigation`, baseUrl)
  await requestWithRetry(
    fallbackUrl.href,
    {
      label: 'Navigation fallback', expectedStatus: 200, maxBytes: index.length, accept: 'text/html',
      validate(response) {
        checkContentType(response.headers, 'html', 'Navigation fallback')
        checkGlobalHeaders(response.headers, headers, 'Navigation fallback')
        checkBytes(response, index, 'Navigation fallback')
      },
    },
    settings,
  )
  upgradeTargets.push({ url: fallbackUrl, label: 'Navigation fallback', accept: 'text/html' })

  const missingUrl = new URL(probe.pathname, baseUrl)
  await requestWithRetry(missingUrl.href, {
    label: 'Missing asset probe', expectedStatus: 404, maxBytes: index.length, accept: 'text/html',
    validate(response) {
      checkGlobalHeaders(response.headers, headers, 'Missing asset probe')
      if (!response.tooLarge && response.body.equals(index)) {
        throw new RetryableValidationError('Missing asset probe: HTTP 404 returned the SPA index HTML')
      }
    },
  }, settings)
  upgradeTargets.push({ url: missingUrl, label: 'Missing asset probe', accept: 'text/html' })
  for (const target of upgradeTargets) {
    const label = `HTTP-to-HTTPS redirect for ${target.label}`
    const upgrade = await requestWithRetry(httpUrlForTarget(probeUrl, target.url).href, {
      label, expectUpgrade: true, expectedStatus: '301, 302, 303, 307, or 308',
      accept: target.accept,
    }, settings)
    checkHttpUpgrade(upgrade.headers, target.url, label)
  }
  return { buildAssets: buildAssets.length, checkedAssets: assets.length }
}

async function main() {
  try {
    const result = await verifyDeployment({
      appUrl: process.env.APP_URL,
      httpUrl: process.env.APP_HTTP_URL,
    })
    console.log(`Verified live deployment: HTML, ${result.buildAssets} build assets, theme.js, favicon.svg, security headers, navigation fallback, missing-asset 404, and HTTP-to-HTTPS redirects`)
  } catch (error) {
    const message = error instanceof VerificationError ? error.message : 'Unexpected internal error'
    console.error(`Live deployment verification failed: ${message}`)
    process.exitCode = 1
  }
}

let invokedDirectly = false
try {
  invokedDirectly = Boolean(process.argv[1])
    && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
} catch {
  // Importing the module must not execute the CLI.
}
if (invokedDirectly) await main()
