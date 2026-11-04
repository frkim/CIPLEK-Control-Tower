import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DEFAULT_REQUEST_OPTIONS,
  discoverBuildAssets,
  resolveCheckedAssetPath,
  validateAppUrl,
  verifyDeployment,
} from '../scripts/verify-live-deployment.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const script = fileURLToPath(new URL('../scripts/verify-live-deployment.mjs', import.meta.url))
const globalHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'",
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}
const html = Buffer.from([
  '<!doctype html>\r\n',
  '<html lang="fr">\n',
  '<!-- <script src="/assets/commented.js"></script> -->\r\n',
  '<script>window.note = \'<script src="/assets/inline.js">\';</script>\n',
  '<script src="/theme.js"></script>\r\n',
  '<script type=module src=/assets/app.js></script>\n',
  '<link rel=modulepreload href=\'/assets/chunks/vendor.js\'>\r\n',
  '<link rel=stylesheet href=/assets/main.css?mode=1&amp;cache=2>\n',
  '<link href="/assets/main.css?mode=1&amp;cache=2" rel=stylesheet>\r\n',
  '<body>Livraison é</body>\n</html>\r\n',
].join(''))

type Route = {
  body: string | Buffer | null
  status?: number
  headers: Record<string, string>
}

const httpsRequestKeys = [
  'root', 'app', 'vendor', 'css', 'theme', 'favicon', 'fallback', 'missing',
]
const matchingHttpsLocation = '__matching_https_location__'

function missingFile() {
  return Object.assign(new Error('File does not exist'), { code: 'ENOENT' })
}

function fixture(basePath = '/', origins: { app?: string, http?: string } = {}) {
  const appUrl = `${origins.app ?? 'https://fixture.invalid'}${basePath}`
  const normalizedAppUrl = new URL(appUrl)
  if (!normalizedAppUrl.pathname.endsWith('/')) normalizedAppUrl.pathname += '/'
  const rootPath = normalizedAppUrl.pathname
  const defaultHttpUrl = new URL(normalizedAppUrl.href)
  defaultHttpUrl.protocol = 'http:'
  const httpOrigin = new URL(origins.http ?? defaultHttpUrl.origin).origin
  const expectedHttpUrl = new URL(rootPath, httpOrigin).href
  const dist = path.resolve(projectRoot, 'dist')
  const paths = {
    index: path.join(dist, 'index.html'),
    app: path.join(dist, 'assets', 'app.js'),
    vendor: path.join(dist, 'assets', 'chunks', 'vendor.js'),
    css: path.join(dist, 'assets', 'main.css'),
    theme: path.join(dist, 'theme.js'),
    favicon: path.join(dist, 'favicon.svg'),
    config: path.join(projectRoot, 'public', 'staticwebapp.config.json'),
  }
  const files = new Map([
    [paths.index, html],
    [paths.app, Buffer.from('export const app = true;\n')],
    [paths.vendor, Buffer.from('export const vendor = 1;\n')],
    [paths.css, Buffer.from('body { color: teal; }\n')],
    [paths.theme, Buffer.from('window.theme = "dark";\n')],
    [paths.favicon, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    [paths.config, Buffer.from(JSON.stringify({ globalHeaders }))],
  ])
  const htmlHeaders = { ...globalHeaders, 'Content-Type': 'text/html; charset=UTF-8' }
  const routes = new Map<string, Route>([
    ['root', { body: html, headers: { ...htmlHeaders } }],
    ['app', { body: files.get(paths.app)!, headers: { ...globalHeaders, 'Content-Type': 'text/javascript; charset=utf-8' } }],
    ['vendor', { body: files.get(paths.vendor)!, headers: { ...globalHeaders, 'Content-Type': 'application/javascript' } }],
    ['css', { body: files.get(paths.css)!, headers: { ...globalHeaders, 'Content-Type': 'text/css; charset=UTF-8' } }],
    ['theme', { body: files.get(paths.theme)!, headers: { ...globalHeaders, 'Content-Type': 'application/x-javascript' } }],
    ['favicon', { body: files.get(paths.favicon)!, headers: { ...globalHeaders, 'Content-Type': 'image/svg+xml' } }],
    ['fallback', { body: html, headers: { ...htmlHeaders } }],
    ['missing', { status: 404, body: 'Not found', headers: { ...globalHeaders, 'Content-Type': 'text/plain' } }],
  ])
  const httpRoutes = new Map<string, Route>()
  const httpRoute = (key: string, query?: string) => {
    const routeKey = query === undefined ? key : `${key}${query}`
    if (!httpRoutes.has(routeKey)) {
      httpRoutes.set(routeKey, { status: 308, body: null, headers: { Location: matchingHttpsLocation } })
    }
    return httpRoutes.get(routeKey)!
  }
  const requests: {
    key: string, url: URL, method: string, redirect: RequestRedirect | undefined,
    accept: string | null, signal: AbortSignal,
  }[] = []
  const reads: string[] = []
  const realpathOverrides = new Map<string, string>()
  const sleeps: number[] = []

  const readFile = async (name: string, encoding?: string) => {
    const file = path.resolve(name)
    reads.push(file)
    const bytes = files.get(file)
    if (!bytes) throw missingFile()
    return encoding === 'utf8' ? bytes.toString('utf8') : Buffer.from(bytes)
  }
  const realpath = async (name: string) => {
    const file = path.resolve(name)
    if (realpathOverrides.has(file)) return realpathOverrides.get(file)!
    if (file === dist || files.has(file)
      || [...files.keys()].some((candidate) => candidate.startsWith(`${file}${path.sep}`))) return file
    throw missingFile()
  }
  const readDirectory = async (name: string, options: { withFileTypes: boolean }) => {
    assert.deepEqual(options, { withFileTypes: true })
    const directory = path.resolve(name)
    const entries = new Map<string, boolean>()
    for (const file of files.keys()) {
      const relative = path.relative(directory, file)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
      const [child, ...rest] = relative.split(path.sep)
      entries.set(child, rest.length > 0)
    }
    if (entries.size === 0) throw missingFile()
    return [...entries].map(([child, isDirectory]) => ({
      name: child,
      isDirectory: () => isDirectory,
      isFile: () => !isDirectory,
      isSymbolicLink: () => false,
    }))
  }
  const fetchImpl = async (input: string, options: RequestInit) => {
    const url = new URL(input)
    let resource: string
    if (url.pathname === rootPath) resource = 'root'
    else if (url.pathname.startsWith(`${rootPath}__live_deployment_verifier_`)
      && url.pathname.endsWith('/navigation')) resource = 'fallback'
    else if (/^\/assets\/__live_deployment_missing_[a-z0-9_-]+\.js$/iu.test(url.pathname)) resource = 'missing'
    else if (url.pathname === '/assets/app.js') resource = 'app'
    else if (url.pathname === '/assets/chunks/vendor.js') resource = 'vendor'
    else if (url.pathname === '/assets/main.css') resource = 'css'
    else if (url.pathname === '/assets/chunks/lazy.js') resource = 'lazy'
    else if (url.pathname === '/assets/logo.png') resource = 'logo'
    else if (url.pathname === '/assets/special.constructor') resource = 'special'
    else if (url.pathname === '/theme.js') resource = 'theme'
    else if (url.pathname === '/favicon.svg') resource = 'favicon'
    else resource = 'unexpected'
    const isHttp = url.protocol === 'http:'
    const key = isHttp ? `http:${resource}` : resource
    requests.push({
      key, url, method: (options.method ?? 'GET').toUpperCase(), redirect: options.redirect,
      accept: new Headers(options.headers).get('accept'), signal: options.signal!,
    })
    assert.equal((options.method ?? 'GET').toUpperCase(), 'GET')
    assert.equal(options.redirect, 'manual')
    assert.equal(url.origin, isHttp ? httpOrigin : normalizedAppUrl.origin, 'Unexpected network destination')
    assert.notEqual(resource, 'unexpected', 'Unexpected fake request')
    const queryStart = url.href.indexOf('?')
    const query = queryStart === -1 ? '' : url.href.slice(queryStart)
    const response = isHttp
      ? httpRoutes.get(`${resource}${query}`) ?? httpRoute(resource)
      : routes.get(resource)
    assert.ok(response, `No response configured for ${key}`)
    const headers = { ...response.headers }
    if (isHttp && headers.Location === matchingHttpsLocation) {
      const location = new URL(url.href)
      location.protocol = 'https:'
      location.port = normalizedAppUrl.port
      headers.Location = location.href
    }
    return new Response(response.body, { status: response.status ?? 200, headers })
  }
  const run = (overrides: Record<string, unknown> = {}) => verifyDeployment({
    appUrl,
    readFile,
    readDirectory,
    realpath,
    fetchImpl,
    retries: 2,
    retryDelayMs: 0,
    timeoutMs: 250,
    sleep: async (milliseconds: number) => { sleeps.push(milliseconds) },
    makeId: () => 'fixture',
    ...overrides,
  })
  const route = (key: string) => {
    const response = routes.get(key)
    assert.ok(response)
    return response
  }
  return {
    dist, paths, files, routes, route, httpRoute, requests, reads, realpathOverrides, sleeps,
    expectedHttpUrl, fetchImpl, readDirectory, run,
  }
}

function assertHttpProbeRequests(
  f: ReturnType<typeof fixture>,
  {
    httpsKeys = httpsRequestKeys,
    httpsIndices = httpsKeys.map((_, index) => index),
    httpIndices = httpsKeys.map((_, index) => index),
  }: { httpsKeys?: string[], httpsIndices?: number[], httpIndices?: number[] } = {},
) {
  assert.deepEqual(f.requests.map(({ key }) => key), [
    ...httpsIndices.map((index) => httpsKeys[index]),
    ...httpIndices.map((index) => `http:${httpsKeys[index]}`),
  ])
  for (const [position, index] of httpIndices.entries()) {
    const secureIndex = httpsIndices.lastIndexOf(index)
    assert.notEqual(secureIndex, -1)
    const secure = f.requests[secureIndex]
    const request = f.requests[httpsIndices.length + position]
    const expected = new URL(secure.url.href)
    expected.protocol = 'http:'
    expected.port = new URL(f.expectedHttpUrl).port
    assert.equal(request.url.href, expected.href)
    assert.equal(request.method, 'GET')
    assert.equal(request.redirect, 'manual')
    if (secure.key === 'root') assert.equal(request.accept, 'text/html')
  }
}

function assertStoppedAfterHttpsAttempts(
  f: ReturnType<typeof fixture>, key: string, httpsKeys = httpsRequestKeys,
) {
  const index = httpsKeys.indexOf(key)
  assert.notEqual(index, -1)
  assert.deepEqual(f.requests.map((request) => request.key), [
    ...httpsKeys.slice(0, index), key, key, key,
  ])
  assert.deepEqual(f.sleeps, [7, 7])
}

function assertSanitizedError(error: unknown, sensitive: RegExp) {
  assert.ok(error instanceof Error)
  assert.doesNotMatch(error.message, sensitive)
  assert.doesNotMatch(error.stack ?? '', sensitive)
  return true
}

function fixtureWithAssetQueries() {
  const f = fixture('/subsite', {
    app: 'https://fixture.invalid:8443', http: 'http://fixture.invalid:8080',
  })
  const index = Buffer.from(html.toString('utf8').replace(
    '<script type=module src=/assets/app.js></script>',
    [
      '<script type=module src=/assets/app.js></script>',
      '<script src="/assets/app.js?"></script>',
      '<script src="/assets/app.js?v=1&amp;x=2"></script>',
    ].join('\n'),
  ))
  f.files.set(f.paths.index, index)
  f.route('root').body = index
  f.route('fallback').body = index
  return f
}

test('verifies exact bytes, all referenced assets, headers, fallback and an absent asset', async () => {
  const f = fixture()
  const result = await f.run()
  assert.deepEqual(result, { buildAssets: 3, checkedAssets: 5 })
  assertHttpProbeRequests(f)
  assert.equal(f.requests.find(({ key }) => key === 'css')!.url.search, '?mode=1&cache=2')
  assert.equal(f.requests.find(({ key }) => key === 'fallback')!.accept, 'text/html')
  assert.equal(f.requests.find(({ key }) => key === 'missing')!.accept, 'text/html')
  assert.ok(f.reads.every((name) => f.files.has(name)))
})

test('a base path is normalized while root-relative assets are fetched from the origin', async () => {
  const f = fixture('/subsite')
  await f.run()
  assert.equal(f.requests[0].url.pathname, '/subsite/')
  assert.equal(f.requests.find(({ key }) => key === 'app')!.url.pathname, '/assets/app.js')
  assert.equal(
    f.requests.find(({ key }) => key === 'fallback')!.url.pathname,
    '/subsite/__live_deployment_verifier_fixture/navigation',
  )
  assert.equal(f.requests.find(({ key }) => key === 'http:root')!.url.href, 'http://fixture.invalid/subsite/')
  assertHttpProbeRequests(f)
})

test('accepts the supported HTTP redirects for every verified HTTPS resource', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const f = fixture()
    for (const key of httpsRequestKeys) f.httpRoute(key).status = status
    if (status === 302) f.httpRoute('root').headers.Location = 'https://FIXTURE.INVALID:443/'
    assert.deepEqual(await f.run(), { buildAssets: 3, checkedAssets: 5 }, `HTTP ${status}`)
    assertHttpProbeRequests(f)
  }
})

test('normalizes the base path and preserves or overrides explicit HTTP and HTTPS ports', async () => {
  const defaultPort = fixture('/subsite', { app: 'https://fixture.invalid:8443' })
  await defaultPort.run()
  assert.equal(defaultPort.requests[0].url.href, 'https://fixture.invalid:8443/subsite/')
  assert.equal(defaultPort.expectedHttpUrl, 'http://fixture.invalid:8443/subsite/')
  assertHttpProbeRequests(defaultPort)

  const overriddenPort = fixture('/subsite', {
    app: 'https://fixture.invalid:8443', http: 'http://fixture.invalid:8080',
  })
  assert.deepEqual(await overriddenPort.run({
    httpUrl: 'http://FIXTURE.INVALID:8080/subsite',
  }), { buildAssets: 3, checkedAssets: 5 })
  assert.equal(overriddenPort.expectedHttpUrl, 'http://fixture.invalid:8080/subsite/')
  assertHttpProbeRequests(overriddenPort)
})

test('probes arbitrary hostnames and IPv6 hosts without assuming a deployment provider', async () => {
  for (const [app, http] of [
    ['https://region.example:9443', 'http://region.example:9080'],
    ['https://[::1]:9443', 'http://[::1]:9080'],
  ]) {
    const f = fixture('/region', { app, http })
    await f.run({ httpUrl: `${http}/region` })
    assert.equal(f.requests[0].url.href, `${app}/region/`)
    assert.equal(f.expectedHttpUrl, `${http}/region/`)
    assertHttpProbeRequests(f)
  }
})

test('preserves empty and nonempty asset query delimiters in every HTTP probe', async () => {
  const f = fixtureWithAssetQueries()
  assert.deepEqual(await f.run({ httpUrl: 'http://fixture.invalid:8080/subsite' }), {
    buildAssets: 5, checkedAssets: 7,
  })
  assertHttpProbeRequests(f, {
    httpsKeys: ['root', 'app', 'app', 'app', 'vendor', 'css', 'theme', 'favicon', 'fallback', 'missing'],
  })
  assert.deepEqual(f.requests.filter(({ key }) => key === 'app').map(({ url }) => url.href), [
    'https://fixture.invalid:8443/assets/app.js',
    'https://fixture.invalid:8443/assets/app.js?',
    'https://fixture.invalid:8443/assets/app.js?v=1&x=2',
  ])
  assert.deepEqual(f.requests.filter(({ key }) => key === 'http:app').map(({ url }) => url.href), [
    'http://fixture.invalid:8080/assets/app.js',
    'http://fixture.invalid:8080/assets/app.js?',
    'http://fixture.invalid:8080/assets/app.js?v=1&x=2',
  ])
})

test('requires each asset Location to preserve the exact query delimiter and value', async (t) => {
  const httpsKeys = ['root', 'app', 'app', 'app', 'vendor', 'css', 'theme', 'favicon', 'fallback', 'missing']
  for (const [description, query, location, resourceIndex] of [
    ['added empty query', undefined, 'https://fixture.invalid:8443/assets/app.js?', 1],
    ['removed empty query', '?', 'https://fixture.invalid:8443/assets/app.js', 2],
    ['removed nonempty query', '?v=1&x=2', 'https://fixture.invalid:8443/assets/app.js', 3],
    ['changed nonempty query', '?v=1&x=2', 'https://fixture.invalid:8443/assets/app.js?v=1&x=3', 3],
  ] as const) {
    await t.test(description, async () => {
      const f = fixtureWithAssetQueries()
      f.httpRoute('app', query).headers.Location = location
      try {
        await assert.rejects(f.run({ httpUrl: 'http://fixture.invalid:8080/subsite' }), Error)
      } finally {
        assertHttpProbeRequests(f, {
          httpsKeys, httpIndices: Array.from({ length: resourceIndex + 1 }, (_, index) => index),
        })
        assert.deepEqual(f.sleeps, [])
      }
    })
  }
})

test('rejects plaintext or wrong-target asset, fallback and missing-asset HTTP responses', async (t) => {
  const sensitive = /private-target\.invalid|redirect-target-secret/u
  for (const [description, resource, location] of [
    ['asset plaintext', 'app', null],
    ['asset wrong target', 'app', 'https://fixture.invalid/'],
    ['fallback plaintext', 'fallback', null],
    ['fallback off-origin redirect', 'fallback', 'https://private-target.invalid/?redirect-target-secret=1'],
    ['missing asset plaintext', 'missing', null],
    ['missing asset wrong target', 'missing', 'https://fixture.invalid/'],
  ] as const) {
    await t.test(description, async () => {
      const f = fixture()
      const route = f.httpRoute(resource)
      if (location === null) {
        route.status = 200
        route.body = 'Plaintext response'
      } else {
        route.headers.Location = location
      }
      try {
        await assert.rejects(f.run(), (error: unknown) => assertSanitizedError(error, sensitive))
      } finally {
        assertHttpProbeRequests(f, {
          httpIndices: Array.from({ length: httpsRequestKeys.indexOf(resource) + 1 }, (_, index) => index),
        })
        assert.deepEqual(f.sleeps, [])
      }
    })
  }
})

test('rejects HTTP successes and unsupported redirect statuses without following them', async () => {
  for (const status of [200, 201, 204, 300, 304, 305, 306, 309, 399]) {
    const f = fixture()
    f.httpRoute('root').status = status
    await assert.rejects(f.run(), Error, `HTTP ${status}`)
    assertHttpProbeRequests(f, { httpIndices: [0] })
    assert.deepEqual(f.sleeps, [], `HTTP ${status} must not be retried`)
  }
})

test('rejects missing, unsafe and mismatched HTTP redirect locations without following or exposing them', async (t) => {
  const sensitive = /location-user|location-password|location-query-secret|location-fragment-secret|private-target\.invalid/u
  for (const [description, location] of [
    ['missing', null],
    ['empty', ''],
    ['malformed', 'https://[invalid'],
    ['relative HTTP path', '/'],
    ['scheme-relative HTTP URL', '//fixture.invalid/'],
    ['HTTP downgrade', 'http://fixture.invalid/'],
    ['off-origin', 'https://private-target.invalid/'],
    ['off-origin scheme-relative URL', '//private-target.invalid/'],
    ['different port', 'https://fixture.invalid:8443/'],
    ['different path', 'https://fixture.invalid/other/'],
    ['credentials', 'https://location-user:location-password@fixture.invalid/'],
    ['empty userinfo', 'https://@fixture.invalid/'],
    ['userinfo after extra slashes', 'https:////@fixture.invalid/'],
    ['userinfo after a single slash', 'https:/@fixture.invalid/'],
    ['query', 'https://fixture.invalid/?location-query-secret=1'],
    ['fragment', 'https://fixture.invalid/#location-fragment-secret'],
    ['empty query', 'https://fixture.invalid/?'],
    ['empty fragment', 'https://fixture.invalid/#'],
    ['non-HTTP scheme', 'javascript:alert(1)'],
  ] as const) {
    await t.test(description, async () => {
      const f = fixture()
      if (location === null) delete f.httpRoute('root').headers.Location
      else f.httpRoute('root').headers.Location = location
      try {
        await assert.rejects(f.run(), (error: unknown) => assertSanitizedError(error, sensitive))
      } finally {
        assertHttpProbeRequests(f, { httpIndices: [0] })
        assert.deepEqual(f.sleeps, [])
      }
    })
  }
})

test('requires the redirect target to match the normalized base path and HTTPS port exactly', async () => {
  for (const location of [
    'https://fixture.invalid:8443/subsite',
    'https://fixture.invalid:8443/other/',
    'https://fixture.invalid/subsite/',
    'https://fixture.invalid:8080/subsite/',
  ]) {
    const f = fixture('/subsite', {
      app: 'https://fixture.invalid:8443', http: 'http://fixture.invalid:8080',
    })
    f.httpRoute('root').headers.Location = location
    await assert.rejects(f.run({ httpUrl: 'http://fixture.invalid:8080/subsite/' }), Error, location)
    assertHttpProbeRequests(f, { httpIndices: [0] })
    assert.deepEqual(f.sleeps, [])
  }
})

test('rejects invalid HTTP probe URLs before filesystem or network access without exposing their values', async () => {
  const sensitive = /probe-user|probe-password|probe-query-secret|probe-fragment-secret|private-probe\.invalid/u
  for (const [description, httpUrl] of [
    ['null', null],
    ['number', 123],
    ['empty', ''],
    ['malformed', 'not-a-url'],
    ['relative', '/subsite/'],
    ['scheme-relative', '//fixture.invalid/subsite/'],
    ['HTTPS', 'https://fixture.invalid/subsite/'],
    ['other scheme', 'ftp://fixture.invalid/subsite/'],
    ['different hostname', 'http://private-probe.invalid/subsite/'],
    ['different path', 'http://fixture.invalid/other/'],
    ['invalid port', 'http://fixture.invalid:70000/subsite/'],
    ['credentials', 'http://probe-user:probe-password@fixture.invalid/subsite/'],
    ['username', 'http://probe-user@fixture.invalid/subsite/'],
    ['password', 'http://:probe-password@fixture.invalid/subsite/'],
    ['empty userinfo', 'http://@fixture.invalid/subsite/'],
    ['query', 'http://fixture.invalid/subsite/?probe-query-secret=1'],
    ['fragment', 'http://fixture.invalid/subsite/#probe-fragment-secret'],
    ['empty query', 'http://fixture.invalid/subsite/?'],
    ['empty fragment', 'http://fixture.invalid/subsite/#'],
    ['leading whitespace', ' http://fixture.invalid/subsite/'],
    ['backslash', 'http://fixture.invalid\\subsite'],
  ] as const) {
    const touched: string[] = []
    const unexpected = (operation: string) => async () => {
      touched.push(operation)
      throw new Error('Unexpected access')
    }
    await assert.rejects(verifyDeployment({
      appUrl: 'https://fixture.invalid/subsite',
      httpUrl,
      readFile: unexpected('readFile'),
      readDirectory: unexpected('readDirectory'),
      realpath: unexpected('realpath'),
      fetchImpl: unexpected('fetch'),
      sleep: unexpected('sleep'),
    }), (error: unknown) => assertSanitizedError(error, sensitive), description)
    assert.deepEqual(touched, [], description)
  }
})

test('discovers quoted, unquoted, encoded and distinct query-string references', () => {
  const assets = discoverBuildAssets([
    '<!-- <script src="/assets/not-real.js"></script> -->',
    '<script>const text = \'<link href="/assets/not-real.css">\';</script>',
    '<script SRC=/assets/app.js></script>',
    '<link href="&#47;assets&#47;main&#46;css?v=1&amp;x=2">',
    '<link href="/assets/main.css?v=2#ignored">',
    '<link href="/assets/main.css?v=2#duplicate">',
  ].join(''))
  assert.deepEqual(assets, [
    { pathname: '/assets/app.js', requestPath: '/assets/app.js', kind: 'js' },
    { pathname: '/assets/main.css', requestPath: '/assets/main.css?v=1&x=2', kind: 'css' },
    { pathname: '/assets/main.css', requestPath: '/assets/main.css?v=2', kind: 'css' },
  ])
})

test('rejects unsafe asset paths rather than reading outside dist', async () => {
  for (const unsafe of [
    '/assets/../secret.js',
    '/assets/%2e%2e/secret.js',
    '/assets/%2e%2e%2fsecret.js',
    '/assets/%252e%252e%252fsecret.js',
    '/assets/..\\secret.js',
    '/assets/folder//app.js',
    '/assets/C:%5csecret.js',
    '/assets/CON.js',
    '/assets/bad%zz.js',
  ]) {
    assert.throws(
      () => discoverBuildAssets(`<script src="/assets/app.js"></script><script src="${unsafe}"></script>`),
      /(?:Unsafe|Invalid encoding)/,
      unsafe,
    )
  }
  assert.throws(() => resolveCheckedAssetPath(path.join(projectRoot, 'dist'), '/assets/../../secret.js'), /Unsafe/)

  const f = fixture()
  const outside = path.join(projectRoot, 'outside-secret.js')
  f.realpathOverrides.set(f.paths.app, outside)
  f.files.set(outside, Buffer.from('secret'))
  await assert.rejects(f.run(), /asset \/assets\/app\.js resolves outside dist/)
  assert.equal(f.reads.includes(outside), false)
  assert.equal(f.requests.length, 0)
  assert.deepEqual(f.sleeps, [])

  const escapedDirectory = fixture()
  escapedDirectory.realpathOverrides.set(path.join(escapedDirectory.dist, 'assets'), path.join(projectRoot, 'outside'))
  await assert.rejects(escapedDirectory.run(), /assets directory resolves outside dist/)
  assert.equal(escapedDirectory.requests.length, 0)
  assert.deepEqual(escapedDirectory.sleeps, [])

  const symlink = fixture()
  await assert.rejects(symlink.run({
    readDirectory: async (name: string, options: { withFileTypes: boolean }) => [
      ...await symlink.readDirectory(name, options),
      { name: 'outside.js', isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false },
    ],
  }), /Unsafe entry in checked assets directory/)
  assert.equal(symlink.requests.length, 0)
  assert.deepEqual(symlink.sleeps, [])
})

test('verifies unreferenced bundled assets and their content types', async () => {
  const f = fixture()
  const httpsKeys = ['root', 'app', 'vendor', 'css', 'lazy', 'logo', 'theme', 'favicon', 'fallback', 'missing']
  const lazy = Buffer.from('export const lazy = true;\n')
  const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  f.files.set(path.join(f.dist, 'assets', 'chunks', 'lazy.js'), lazy)
  f.files.set(path.join(f.dist, 'assets', 'logo.png'), logo)
  f.routes.set('lazy', { body: lazy, headers: { ...globalHeaders, 'Content-Type': 'application/javascript' } })
  f.routes.set('logo', { body: logo, headers: { ...globalHeaders, 'Content-Type': 'image/png' } })
  assert.deepEqual(await f.run(), { buildAssets: 5, checkedAssets: 7 })
  assert.ok(f.requests.some(({ key }) => key === 'lazy'))
  assert.ok(f.requests.some(({ key }) => key === 'logo'))
  assertHttpProbeRequests(f, { httpsKeys })

  f.requests.length = 0
  f.sleeps.length = 0
  f.route('lazy').body = Buffer.from('export const lazy = false;\n')
  await assert.rejects(f.run({ retryDelayMs: 7 }), /Asset \/assets\/chunks\/lazy\.js: live bytes differ/)
  assertStoppedAfterHttpsAttempts(f, 'lazy', httpsKeys)

  f.requests.length = 0
  f.sleeps.length = 0
  f.route('lazy').body = lazy
  f.route('logo').headers['Content-Type'] = 'text/html'
  await assert.rejects(f.run({ retryDelayMs: 7 }), /Asset \/assets\/logo\.png: invalid Content-Type .* for png/)
  assertStoppedAfterHttpsAttempts(f, 'logo', httpsKeys)
})

test('requires a valid content type for an unknown asset extension', async () => {
  const f = fixture()
  const contents = Buffer.from('asset data')
  f.files.set(path.join(f.dist, 'assets', 'special.constructor'), contents)
  f.routes.set('special', { body: contents, headers: { ...globalHeaders, 'Content-Type': 'application/octet-stream' } })
  await f.run()
  f.requests.length = 0
  f.sleeps.length = 0
  delete f.route('special').headers['Content-Type']
  await assert.rejects(f.run({ retryDelayMs: 7 }), /Asset \/assets\/special\.constructor: invalid Content-Type .* for constructor/)
  assertStoppedAfterHttpsAttempts(f, 'special', [
    'root', 'app', 'vendor', 'css', 'special', 'theme', 'favicon', 'fallback', 'missing',
  ])
})

test('fails before requesting the site when build assets or local files are missing', async () => {
  const noAssets = fixture()
  noAssets.files.set(noAssets.paths.index, Buffer.from('<script src="/theme.js"></script>'))
  await assert.rejects(noAssets.run(), /references no \/assets\/ JavaScript or CSS build assets/)
  assert.equal(noAssets.requests.length, 0)
  assert.deepEqual(noAssets.sleeps, [])

  const missingLocal = fixture()
  missingLocal.files.delete(missingLocal.paths.app)
  await assert.rejects(missingLocal.run(), /Cannot resolve checked asset \/assets\/app\.js \(ENOENT\)/)
  assert.equal(missingLocal.requests.length, 0)
  assert.deepEqual(missingLocal.sleeps, [])

  const missingRequired = fixture()
  missingRequired.files.delete(missingRequired.paths.favicon)
  await assert.rejects(missingRequired.run(), /Cannot resolve checked asset \/favicon\.svg \(ENOENT\)/)
  assert.equal(missingRequired.requests.length, 0)
  assert.deepEqual(missingRequired.sleeps, [])
})

test('rejects stale root HTML without normalizing its mixed line endings', async () => {
  const f = fixture()
  f.route('root').body = html.toString('utf8').replace(/\r\n/g, '\n')
  await assert.rejects(f.run({ retryDelayMs: 7 }), /Root document: live bytes differ from the checked file/)
  assertStoppedAfterHttpsAttempts(f, 'root')
})

test('rejects stale build assets, theme and favicon even when their lengths match', async () => {
  for (const key of ['app', 'vendor', 'css', 'theme', 'favicon']) {
    const f = fixture()
    const response = f.route(key)
    const changed = Buffer.from(response.body!)
    changed[0] ^= 1
    response.body = changed
    await assert.rejects(f.run({ retryDelayMs: 7 }), /Asset .*: live bytes differ from the checked file/, key)
    assertStoppedAfterHttpsAttempts(f, key)
  }
})

test('retries failed live assets and reports persistent HTTP errors', async () => {
  const f = fixture()
  f.route('app').status = 404
  f.route('app').body = 'Not found'
  await assert.rejects(f.run(), /Asset \/assets\/app\.js: HTTP 404 \(expected 200\) after 3 attempts/)
  assert.equal(f.requests.filter(({ key }) => key === 'app').length, 3)
})

test('checks every configured security header for presence and the configured value', async () => {
  const missing = fixture()
  delete missing.route('root').headers['X-Frame-Options']
  await assert.rejects(missing.run({ retryDelayMs: 7 }), /missing security header X-Frame-Options/)
  assertStoppedAfterHttpsAttempts(missing, 'root')

  const changed = fixture()
  changed.route('root').headers['Content-Security-Policy'] = 'private-header-response-secret'
  await assert.rejects(changed.run({ retryDelayMs: 7 }), (error: Error) => {
    assert.match(error.message, /security header Content-Security-Policy differs/)
    return assertSanitizedError(error, /private-header-response-secret/u)
  })
  assertStoppedAfterHttpsAttempts(changed, 'root')

  const badConfig = fixture()
  badConfig.files.set(badConfig.paths.config, Buffer.from('{"globalHeaders":{}}'))
  await assert.rejects(badConfig.run(), /must configure globalHeaders/)
  assert.equal(badConfig.requests.length, 0)
  assert.deepEqual(badConfig.sleeps, [])

  const extra = fixture()
  extra.files.set(extra.paths.config, Buffer.from(JSON.stringify({
    globalHeaders: { ...globalHeaders, 'X-Extra-Guard': 'enabled' },
  })))
  await assert.rejects(extra.run({ retryDelayMs: 7 }), /missing security header X-Extra-Guard/)
  assertStoppedAfterHttpsAttempts(extra, 'root')
  for (const response of extra.routes.values()) response.headers['x-extra-guard'] = 'enabled'
  extra.requests.length = 0
  extra.sleeps.length = 0
  await extra.run()
  assertHttpProbeRequests(extra)
})

test('checks configured security headers on assets, fallback and missing-asset responses', async () => {
  for (const key of ['app', 'css', 'theme', 'favicon', 'fallback', 'missing']) {
    const f = fixture()
    delete f.route(key).headers['X-Content-Type-Options']
    await assert.rejects(f.run({ retryDelayMs: 7 }), /missing security header X-Content-Type-Options/, key)
    if (key !== 'missing') assertStoppedAfterHttpsAttempts(f, key)
  }
})

test('checks actual HTML, JavaScript and CSS content types', async () => {
  for (const [key, expected] of [
    ['root', /Root document: invalid Content-Type .* for html/],
    ['app', /Asset \/assets\/app\.js: invalid Content-Type .* for js/],
    ['theme', /Asset \/theme\.js: invalid Content-Type .* for js/],
    ['css', /Asset \/assets\/main\.css: invalid Content-Type .* for css/],
    ['favicon', /Asset \/favicon\.svg: invalid Content-Type .* for svg/],
    ['fallback', /Navigation fallback: invalid Content-Type .* for html/],
  ] as const) {
    const f = fixture()
    f.route(key).headers['Content-Type'] = 'text/plain; charset=utf-8'
    await assert.rejects(f.run({ retryDelayMs: 7 }), expected, key)
    assertStoppedAfterHttpsAttempts(f, key)
  }
  const missing = fixture()
  delete missing.route('app').headers['Content-Type']
  await assert.rejects(missing.run({ retryDelayMs: 7 }), /invalid Content-Type \(missing or invalid\) for js/)
  assertStoppedAfterHttpsAttempts(missing, 'app')
})

test('accepts standard and legacy JavaScript MIME types with charset parameters', async () => {
  for (const type of [
    'text/javascript; charset=utf-8',
    'APPLICATION/JAVASCRIPT; Charset="UTF-8"',
    'application/ecmascript',
    'text/ecmascript; charset=utf-8',
    'application/x-javascript',
    'text/javascript1.5',
    'text/x-ecmascript',
  ]) {
    const f = fixture()
    f.route('app').headers['Content-Type'] = type
    await f.run()
  }
})

test('rejects a stale fallback and an asset probe rewritten to the SPA', async () => {
  const stale = fixture()
  stale.route('fallback').body = '<html>stale</html>'
  await assert.rejects(stale.run({ retryDelayMs: 7 }), /Navigation fallback: live bytes differ/)
  assertStoppedAfterHttpsAttempts(stale, 'fallback')

  const rewritten = fixture()
  rewritten.route('missing').status = 200
  rewritten.route('missing').body = html
  await assert.rejects(rewritten.run(), /Missing asset probe: HTTP 200 \(expected 404\)/)
  assert.equal(rewritten.requests.filter(({ key }) => key === 'missing').length, 1)
  assert.equal(rewritten.requests.some(({ key }) => key.startsWith('http:')), false)
  assert.deepEqual(rewritten.sleeps, [])

  const disguised = fixture()
  disguised.route('missing').body = html
  await assert.rejects(disguised.run({ retryDelayMs: 7 }), /HTTP 404 returned the SPA index HTML after 3 attempts/)
  assertStoppedAfterHttpsAttempts(disguised, 'missing')
})

test('selects a genuinely absent local asset for the 404 probe', async () => {
  const f = fixture()
  const existing = path.join(f.dist, 'assets', '__live_deployment_missing_fixture.js')
  f.realpathOverrides.set(existing, existing)
  const ids = ['fixture', 'next']
  await f.run({ makeId: () => ids.shift() })
  assert.equal(f.requests.find(({ key }) => key === 'missing')!.url.pathname, '/assets/__live_deployment_missing_next.js')
  assertHttpProbeRequests(f)
})

test('rejects insecure and off-origin redirects without following or exposing them', async () => {
  for (const location of [
    'http://fixture.invalid/',
    'https://other.invalid/',
    'https://user:redirect-secret@fixture.invalid/',
  ]) {
    const f = fixture()
    f.routes.set('root', { status: 302, body: '', headers: { Location: location } })
    await assert.rejects(f.run(), (error: Error) => {
      assert.match(error.message, /Root document: HTTP 302 redirect is not followed/)
      assert.doesNotMatch(error.message, /redirect-secret|other\.invalid/)
      return true
    })
    assert.equal(f.requests.length, 1)
    assert.deepEqual(f.sleeps, [])
  }
})

test('unexpected HTTPS 2xx and 3xx statuses fail fast without following redirects', async () => {
  for (const status of [201, 202, 204, 206, 300, 301, 302, 303, 304, 305, 306, 307, 308, 399]) {
    const f = fixture()
    f.route('root').status = status
    f.route('root').body = null
    f.route('root').headers.Location = 'https://private-target.invalid/?redirect-target-secret=1'
    await assert.rejects(
      f.run({ retryDelayMs: 7 }),
      (error: unknown) => assertSanitizedError(error, /private-target\.invalid|redirect-target-secret/u),
      `HTTP ${status}`,
    )
    assert.deepEqual(f.requests.map(({ key }) => key), ['root'], `HTTP ${status}`)
    assert.deepEqual(f.sleeps, [], `HTTP ${status}`)
  }
})

test('rejects invalid URLs, query strings, fragments and userinfo before file or network access', async () => {
  for (const appUrl of [
    undefined, '', 'not-a-url', 'http://fixture.invalid/', '//fixture.invalid/',
    'https://fixture.invalid/?token=query-secret',
    'https://fixture.invalid/#fragment-secret',
    'https://user:password-secret@fixture.invalid/',
    'https://user@fixture.invalid/',
    'https://:password-secret@fixture.invalid/',
    'https://@fixture.invalid/',
    ' https://fixture.invalid/',
    'https://fixture.invalid\\other',
  ]) {
    let touched = false
    await assert.rejects(verifyDeployment({
      appUrl,
      readFile: async () => { touched = true; throw new Error('unexpected') },
      readDirectory: async () => { touched = true; throw new Error('unexpected') },
      realpath: async () => { touched = true; throw new Error('unexpected') },
      fetchImpl: async () => { touched = true; throw new Error('unexpected') },
      sleep: async () => { touched = true; throw new Error('unexpected') },
    }), (error: Error) => {
      assert.match(error.message, /APP_URL/)
      assert.doesNotMatch(error.message, /password-secret|query-secret|fragment-secret/)
      return true
    })
    assert.equal(touched, false, String(appUrl))
  }
  assert.equal(validateAppUrl('https://fixture.invalid/base').href, 'https://fixture.invalid/base/')
  assert.equal(validateAppUrl('https://[::1]:8443/').href, 'https://[::1]:8443/')
})

test('the CLI rejects bad inputs without leaking credentials, even from another directory', () => {
  for (const [value, expected] of [
    [undefined, /APP_URL is required/],
    ['http://fixture.invalid/', /HTTPS/],
    ['https://user:cli-secret@fixture.invalid/', /credentials/],
  ] as const) {
    const env = { ...process.env }
    if (value === undefined) delete env.APP_URL
    else env.APP_URL = value
    const result = spawnSync(process.execPath, [script], {
      cwd: path.join(projectRoot, 'tests'), env, encoding: 'utf8', timeout: 5_000,
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, expected)
    assert.doesNotMatch(result.stderr, /cli-secret/)
    assert.equal(result.stdout, '')
  }
})

test('the CLI validates APP_HTTP_URL without leaking its sensitive parts', () => {
  const preload = `data:text/javascript,${encodeURIComponent([
    'const originalSetTimeout = globalThis.setTimeout',
    'globalThis.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args)',
    'globalThis.fetch = async () => { throw Object.assign(new Error("unexpected network access"), { code: "ENETUNREACH" }) }',
  ].join('\n'))}`
  const result = spawnSync(process.execPath, ['--import', preload, script], {
    cwd: path.join(projectRoot, 'tests'),
    env: {
      ...process.env,
      APP_URL: 'https://fixture.invalid/subsite',
      APP_HTTP_URL: 'http://cli-user:cli-password@fixture.invalid/subsite/?cli-query-secret=1#cli-fragment-secret',
    },
    encoding: 'utf8',
    timeout: 5_000,
  })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /APP_HTTP_URL|HTTP|configuration|URL/i)
  assert.doesNotMatch(result.stderr, /cli-user|cli-password|cli-query-secret|cli-fragment-secret|unexpected network access/u)
  assert.equal(result.stdout, '')
})

test('importing the module has no CLI, filesystem or network dependency on dist', () => {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(pathToFileURL(script).href)})`,
    '__not_a_script__',
  ], {
    cwd: path.join(projectRoot, 'tests'),
    env: { ...process.env, APP_URL: 'http://fixture.invalid/' },
    encoding: 'utf8',
    timeout: 5_000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('recovers from stale root and later asset bytes without restarting earlier checks', async (t) => {
  for (const [description, key, pathname] of [
    ['root', 'root', '/'],
    ['later asset', 'vendor', '/assets/chunks/vendor.js'],
  ] as const) {
    await t.test(description, async () => {
      const f = fixture()
      const stale = Buffer.from(key === 'root' ? html : f.files.get(f.paths.vendor)!)
      stale[0] ^= 1
      let attempts = 0
      const transient = async (input: string, options: RequestInit) => {
        const response = await f.fetchImpl(input, options)
        const url = new URL(input)
        if (url.protocol === 'https:' && url.pathname === pathname && ++attempts < 3) {
          return new Response(stale, { status: 200, headers: response.headers })
        }
        return response
      }
      assert.deepEqual(await f.run({ fetchImpl: transient, retryDelayMs: 7 }), {
        buildAssets: 3, checkedAssets: 5,
      })
      assert.equal(attempts, 3)
      assert.deepEqual(f.sleeps, [7, 7])
      const target = httpsRequestKeys.indexOf(key)
      assertHttpProbeRequests(f, {
        httpsIndices: httpsRequestKeys.flatMap((_, index) => index === target ? [index, index, index] : [index]),
      })
    })
  }
})

test('recovers from transient wrong MIME and missing or mismatched security headers', async (t) => {
  for (const [description, mutate] of [
    ['wrong MIME', (headers: Headers) => headers.set('Content-Type', 'text/plain')],
    ['missing security header', (headers: Headers) => headers.delete('X-Frame-Options')],
    ['mismatched security header', (headers: Headers) => headers.set('Content-Security-Policy', 'default-src *')],
  ] as const) {
    await t.test(description, async () => {
      const f = fixture()
      let attempts = 0
      const transient = async (input: string, options: RequestInit) => {
        const response = await f.fetchImpl(input, options)
        const url = new URL(input)
        if (url.protocol === 'https:' && url.pathname === '/assets/app.js' && ++attempts < 3) {
          const headers = new Headers(response.headers)
          mutate(headers)
          return new Response(response.body, { status: 200, headers })
        }
        return response
      }
      assert.deepEqual(await f.run({ fetchImpl: transient, retryDelayMs: 7 }), {
        buildAssets: 3, checkedAssets: 5,
      })
      assert.equal(attempts, 3)
      assert.deepEqual(f.sleeps, [7, 7])
      assertHttpProbeRequests(f, { httpsIndices: [0, 1, 1, 1, 2, 3, 4, 5, 6, 7] })
    })
  }
})

test('recovers from a stale navigation fallback before checking the missing asset and HTTP redirects', async () => {
  const f = fixture()
  const stale = Buffer.from(html)
  stale[0] ^= 1
  let attempts = 0
  const transient = async (input: string, options: RequestInit) => {
    const response = await f.fetchImpl(input, options)
    const url = new URL(input)
    if (url.protocol === 'https:'
      && url.pathname === '/__live_deployment_verifier_fixture/navigation' && ++attempts < 3) {
      return new Response(stale, { status: 200, headers: response.headers })
    }
    return response
  }
  assert.deepEqual(await f.run({ fetchImpl: transient, retryDelayMs: 7 }), {
    buildAssets: 3, checkedAssets: 5,
  })
  assert.equal(attempts, 3)
  assert.deepEqual(f.sleeps, [7, 7])
  assertHttpProbeRequests(f, { httpsIndices: [0, 1, 2, 3, 4, 5, 6, 6, 6, 7] })
})

test('recovers from a transient missing-asset response with SPA HTML or a missing header', async (t) => {
  for (const kind of ['SPA HTML', 'missing header'] as const) {
    await t.test(kind, async () => {
      const f = fixture()
      let attempts = 0
      const transient = async (input: string, options: RequestInit) => {
        const response = await f.fetchImpl(input, options)
        const url = new URL(input)
        if (url.protocol === 'https:' && url.pathname.includes('__live_deployment_missing_') && ++attempts === 1) {
          const headers = new Headers(response.headers)
          if (kind === 'missing header') headers.delete('X-Frame-Options')
          return new Response(kind === 'SPA HTML' ? html : response.body, { status: 404, headers })
        }
        return response
      }
      assert.deepEqual(await f.run({ fetchImpl: transient, retryDelayMs: 7 }), {
        buildAssets: 3, checkedAssets: 5,
      })
      assert.equal(attempts, 2)
      assert.deepEqual(f.sleeps, [7])
      assertHttpProbeRequests(f, { httpsIndices: [0, 1, 2, 3, 4, 5, 6, 7, 7] })
    })
  }
})

test('persistent stale response contents are not exposed in errors', async (t) => {
  for (const key of ['root', 'app', 'fallback']) {
    await t.test(key, async () => {
      const f = fixture()
      f.route(key).body = `private-response-content-secret-${key}`
      await assert.rejects(f.run({ retryDelayMs: 7 }), (error: Error) => {
        assert.match(error.message, /live bytes differ/)
        return assertSanitizedError(error, /private-response-content-secret/u)
      })
      assertStoppedAfterHttpsAttempts(f, key)
    })
  }
})

test('persistent MIME and security-header errors do not expose response contents', async (t) => {
  for (const [description, mutate, expected] of [
    [
      'wrong MIME',
      (headers: Record<string, string>) => { headers['Content-Type'] = 'text/plain' },
      /invalid Content-Type/,
    ],
    [
      'missing header',
      (headers: Record<string, string>) => { delete headers['X-Frame-Options'] },
      /missing security header X-Frame-Options/,
    ],
    [
      'mismatched header',
      (headers: Record<string, string>) => { headers['Content-Security-Policy'] = 'private-header-response-secret' },
      /security header Content-Security-Policy differs/,
    ],
  ] as const) {
    await t.test(description, async () => {
      const f = fixture()
      const content = Buffer.from('private-response-content-secret')
      f.files.set(f.paths.app, content)
      f.route('app').body = content
      mutate(f.route('app').headers)
      await assert.rejects(f.run({ retryDelayMs: 7 }), (error: Error) => {
        assert.match(error.message, expected)
        return assertSanitizedError(error, /private-response-content-secret|private-header-response-secret/u)
      })
      assertStoppedAfterHttpsAttempts(f, 'app')
    })
  }
})

test('honors the configured retry count for persistent response mismatches', async () => {
  for (const retries of [0, 1, 2]) {
    const f = fixture()
    f.route('root').body = 'stale response'
    await assert.rejects(f.run({ retries, retryDelayMs: 7 }), /Root document: live bytes differ/)
    assert.deepEqual(f.requests.map(({ key }) => key), Array(retries + 1).fill('root'))
    assert.deepEqual(f.sleeps, Array(retries).fill(7))
  }
})

test('HTTP status and stale-byte failures share the same bounded retry budget', async () => {
  const f = fixture()
  let attempts = 0
  const mixedFailure = async (input: string, options: RequestInit) => {
    const response = await f.fetchImpl(input, options)
    const url = new URL(input)
    if (url.protocol === 'https:' && url.pathname === '/') {
      attempts += 1
      if (attempts === 1) return new Response('Not ready', { status: 503 })
      if (attempts < 4) return new Response('stale response', { status: 200, headers: response.headers })
    }
    return response
  }
  await assert.rejects(
    f.run({ fetchImpl: mixedFailure, retryDelayMs: 7 }),
    /Root document: live bytes differ/,
  )
  assert.equal(attempts, 3)
  assertStoppedAfterHttpsAttempts(f, 'root')
})

test('retries transient HTTP failures and network errors during rollout', async () => {
  const http = fixture()
  let httpAttempts = 0
  const httpFetch = async (input: string, options: RequestInit) => {
    const url = new URL(input)
    if (url.protocol === 'https:' && url.pathname === '/' && ++httpAttempts < 3) {
      return new Response('Not ready', { status: 503 })
    }
    return http.fetchImpl(input, options)
  }
  await http.run({ fetchImpl: httpFetch, retryDelayMs: 5_000 })
  assert.equal(httpAttempts, 3)
  assert.deepEqual(http.sleeps, [5_000, 5_000])
  assertHttpProbeRequests(http)

  const network = fixture()
  let networkAttempts = 0
  const networkFetch = async (input: string, options: RequestInit) => {
    const url = new URL(input)
    if (url.protocol === 'https:' && url.pathname === '/' && ++networkAttempts === 1) {
      throw Object.assign(new Error('sensitive network error'), { code: 'ECONNRESET' })
    }
    return network.fetchImpl(input, options)
  }
  await network.run({ fetchImpl: networkFetch })
  assert.equal(networkAttempts, 2)
  assertHttpProbeRequests(network)
})

test('retries transient 4xx, 5xx and network failures on an HTTP probe', async () => {
  for (const status of [404, 503]) {
    const f = fixture()
    let attempts = 0
    const transient = async (input: string, options: RequestInit) => {
      const response = await f.fetchImpl(input, options)
      const url = new URL(input)
      if (url.protocol === 'http:' && url.pathname === '/' && ++attempts < 3) {
        return new Response('Not ready', { status })
      }
      return response
    }
    assert.deepEqual(await f.run({ fetchImpl: transient, retryDelayMs: 7 }), {
      buildAssets: 3, checkedAssets: 5,
    })
    assert.equal(attempts, 3, `HTTP ${status}`)
    assert.deepEqual(f.sleeps, [7, 7], `HTTP ${status}`)
    assertHttpProbeRequests(f, { httpIndices: [0, 0, 0, 1, 2, 3, 4, 5, 6, 7] })
  }

  const network = fixture()
  let attempts = 0
  const transientNetwork = async (input: string, options: RequestInit) => {
    const response = await network.fetchImpl(input, options)
    const url = new URL(input)
    if (url.protocol === 'http:' && url.pathname === '/' && ++attempts === 1) {
      throw Object.assign(new Error('transient network failure'), { code: 'ECONNRESET' })
    }
    return response
  }
  await network.run({ fetchImpl: transientNetwork, retryDelayMs: 7 })
  assert.equal(attempts, 2)
  assert.deepEqual(network.sleeps, [7])
  assertHttpProbeRequests(network, { httpIndices: [0, 0, 1, 2, 3, 4, 5, 6, 7] })
})

test('retries a later asset HTTP probe without restarting earlier checks', async () => {
  const f = fixture()
  let attempts = 0
  const transient = async (input: string, options: RequestInit) => {
    const response = await f.fetchImpl(input, options)
    const url = new URL(input)
    if (url.protocol === 'http:' && url.pathname === '/assets/main.css') {
      attempts += 1
      if (attempts === 1) return new Response('Not ready', { status: 503 })
      if (attempts === 2) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    }
    return response
  }
  await f.run({ fetchImpl: transient, retryDelayMs: 7 })
  assert.equal(attempts, 3)
  assert.deepEqual(f.sleeps, [7, 7])
  assertHttpProbeRequests(f, { httpIndices: [0, 1, 2, 3, 3, 3, 4, 5, 6, 7] })
})

test('bounds retries for persistent HTTP probe failures without exposing network error details', async () => {
  for (const status of [404, 503]) {
    const f = fixture()
    f.httpRoute('root').status = status
    await assert.rejects(f.run({ retryDelayMs: 7 }), (error: Error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}\\b`))
      assert.match(error.message, /after 3 attempts/)
      return true
    }, `HTTP ${status}`)
    assert.deepEqual(f.sleeps, [7, 7])
    assertHttpProbeRequests(f, { httpIndices: [0, 0, 0] })
  }

  const network = fixture()
  const brokenNetwork = async (input: string, options: RequestInit) => {
    const response = await network.fetchImpl(input, options)
    const url = new URL(input)
    if (url.protocol === 'http:' && url.pathname === '/') {
      throw Object.assign(new Error(
        'http://probe-user:probe-password@fixture.invalid/?probe-query-secret=1#probe-fragment-secret',
      ), { code: 'ECONNRESET' })
    }
    return response
  }
  await assert.rejects(network.run({ fetchImpl: brokenNetwork, retryDelayMs: 7 }), (error: Error) => {
    assert.match(error.message, /network request failed \(ECONNRESET\) after 3 attempts/)
    return assertSanitizedError(error, /probe-user|probe-password|probe-query-secret|probe-fragment-secret/u)
  })
  assert.deepEqual(network.sleeps, [7, 7])
  assertHttpProbeRequests(network, { httpIndices: [0, 0, 0] })
})

test('times out and aborts each stalled HTTP probe attempt', async () => {
  const f = fixture()
  const signals: AbortSignal[] = []
  const hangingProbe = async (input: string, options: RequestInit) => {
    const response = await f.fetchImpl(input, options)
    const url = new URL(input)
    if (url.protocol === 'http:' && url.pathname === '/') {
      signals.push(options.signal!)
      return await new Promise<Response>(() => {})
    }
    return response
  }
  await assert.rejects(
    f.run({ fetchImpl: hangingProbe, timeoutMs: 20, retries: 1, retryDelayMs: 7 }),
    /timed out after 20 ms after 2 attempts/,
  )
  assert.equal(signals.length, 2)
  assert.ok(signals.every((signal) => signal.aborted))
  assert.deepEqual(f.sleeps, [7])
  assertHttpProbeRequests(f, { httpIndices: [0, 0] })
})

test('times out and aborts a later asset HTTP probe without repeating earlier checks', async () => {
  const f = fixture()
  const signals: AbortSignal[] = []
  const hangingAsset = async (input: string, options: RequestInit) => {
    const response = await f.fetchImpl(input, options)
    const url = new URL(input)
    if (url.protocol === 'http:' && url.pathname === '/assets/app.js') {
      signals.push(options.signal!)
      return await new Promise<Response>(() => {})
    }
    return response
  }
  await assert.rejects(
    f.run({ fetchImpl: hangingAsset, timeoutMs: 20, retries: 1, retryDelayMs: 7 }),
    /timed out after 20 ms after 2 attempts/,
  )
  assert.equal(signals.length, 2)
  assert.ok(signals.every((signal) => signal.aborted))
  assert.deepEqual(f.sleeps, [7])
  assertHttpProbeRequests(f, { httpIndices: [0, 1, 1] })
})

test('persistent HTTP and network errors fail after bounded retries without leaking details', async () => {
  const http = fixture()
  let attempts = 0
  const alwaysUnavailable = async () => {
    attempts += 1
    return new Response('Not ready', { status: 503 })
  }
  await assert.rejects(http.run({
    fetchImpl: alwaysUnavailable,
    retries: undefined,
    retryDelayMs: undefined,
  }), /HTTP 503 \(expected 200\) after 13 attempts/)
  assert.equal(attempts, 13)
  assert.deepEqual(http.sleeps, Array(12).fill(5_000))
  assert.deepEqual(DEFAULT_REQUEST_OPTIONS, { retries: 12, retryDelayMs: 5_000, timeoutMs: 30_000 })

  const network = fixture()
  const alwaysBroken = async () => {
    throw Object.assign(new Error('https://user:network-secret@fixture.invalid/'), { code: 'ECONNRESET' })
  }
  await assert.rejects(network.run({ fetchImpl: alwaysBroken }), (error: Error) => {
    assert.match(error.message, /network request failed \(ECONNRESET\) after 3 attempts/)
    assert.doesNotMatch(error.message, /network-secret/)
    return true
  })
})

test('times out and retries even if fetch does not respond to cancellation', async () => {
  const f = fixture()
  const signals: AbortSignal[] = []
  const hangingFetch = async (_input: string, options: RequestInit) => {
    signals.push(options.signal!)
    return await new Promise<Response>(() => {})
  }
  await assert.rejects(
    f.run({ fetchImpl: hangingFetch, timeoutMs: 20, retries: 1 }),
    /timed out after 20 ms after 2 attempts/,
  )
  assert.equal(signals.length, 2)
  assert.ok(signals.every((signal) => signal.aborted))
})

test('each timeout covers and cancels a stalled response body', async () => {
  const f = fixture()
  const signals: AbortSignal[] = []
  let cancellations = 0
  const stalledBody = async (_input: string, options: RequestInit) => {
    signals.push(options.signal!)
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('<!')) },
      cancel() { cancellations += 1 },
    })
    return new Response(body, { status: 200, headers: f.route('root').headers })
  }
  await assert.rejects(
    f.run({ fetchImpl: stalledBody, timeoutMs: 20, retries: 1 }),
    /timed out after 20 ms after 2 attempts/,
  )
  assert.equal(signals.length, 2)
  assert.ok(signals.every((signal) => signal.aborted))
  assert.equal(cancellations, 2)
})

test('retries a transient failure while reading the response body', async () => {
  const f = fixture()
  let attempts = 0
  const bodyFailure = async (input: string, options: RequestInit) => {
    const url = new URL(input)
    if (url.protocol === 'https:' && url.pathname === '/' && ++attempts === 1) {
      return new Response(new ReadableStream({
        start(controller) { controller.error(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })) },
      }), { status: 200, headers: f.route('root').headers })
    }
    return f.fetchImpl(input, options)
  }
  await f.run({ fetchImpl: bodyFailure })
  assert.equal(attempts, 2)
  assertHttpProbeRequests(f)
})
