export type ShipmentStatus = 'On time' | 'Delayed' | 'At risk' | 'Delivered'
export type TransportMode = 'Ocean' | 'Air' | 'Rail'
export type ScenarioId = 'cape' | 'air' | 'rail'

export interface Shipment {
  id: string
  origin: string
  originCountry: string
  destination: string
  destinationCountry: string
  mode: TransportMode
  status: ShipmentStatus
  containers: number
  value: number
  eta: string
  delayDays: number
  progress: number
  routeId: string
  cargo: string
}

export interface Route {
  id: string
  origin: string
  destination: string
  originCoordinates: [number, number]
  destinationCoordinates: [number, number]
  transitDays: number
  shipmentCount: number
}

export interface Scenario {
  id: ScenarioId
  title: string
  description: string
  daysRecovered: number
  costIncrease: number
  co2Change: number
  recommended: boolean
}

export const initialShipments: Shipment[] = [
  {
    id: 'SIP-2026-001', origin: 'Shanghai', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'shanghai',
    mode: 'Ocean', status: 'On time', containers: 36, value: 2_640_000,
    eta: '2026-11-12', delayDays: 0, progress: 72, cargo: 'LED televisions',
  },
  {
    id: 'SIP-2026-002', origin: 'Ningbo', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'ningbo',
    mode: 'Ocean', status: 'Delayed', containers: 28, value: 1_860_000,
    eta: '2026-11-15', delayDays: 2, progress: 65, cargo: 'Flat-pack furniture',
  },
  {
    id: 'SIP-2026-003', origin: 'Shenzhen', originCountry: 'China',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'shenzhen',
    mode: 'Ocean', status: 'On time', containers: 24, value: 3_240_000,
    eta: '2026-11-10', delayDays: 0, progress: 84, cargo: 'Small kitchen appliances',
  },
  {
    id: 'SIP-2026-004', origin: 'Ho Chi Minh City', originCountry: 'Vietnam',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'hochi',
    mode: 'Ocean', status: 'At risk', containers: 18, value: 1_120_000,
    eta: '2026-11-18', delayDays: 0, progress: 58, cargo: 'Garden tools',
  },
  {
    id: 'SIP-2026-005', origin: 'Singapore', originCountry: 'Singapore',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'singapore',
    mode: 'Ocean', status: 'On time', containers: 32, value: 2_780_000,
    eta: '2026-11-14', delayDays: 0, progress: 70, cargo: 'Packaged pantry goods',
  },
  {
    id: 'SIP-2026-006', origin: 'Shanghai', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'shanghai',
    mode: 'Air', status: 'On time', containers: 2, value: 485_000,
    eta: '2026-11-05', delayDays: 0, progress: 64, cargo: 'Wireless headphones',
  },
  {
    id: 'SIP-2026-007', origin: 'Ningbo', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'ningbo',
    mode: 'Ocean', status: 'Delivered', containers: 30, value: 2_140_000,
    eta: '2026-11-02', delayDays: 0, progress: 100, cargo: 'Bathroom fittings',
  },
  {
    id: 'SIP-2026-008', origin: 'Shenzhen', originCountry: 'China',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'shenzhen',
    mode: 'Ocean', status: 'Delayed', containers: 22, value: 1_980_000,
    eta: '2026-11-16', delayDays: 3, progress: 62, cargo: 'Robot vacuum cleaners',
  },
  {
    id: 'SIP-2026-009', origin: 'Ho Chi Minh City', originCountry: 'Vietnam',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'hochi',
    mode: 'Ocean', status: 'On time', containers: 26, value: 1_540_000,
    eta: '2026-11-20', delayDays: 0, progress: 42, cargo: 'Outdoor furniture',
  },
  {
    id: 'SIP-2026-010', origin: 'Singapore', originCountry: 'Singapore',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'singapore',
    mode: 'Ocean', status: 'At risk', containers: 20, value: 1_760_000,
    eta: '2026-11-17', delayDays: 0, progress: 61, cargo: 'Kitchen utensils',
  },
  {
    id: 'SIP-2026-011', origin: 'Shanghai', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'shanghai',
    mode: 'Ocean', status: 'Delayed', containers: 34, value: 3_080_000,
    eta: '2026-11-19', delayDays: 4, progress: 55, cargo: 'Holiday toys',
  },
  {
    id: 'SIP-2026-012', origin: 'Ningbo', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'ningbo',
    mode: 'Ocean', status: 'On time', containers: 16, value: 920_000,
    eta: '2026-11-22', delayDays: 0, progress: 38, cargo: 'Indoor lighting',
  },
  {
    id: 'SIP-2026-013', origin: 'Shenzhen', originCountry: 'China',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'shenzhen',
    mode: 'Air', status: 'Delayed', containers: 3, value: 790_000,
    eta: '2026-11-07', delayDays: 1, progress: 45, cargo: 'Tablet computers',
  },
  {
    id: 'SIP-2026-014', origin: 'Ho Chi Minh City', originCountry: 'Vietnam',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'hochi',
    mode: 'Ocean', status: 'Delivered', containers: 24, value: 1_360_000,
    eta: '2026-11-01', delayDays: 0, progress: 100, cargo: 'Cotton bed linen',
  },
  {
    id: 'SIP-2026-015', origin: 'Singapore', originCountry: 'Singapore',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'singapore',
    mode: 'Air', status: 'On time', containers: 2, value: 630_000,
    eta: '2026-11-06', delayDays: 0, progress: 52, cargo: 'Network equipment',
  },
  {
    id: 'SIP-2026-016', origin: 'Shanghai', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'shanghai',
    mode: 'Ocean', status: 'On time', containers: 40, value: 3_620_000,
    eta: '2026-11-24', delayDays: 0, progress: 31, cargo: 'Solar panels',
  },
  {
    id: 'SIP-2026-017', origin: 'Ningbo', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'ningbo',
    mode: 'Ocean', status: 'At risk', containers: 28, value: 1_670_000,
    eta: '2026-11-21', delayDays: 0, progress: 47, cargo: 'Home storage products',
  },
  {
    id: 'SIP-2026-018', origin: 'Shenzhen', originCountry: 'China',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'shenzhen',
    mode: 'Air', status: 'Delivered', containers: 1, value: 350_000,
    eta: '2026-11-03', delayDays: 0, progress: 100, cargo: 'Fitness watches',
  },
  {
    id: 'SIP-2026-019', origin: 'Ho Chi Minh City', originCountry: 'Vietnam',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'hochi',
    mode: 'Ocean', status: 'Delayed', containers: 20, value: 1_280_000,
    eta: '2026-11-23', delayDays: 2, progress: 36, cargo: 'Sports footwear',
  },
  {
    id: 'SIP-2026-020', origin: 'Singapore', originCountry: 'Singapore',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'singapore',
    mode: 'Ocean', status: 'Delayed', containers: 30, value: 2_460_000,
    eta: '2026-11-19', delayDays: 2, progress: 57, cargo: 'School stationery',
  },
  {
    id: 'SIP-2026-021', origin: 'Shanghai', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'shanghai',
    mode: 'Ocean', status: 'Delivered', containers: 32, value: 2_380_000,
    eta: '2026-11-01', delayDays: 0, progress: 100, cargo: 'Non-stick cookware',
  },
  {
    id: 'SIP-2026-022', origin: 'Ningbo', originCountry: 'China',
    destination: 'Le Havre', destinationCountry: 'France', routeId: 'ningbo',
    mode: 'Ocean', status: 'On time', containers: 24, value: 1_530_000,
    eta: '2026-11-26', delayDays: 0, progress: 22, cargo: 'Seasonal decorations',
  },
  {
    id: 'SIP-2026-023', origin: 'Shenzhen', originCountry: 'China',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'shenzhen',
    mode: 'Ocean', status: 'On time', containers: 18, value: 2_210_000,
    eta: '2026-11-25', delayDays: 0, progress: 28, cargo: 'Personal grooming devices',
  },
  {
    id: 'SIP-2026-024', origin: 'Ho Chi Minh City', originCountry: 'Vietnam',
    destination: 'Marseille', destinationCountry: 'France', routeId: 'hochi',
    mode: 'Ocean', status: 'At risk', containers: 22, value: 1_430_000,
    eta: '2026-11-28', delayDays: 0, progress: 16, cargo: 'Ceramic tableware',
  },
]

export const routes: Route[] = [
  {
    id: 'shanghai', origin: 'Shanghai', destination: 'Le Havre',
    originCoordinates: [121.49, 31.23], destinationCoordinates: [0.11, 49.49],
    transitDays: 35, shipmentCount: initialShipments.filter((s) => s.routeId === 'shanghai').length,
  },
  {
    id: 'ningbo', origin: 'Ningbo', destination: 'Le Havre',
    originCoordinates: [121.55, 29.87], destinationCoordinates: [0.11, 49.49],
    transitDays: 34, shipmentCount: initialShipments.filter((s) => s.routeId === 'ningbo').length,
  },
  {
    id: 'shenzhen', origin: 'Shenzhen', destination: 'Marseille',
    originCoordinates: [114.06, 22.54], destinationCoordinates: [5.37, 43.30],
    transitDays: 29, shipmentCount: initialShipments.filter((s) => s.routeId === 'shenzhen').length,
  },
  {
    id: 'hochi', origin: 'Ho Chi Minh City', destination: 'Marseille',
    originCoordinates: [106.70, 10.78], destinationCoordinates: [5.37, 43.30],
    transitDays: 27, shipmentCount: initialShipments.filter((s) => s.routeId === 'hochi').length,
  },
  {
    id: 'singapore', origin: 'Singapore', destination: 'Le Havre',
    originCoordinates: [103.82, 1.35], destinationCoordinates: [0.11, 49.49],
    transitDays: 28, shipmentCount: initialShipments.filter((s) => s.routeId === 'singapore').length,
  },
]

export const scenarios: Scenario[] = [
  {
    id: 'cape',
    title: 'Cape of Good Hope',
    description: 'Reroute ocean cargo around southern Africa with reserved vessel capacity.',
    daysRecovered: 3,
    costIncrease: 12,
    co2Change: 18,
    recommended: false,
  },
  {
    id: 'air',
    title: 'Priority air freight',
    description: 'Move time-critical cargo to priority air freight for the fastest recovery.',
    daysRecovered: 7,
    costIncrease: 42,
    co2Change: 165,
    recommended: false,
  },
  {
    id: 'rail',
    title: 'Eurasian rail bridge',
    description: 'Use an overland rail connection to balance recovery, cost and emissions.',
    daysRecovered: 5,
    costIncrease: 18,
    co2Change: -24,
    recommended: true,
  },
]

const affectedRouteIds = new Set(['shanghai', 'ningbo', 'shenzhen', 'hochi'])

function isAffected(shipment: Shipment): boolean {
  return shipment.mode === 'Ocean'
    && shipment.status !== 'Delivered'
    && affectedRouteIds.has(shipment.routeId)
}

function shiftEta(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function simulateDisruption(shipments: Shipment[]): Shipment[] {
  return shipments.map((shipment) => isAffected(shipment)
    ? {
        ...shipment,
        delayDays: shipment.delayDays + 8,
        eta: shiftEta(shipment.eta, 8),
        status: 'Delayed',
      }
    : { ...shipment })
}

export function applyScenario(
  disruptedShipments: Shipment[],
  scenarioId: ScenarioId,
): Shipment[] {
  const scenario = scenarios.find((option) => option.id === scenarioId)
  if (!scenario) throw new RangeError(`Unknown scenario: ${scenarioId}`)

  return disruptedShipments.map((shipment) => {
    if (!isAffected(shipment) || shipment.delayDays <= 0) return { ...shipment }

    const recoveredDays = Math.min(shipment.delayDays, scenario.daysRecovered)
    const delayDays = shipment.delayDays - recoveredDays

    return {
      ...shipment,
      delayDays,
      eta: shiftEta(shipment.eta, -recoveredDays),
      status: delayDays === 0 ? 'On time' : 'Delayed',
      mode: scenarioId === 'air' ? 'Air' : scenarioId === 'rail' ? 'Rail' : shipment.mode,
    }
  })
}

export function getMetrics(shipments: Shipment[]) {
  const active = shipments.filter((shipment) => shipment.status !== 'Delivered')
  const delayedDeliveries = active.filter((shipment) => shipment.status === 'Delayed').length

  return {
    activeShipments: active.length,
    containersInTransit: active.reduce((sum, shipment) => sum + shipment.containers, 0),
    delayedDeliveries,
    totalValue: active.reduce((sum, shipment) => sum + shipment.value, 0),
    onTimeRate: active.length === 0
      ? 0
      : Math.round(((active.length - delayedDeliveries) / active.length) * 100),
  }
}

export function formatCurrency(value: number, compact = false, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value)
}

export function formatEta(iso: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso))
}
