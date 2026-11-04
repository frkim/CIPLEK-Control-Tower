import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const config = JSON.parse(readFileSync(
  new URL('../public/staticwebapp.config.json', import.meta.url), 'utf8',
))
const workflow = readFileSync(new URL('../.github/workflows/ci-cd.yml', import.meta.url), 'utf8')

test('Azure serves SPA navigation without replacing missing static assets with HTML', () => {
  assert.equal(config.navigationFallback.rewrite, '/index.html')
  assert.ok(config.navigationFallback.exclude.includes('/assets/*'))
  assert.ok(config.navigationFallback.exclude.includes('/*.{js,css,svg,json,ico}'))
})

test('Azure hosting enforces HTTPS and browser security headers', () => {
  const headers = config.globalHeaders
  assert.equal(headers['Strict-Transport-Security'], 'max-age=31536000')
  assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(headers['X-Frame-Options'], 'DENY')
  const policy = headers['Content-Security-Policy'].split('; ')
  assert.ok(policy.includes("script-src 'self'"))
  assert.ok(policy.includes("object-src 'none'"))
  assert.ok(policy.includes("frame-ancestors 'none'"))
  assert.ok(policy.includes("style-src 'self' 'unsafe-inline'"))
  assert.equal(headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()')
})

test('only checked main builds can reach the protected Azure deployment', () => {
  for (const lineEnding of ['\n', '\r\n']) {
    const source = workflow.replace(/\r?\n/g, lineEnding)
    assert.match(source, /if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/)
    assert.match(source, /needs: \[build, infrastructure\]/)
    assert.match(source, /environment:\r?\n\s+name: production/)
    assert.doesNotMatch(source, /pull_request_target/)
    const [checks, deployment] = source.split(/\r?\n  deploy:/)
    assert.ok(deployment, 'deployment job is present')
    assert.ok(!checks.includes('secrets.'))
    assert.ok(deployment.includes('creds: ${{ secrets.AZURE_CREDENTIALS }}'))
    assert.ok(deployment.includes('echo "::add-mask::$token"'))
    assert.ok(deployment.includes('skip_app_build: true'))
    assert.ok(deployment.includes('node-version-file: .nvmrc'))
    assert.ok(deployment.includes('APP_URL: ${{ steps.deploy.outputs.static_web_app_url }}'))
    assert.ok(deployment.includes('node scripts/verify-live-deployment.mjs'))
    assert.ok(deployment.includes('Deployed and verified: %s'))
  }
})

test('workflow actions are pinned and CI uses the shared Node runtime and lockfile', () => {
  const actions = [...workflow.matchAll(/^\s+(?:- )?uses: (\S+)/gm)]
  assert.ok(actions.length > 0)
  for (const [, action] of actions) {
    assert.match(action, /^[\w-]+\/[\w-]+@[0-9a-f]{40}$/)
  }
  assert.equal(readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim(), '24')
  assert.ok(workflow.includes('node-version-file: .nvmrc'))
  assert.ok(workflow.includes('cache: npm'))
  assert.ok(workflow.includes('run: npm ci'))
})

const groupStep = workflow.match(
  /      - name: Ensure resource group exists\r?\n        shell: bash\r?\n        run: \|\r?\n([\s\S]*?)(?=      - name:)/,
)?.[1].replace(/^          /gm, '').replace(/\r\n/g, '\n')

function runGroupStep(exists: string, lookupStatus = 0, createStatus = 0) {
  assert.ok(groupStep, 'resource group bootstrap step is present')
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AZURE_RESOURCE_GROUP: 'rg-ciplek-towercontrol',
      AZURE_LOCATION: 'eastus2',
      GROUP_EXISTS: exists,
      LOOKUP_STATUS: String(lookupStatus),
      CREATE_STATUS: String(createStatus),
    },
    input: `
az() {
  printf 'az' >&2
  printf ' <%s>' "$@" >&2
  printf '\\n' >&2
  case "$1 $2" in
    'account show') return 0 ;;
    'group exists')
      printf '%s\\n' "$GROUP_EXISTS"
      return "$LOOKUP_STATUS"
      ;;
    'group create') return "$CREATE_STATUS" ;;
    *) return 99 ;;
  esac
}
${groupStep}
`,
  })
}

test('resource group bootstrap runs after Azure login and before ARM validation', () => {
  const login = workflow.indexOf('creds: ${{ secrets.AZURE_CREDENTIALS }}')
  const bootstrap = workflow.indexOf('- name: Ensure resource group exists')
  const validate = workflow.indexOf('az deployment group validate')
  assert.ok(login >= 0 && bootstrap > login && validate > bootstrap)
})

test('resource group bootstrap preserves existing groups without requiring group creation rights', () => {
  const result = runGroupStep('true')
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /az <account> <show>/)
  assert.match(result.stderr, /az <group> <exists> <--name> <rg-ciplek-towercontrol>/)
  assert.doesNotMatch(result.stderr, /az <group> <create>/)
})

test('resource group bootstrap creates a missing group in the configured region', () => {
  const result = runGroupStep('false')
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr,
    /az <group> <create> <--name> <rg-ciplek-towercontrol> <--location> <eastus2> <--output> <none>/)
})

test('resource group lookup errors stop deployment rather than attempting creation', () => {
  const result = runGroupStep('false', 3)
  assert.ifError(result.error)
  assert.equal(result.status, 3, result.stderr)
  assert.doesNotMatch(result.stderr, /az <group> <create>/)
})

test('resource group creation failures explain the manual least-privilege setup', () => {
  const result = runGroupStep('false', 0, 3)
  assert.ifError(result.error)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stdout, /::error::Cannot create resource group/)
  assert.match(result.stdout, /subscription used by AZURE_CREDENTIALS/)
  assert.match(result.stdout, /Contributor on that group/)
})

test('unexpected resource group responses fail explicitly', () => {
  const result = runGroupStep('')
  assert.ifError(result.error)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stdout, /::error::Unexpected resource group existence result/)
  assert.doesNotMatch(result.stderr, /az <group> <create>/)
})
