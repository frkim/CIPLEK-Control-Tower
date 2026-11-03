import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
  assert.match(workflow, /if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /needs: \[build, infrastructure\]/)
  assert.match(workflow, /environment:\n\s+name: production/)
  assert.doesNotMatch(workflow, /pull_request_target/)
  const [checks, deployment] = workflow.split('\n  deploy:')
  assert.ok(!checks.includes('secrets.'))
  assert.ok(deployment.includes('creds: ${{ secrets.AZURE_CREDENTIALS }}'))
  assert.ok(deployment.includes('echo "::add-mask::$token"'))
  assert.ok(deployment.includes('skip_app_build: true'))
  assert.ok(deployment.includes('cmp dist/index.html'))
  assert.ok(deployment.includes('cmp "dist$asset"'))
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
