import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTranslator, french, getLanguage, locales } from '../src/i18n.ts'
import { formatCurrency, formatEta, initialShipments, scenarios } from '../src/domain/supplyChain.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('French is the default even when language storage is missing, invalid, or blocked', () => {
  assert.equal(getLanguage(), 'fr')
  for (const saved of [null, '', 'fr', 'de', 'EN', 'invalid']) {
    assert.equal(getLanguage({ getItem: () => saved }), 'fr')
  }
  assert.equal(getLanguage({ getItem() { throw new Error('Storage unavailable') } }), 'fr')
  assert.equal(getLanguage({ getItem(key) {
    assert.equal(key, 'ciplek-language')
    return 'en'
  } }), 'en')
  assert.match(read('../index.html'), /<html lang="fr">/)
})

test('translations support both languages, interpolation, and unchanged identifiers', () => {
  const fr = createTranslator('fr')
  const en = createTranslator('en')
  assert.equal(fr('Overview'), 'Vue d’ensemble')
  assert.equal(en('Overview'), 'Overview')
  assert.equal(fr('View {id} details', { id: 'SIP-2026-001' }), 'Voir les détails de SIP-2026-001')
  assert.equal(en('View {id} details', { id: 'SIP-2026-001' }), 'View SIP-2026-001 details')
  assert.equal(fr('{count} matching shipments', { count: 0 }), '0 expéditions correspondantes')
  assert.equal(fr('{count} matching shipments', { count: 1 }), '1 expédition correspondante')
  assert.equal(en('{count} matching shipments', { count: 1 }), '1 matching shipment')
  assert.equal(fr('{count} matching shipments', { count: 2 }), '2 expéditions correspondantes')
  assert.equal(fr('day'), 'jour')
  assert.equal(fr('days'), 'jours')
  assert.equal(fr('SIP-2026-001'), 'SIP-2026-001')
  assert.equal(fr('Le Havre'), 'Le Havre')
  assert.equal(fr('constructor'), 'constructor')
  for (const [message, translated] of Object.entries(french)) {
    assert.ok(translated.trim(), `Empty translation: ${message}`)
    assert.deepEqual([...translated.matchAll(/\{\w+\}/g)].map(([key]) => key).sort(),
      [...message.matchAll(/\{\w+\}/g)].map(([key]) => key).sort(), message)
  }
})

test('UI messages and domain display labels have French translations', () => {
  for (const path of ['../src/App.tsx', '../src/components/RouteMap.tsx']) {
    const source = read(path)
    for (const [, message] of source.matchAll(/\bt\('([^']+)'\s*[,)]/g)) {
      assert.ok(Object.hasOwn(french, message), `Missing translation: ${message}`)
    }
  }
  for (const label of [
    ...initialShipments.flatMap((shipment) => [shipment.cargo, shipment.mode, shipment.status]),
    ...scenarios.flatMap((scenario) => [scenario.title, scenario.description]),
    'Switch to dark mode', 'Switch to light mode',
  ]) {
    assert.ok(Object.hasOwn(french, label), `Missing display translation: ${label}`)
  }
})

test('currency and UTC arrival dates follow the selected language without changing legacy defaults', () => {
  assert.equal(formatEta('2026-11-01'), '01 Nov')
  for (const language of ['fr', 'en'] as const) {
    const locale = locales[language]
    assert.equal(formatEta('2026-11-01', locale),
      new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date('2026-11-01')))
    for (const compact of [false, true]) {
      assert.equal(formatCurrency(1234567, compact, locale), new Intl.NumberFormat(locale, {
        style: 'currency', currency: 'EUR', notation: compact ? 'compact' : 'standard',
        minimumFractionDigits: 0, maximumFractionDigits: compact ? 1 : 0,
      }).format(1234567))
    }
  }
  assert.notEqual(formatEta('2026-11-01', locales.fr), formatEta('2026-11-01', locales.en))
  assert.notEqual(formatCurrency(1234567, false, locales.fr), formatCurrency(1234567, false, locales.en))
})

test('header exposes flag language options next to the existing sun/moon theme toggle', () => {
  const app = read('../src/App.tsx')
  assert.match(app, /<select className="language-select" aria-label=\{t\('Language'\)\}/)
  assert.match(app, /<option value="fr" lang="fr">🇫🇷 Français<\/option>/)
  assert.match(app, /<option value="en" lang="en">🇬🇧 English<\/option>/)
  assert.match(app, /<\/select>\s*<button className="icon-button" onClick=\{toggleTheme\}/)
  assert.ok(app.includes("document.documentElement.lang = language"))
  assert.ok(app.includes("localStorage.setItem('ciplek-language', language)"))
  assert.ok(app.includes("disrupted ? 'button-outline' : 'button-orange'"))
  assert.match(read('../src/App.css'), /\.button-orange \{ background: var\(--color-brand-orange\); color: var\(--on-orange\)/)
})
