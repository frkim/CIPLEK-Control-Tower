import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../src/App.tsx')
const themeScript = read('../public/theme.js')

test('project metadata and documentation use CIPLEK branding', () => {
  const manifest = JSON.parse(read('../package.json'))
  const lockfile = JSON.parse(read('../package-lock.json'))
  assert.equal(manifest.name, 'ciplek-control-tower')
  assert.equal(lockfile.name, manifest.name)
  assert.equal(lockfile.packages[''].name, manifest.name)
  const html = read('../index.html')
  assert.ok(html.includes('<title>CIPLEK · Supply Chain Control Tower</title>'))
  assert.ok(html.includes('name="description" content="CIPLEK Supply Chain Control Tower.'))
  const readme = read('../README.md')
  assert.ok(readme.startsWith('# CIPLEK · Supply Chain Control Tower\n'))
  assert.ok(readme.includes('supply chain workspace for CIPLEK.'))
})

test('application branding covers navigation, footer, help, map and CSV exports', () => {
  assert.ok(app.includes('aria-label="CIPLEK Control Tower home"'))
  assert.ok(app.includes('<span>CIPLEK<span className="brand-subtitle">'))
  assert.ok(app.includes('CIPLEK Control Tower<span className="footer-separator">'))
  assert.ok(app.includes("A decision-making workspace for CIPLEK's supply chain."))
  assert.ok(app.includes("anchor.download = `ciplek-${disrupted ? 'simulation' : 'shipments'}-2026-11.csv`"))
  assert.ok(read('../src/components/RouteMap.tsx').includes('>CIPLEK global supply network</title>'))
})

test('theme persistence uses the same CIPLEK key in the app and bootstrap', () => {
  assert.ok(app.includes("localStorage.getItem('ciplek-theme')"))
  assert.ok(app.includes("localStorage.setItem('ciplek-theme', next)"))
  for (const saved of ['light', 'dark', null, 'invalid']) {
    for (const systemDark of [false, true]) {
      const document = { documentElement: { dataset: { theme: '' } } }
      runInNewContext(themeScript, {
        document,
        localStorage: {
          getItem(key: string) {
            assert.equal(key, 'ciplek-theme')
            return saved
          },
        },
        matchMedia: () => ({ matches: systemDark }),
      })
      assert.equal(document.documentElement.dataset.theme,
        saved === 'light' || saved === 'dark' ? saved : systemDark ? 'dark' : 'light')
    }
  }
})

test('theme bootstrap still follows the system when storage is blocked', () => {
  for (const systemDark of [false, true]) {
    const document = { documentElement: { dataset: { theme: '' } } }
    runInNewContext(themeScript, {
      document,
      localStorage: { getItem() { throw new Error('Storage unavailable') } },
      matchMedia: () => ({ matches: systemDark }),
    })
    assert.equal(document.documentElement.dataset.theme, systemDark ? 'dark' : 'light')
  }
})
