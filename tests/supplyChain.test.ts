import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyScenario,
  formatCurrency,
  formatEta,
  getMetrics,
  initialShipments,
  routes,
  scenarios,
  simulateDisruption,
} from '../src/domain/supplyChain.ts'
import type { ScenarioId, Shipment } from '../src/domain/supplyChain.ts'

const affectedRoutes = new Set(['shanghai', 'ningbo', 'shenzhen', 'hochi'])
const dayMs = 86_400_000

function fixture(overrides: Partial<Shipment> = {}): Shipment {
  return { ...initialShipments[0], ...overrides }
}

function immutableShipments(shipments: Shipment[]): Shipment[] {
  const copy = structuredClone(shipments)
  copy.forEach((shipment) => Object.freeze(shipment))
  Object.freeze(copy)
  return copy
}

test('synthetic baseline has 24 unique, valid November 2026 shipments', () => {
  assert.equal(initialShipments.length, 24)
  assert.equal(new Set(initialShipments.map((shipment) => shipment.id)).size, 24)
  assert.deepEqual(new Set(initialShipments.map((shipment) => shipment.mode)), new Set(['Ocean', 'Air']))
  assert.deepEqual(
    new Set(initialShipments.map((shipment) => shipment.status)),
    new Set(['On time', 'Delayed', 'At risk', 'Delivered']),
  )

  initialShipments.forEach((shipment, index) => {
    assert.equal(shipment.id, `SIP-2026-${String(index + 1).padStart(3, '0')}`)
    assert.match(shipment.eta, /^2026-11-\d{2}$/)
    assert.equal(new Date(shipment.eta).toISOString().slice(0, 10), shipment.eta)
    assert.ok(shipment.origin && shipment.originCountry && shipment.destination && shipment.cargo)
    assert.equal(shipment.destinationCountry, 'France')
    assert.ok(Number.isInteger(shipment.containers) && shipment.containers > 0)
    assert.ok(Number.isFinite(shipment.value) && shipment.value > 0)
    assert.ok(Number.isInteger(shipment.delayDays) && shipment.delayDays >= 0)
    assert.ok(shipment.progress >= 0 && shipment.progress <= 100)
    if (shipment.status === 'Delivered') assert.equal(shipment.progress, 100)
    const route = routes.find((candidate) => candidate.id === shipment.routeId)
    assert.ok(route)
    assert.equal(shipment.origin, route.origin)
    assert.equal(shipment.destination, route.destination)
  })
})

test('routes cover five Asian origins with longitude/latitude coordinates and accurate counts', () => {
  assert.deepEqual(routes.map((route) => route.id), [...affectedRoutes, 'singapore'])
  for (const route of routes) {
    assert.ok(route.originCoordinates[0] > 100 && route.originCoordinates[0] < 130)
    assert.ok(route.originCoordinates[1] > 0 && route.originCoordinates[1] < 40)
    assert.ok(route.destinationCoordinates[0] >= 0 && route.destinationCoordinates[0] < 6)
    assert.ok(route.destinationCoordinates[1] > 40 && route.destinationCoordinates[1] < 50)
    assert.ok(['Le Havre', 'Marseille'].includes(route.destination))
    assert.ok(route.transitDays >= 20 && route.transitDays <= 45)
    assert.equal(route.shipmentCount, initialShipments.filter((s) => s.routeId === route.id).length)
  }
  assert.equal(routes.reduce((sum, route) => sum + route.shipmentCount, 0), 24)
})

test('scenario data uses absolute days and percentage points, with one recommendation', () => {
  assert.deepEqual(scenarios.map(({ id, title, daysRecovered }) => ({ id, title, daysRecovered })), [
    { id: 'cape', title: 'Cape of Good Hope', daysRecovered: 3 },
    { id: 'air', title: 'Priority air freight', daysRecovered: 7 },
    { id: 'rail', title: 'Eurasian rail bridge', daysRecovered: 5 },
  ])
  assert.equal(scenarios.filter((scenario) => scenario.recommended).length, 1)
  for (const scenario of scenarios) {
    assert.ok(scenario.description.length > 0)
    assert.ok(scenario.costIncrease > 1)
    assert.ok(Math.abs(scenario.co2Change) > 1)
  }
})

test('disruption adds eight days only to active ocean shipments on affected routes', () => {
  const input = immutableShipments(initialShipments)
  const before = structuredClone(input)
  const result = simulateDisruption(input)
  assert.notStrictEqual(result, input)
  assert.equal(result.length, input.length)
  let affectedCount = 0

  input.forEach((shipment, index) => {
    const affected = shipment.mode === 'Ocean'
      && shipment.status !== 'Delivered'
      && affectedRoutes.has(shipment.routeId)
    if (!affected) {
      assert.deepEqual(result[index], shipment)
      return
    }
    affectedCount += 1
    assert.deepEqual(result[index], {
      ...shipment,
      status: 'Delayed',
      delayDays: shipment.delayDays + 8,
      eta: new Date(Date.parse(shipment.eta) + 8 * dayMs).toISOString().slice(0, 10),
    })
  })

  assert.equal(affectedCount, 14)
  assert.deepEqual(input, before)
  assert.deepEqual(simulateDisruption(input), result)
})

test('disruption preserves unknown routes, air and rail freight, and delivered cargo', () => {
  const input = [
    fixture({ routeId: 'unrelated', status: 'Delayed', delayDays: 4 }),
    fixture({ mode: 'Air', status: 'Delayed', delayDays: 2 }),
    fixture({ mode: 'Rail', status: 'Delayed', delayDays: 2 }),
    fixture({ status: 'Delivered', delayDays: 3, progress: 100 }),
  ]
  assert.deepEqual(simulateDisruption(input), input)
})

test('disruption date arithmetic crosses month, year and leap-day boundaries', () => {
  for (const [eta, expected] of [
    ['2026-11-28', '2026-12-06'],
    ['2026-12-28', '2027-01-05'],
    ['2028-02-25', '2028-03-04'],
  ]) {
    assert.equal(simulateDisruption([fixture({ eta })])[0].eta, expected)
  }
})

for (const scenario of scenarios) {
  test(`${scenario.id} scenario recovers bounded delay without mutating disrupted cargo`, () => {
    const input = immutableShipments(simulateDisruption(initialShipments))
    const before = structuredClone(input)
    const result = applyScenario(input, scenario.id)
    assert.notStrictEqual(result, input)
    assert.equal(result.length, input.length)

    input.forEach((shipment, index) => {
      const affected = shipment.mode === 'Ocean'
        && shipment.status !== 'Delivered'
        && affectedRoutes.has(shipment.routeId)
        && shipment.delayDays > 0
      if (!affected) {
        assert.deepEqual(result[index], shipment)
        return
      }

      const recovered = Math.min(shipment.delayDays, scenario.daysRecovered)
      assert.deepEqual(result[index], {
        ...shipment,
        delayDays: shipment.delayDays - recovered,
        eta: new Date(Date.parse(shipment.eta) - recovered * dayMs).toISOString().slice(0, 10),
        status: shipment.delayDays === recovered ? 'On time' : 'Delayed',
        mode: scenario.id === 'air' ? 'Air' : scenario.id === 'rail' ? 'Rail' : shipment.mode,
      })
    })
    assert.deepEqual(input, before)
    assert.deepEqual(applyScenario(input, scenario.id), result)
  })

  test(`${scenario.id} scenario never recovers more days than the existing delay`, () => {
    for (const delayDays of [1, scenario.daysRecovered, scenario.daysRecovered + 2]) {
      const input = fixture({ eta: '2026-12-02', status: 'Delayed', delayDays })
      const [result] = applyScenario([input], scenario.id)
      const recovered = Math.min(delayDays, scenario.daysRecovered)
      assert.equal(result.delayDays, Math.max(0, delayDays - scenario.daysRecovered))
      assert.equal(Date.parse(input.eta) - Date.parse(result.eta), recovered * dayMs)
      assert.equal(result.status, result.delayDays === 0 ? 'On time' : 'Delayed')
      assert.equal(result.mode, scenario.id === 'air' ? 'Air' : scenario.id === 'rail' ? 'Rail' : 'Ocean')
    }
  })
}

test('scenarios preserve unrelated delayed cargo, air and rail cargo, delivered cargo and zero delay', () => {
  const input = immutableShipments([
    fixture({ routeId: 'singapore', status: 'Delayed', delayDays: 9 }),
    fixture({ routeId: 'unknown', status: 'Delayed', delayDays: 9 }),
    fixture({ mode: 'Air', status: 'Delayed', delayDays: 9 }),
    fixture({ mode: 'Rail', status: 'Delayed', delayDays: 9 }),
    fixture({ status: 'Delivered', delayDays: 9, progress: 100 }),
    fixture({ status: 'On time', delayDays: 0 }),
    fixture({ status: 'At risk', delayDays: 0 }),
  ])
  for (const scenario of scenarios) {
    assert.deepEqual(applyScenario(input, scenario.id), input)
  }
})

test('cape preserves ocean mode and air changes only affected shipments to air', () => {
  const disrupted = simulateDisruption(initialShipments)
  assert.deepEqual(
    applyScenario(disrupted, 'cape').map((shipment) => shipment.mode),
    disrupted.map((shipment) => shipment.mode),
  )
  assert.equal(applyScenario(disrupted, 'air').filter((s) => s.mode === 'Air').length, 18)
})

test('rail converts only impacted ocean shipments and preserves existing air and delivered modes', () => {
  const disrupted = immutableShipments(simulateDisruption(initialShipments))
  const result = applyScenario(disrupted, 'rail')
  assert.equal(result.filter((shipment) => shipment.mode === 'Rail').length, 14)

  disrupted.forEach((shipment, index) => {
    const affected = shipment.mode === 'Ocean'
      && shipment.status !== 'Delivered'
      && affectedRoutes.has(shipment.routeId)
      && shipment.delayDays > 0
    assert.equal(result[index].mode, affected ? 'Rail' : shipment.mode)
  })

  assert.deepEqual(simulateDisruption(result), result)
  assert.deepEqual(applyScenario(result, 'rail'), result)
  assert.equal(applyScenario(disrupted, 'cape').filter((shipment) => shipment.mode === 'Rail').length, 0)
  assert.equal(applyScenario(disrupted, 'air').filter((shipment) => shipment.mode === 'Rail').length, 0)
})

test('invalid scenario identifiers are rejected', () => {
  assert.throws(() => applyScenario(initialShipments, 'unknown' as ScenarioId), RangeError)
})

test('metrics exclude delivered cargo and count at-risk cargo as non-delayed', () => {
  const input = immutableShipments([
    fixture({ status: 'On time', containers: 2, value: 100 }),
    fixture({ status: 'At risk', containers: 3, value: 200 }),
    fixture({ status: 'Delayed', containers: 4, value: 300, delayDays: 2 }),
    fixture({ status: 'Delivered', containers: 99, value: 99_999, delayDays: 7 }),
  ])
  assert.deepEqual(getMetrics(input), {
    activeShipments: 3,
    containersInTransit: 9,
    delayedDeliveries: 1,
    totalValue: 600,
    onTimeRate: 67,
  })
})

test('baseline and disrupted metrics remain consistent', () => {
  const baseline = getMetrics(initialShipments)
  assert.equal(baseline.activeShipments, 20)
  assert.equal(baseline.delayedDeliveries, 6)
  assert.equal(baseline.onTimeRate, 70)
  const disrupted = getMetrics(simulateDisruption(initialShipments))
  assert.deepEqual(disrupted, { ...baseline, delayedDeliveries: 16, onTimeRate: 20 })
})

test('empty arrays and delivered-only portfolios have zero metrics', () => {
  const zeroMetrics = {
    activeShipments: 0, containersInTransit: 0, delayedDeliveries: 0,
    totalValue: 0, onTimeRate: 0,
  }
  assert.deepEqual(simulateDisruption([]), [])
  for (const scenario of scenarios) assert.deepEqual(applyScenario([], scenario.id), [])
  assert.deepEqual(getMetrics([]), zeroMetrics)
  assert.deepEqual(getMetrics([fixture({ status: 'Delivered' })]), zeroMetrics)
  assert.equal(getMetrics([fixture()]).onTimeRate, 100)
  assert.equal(getMetrics([fixture({ status: 'Delayed' })]).onTimeRate, 0)
})

test('currency formatting is deterministic for full and compact EUR values', () => {
  assert.equal(formatCurrency(1_234_567), '€1,234,567')
  assert.equal(formatCurrency(1_234_567, false), '€1,234,567')
  assert.equal(formatCurrency(1_250_000, true), '€1.3M')
  assert.equal(formatCurrency(12_500, true), '€12.5K')
  assert.equal(formatCurrency(0), '€0')
  assert.equal(formatCurrency(-1_250_000, true), '-€1.3M')
})

test('ETA formatting and calendar arithmetic do not depend on the machine time zone', () => {
  const originalTimeZone = process.env.TZ
  try {
    for (const timeZone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = timeZone
      assert.equal(formatEta('2026-11-01'), '01 Nov')
      assert.equal(formatEta('2026-11-28'), '28 Nov')
      const [disrupted] = simulateDisruption([fixture({ eta: '2026-11-01' })])
      assert.equal(disrupted.eta, '2026-11-09')
      assert.equal(applyScenario([disrupted], 'air')[0].eta, '2026-11-02')
    }
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
  }
})
