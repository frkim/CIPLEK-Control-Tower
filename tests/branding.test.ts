import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../src/App.tsx')
const themeScript = read('../public/theme.js')
const styles = read('../src/index.css')

function themeTokens(theme: 'light' | 'dark') {
  const root = styles.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const dark = styles.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const tokens = Object.fromEntries([...`${root}${theme === 'dark' ? dark : ''}`
    .matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
  const resolve = (token: string): string => {
    const value = tokens[token]
    assert.ok(value, `Missing token ${token}`)
    const alias = value.match(/^var\((--[\w-]+)\)$/)
    return alias ? resolve(alias[1]) : value
  }
  return resolve
}

function contrast(first: string, second: string) {
  const luminance = (hex: string) => {
    assert.match(hex, /^#[\da-f]{6}$/i)
    const channels = hex.slice(1).match(/../g)!.map((channel) => {
      const value = parseInt(channel, 16) / 255
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    })
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  }
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}

test('proposed palette is centralized and components reuse color tokens', () => {
  const resolve = themeTokens('light')
  assert.equal(resolve('--color-brand-blue'), '#004B87')
  assert.equal(resolve('--color-brand-green'), '#00A651')
  assert.equal(resolve('--color-brand-orange'), '#F58220')
  assert.equal(resolve('--color-brand-navy'), '#00345B')
  assert.equal(resolve('--color-brand-green-light'), '#7BCB9B')
  for (const component of [app, read('../src/App.css'), read('../src/components/route-map.css')]) {
    assert.doesNotMatch(component, /#[\da-f]{3,8}\b/i, 'Component colors must use shared tokens')
  }
  assert.match(styles, /font-size:\s*16px/)
})

test('semantic text and buttons meet WCAG AA contrast in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    const resolve = themeTokens(theme)
    const pairs = [
      ['--text', '--card'], ['--text-secondary', '--card'], ['--text-muted', '--card'],
      ['--text', '--background'], ['--text-secondary', '--background'], ['--text-muted', '--background'],
      ['--heading', '--card'], ['--primary', '--card'], ['--primary', '--primary-pale'],
      ['--positive', '--positive-pale'], ['--warning', '--warning-pale'],
      ['--on-brand', '--button-primary'], ['--on-brand', '--button-positive'],
    ]
    for (const [foreground, background] of pairs) {
      const ratio = contrast(resolve(foreground), resolve(background))
      assert.ok(ratio >= 4.5, `${theme}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`)
    }
    assert.ok(contrast(resolve('--control-border'), resolve('--card')) >= 3)
  }
})

test('project metadata and documentation use CIPLEK branding', () => {
  const manifest = JSON.parse(read('../package.json'))
  const lockfile = JSON.parse(read('../package-lock.json'))
  assert.equal(manifest.name, 'ciplek-control-tower')
  assert.equal(lockfile.name, manifest.name)
  assert.equal(lockfile.packages[''].name, manifest.name)
  const html = read('../index.html')
  assert.ok(html.includes('<title>CIPLEK · Supply Chain Control Tower</title>'))
  assert.ok(html.includes('name="description" content="CIPLEK Supply Chain Control Tower.'))
  const readme = read('../README.md').replace(/\r\n/g, '\n')
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
