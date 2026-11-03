import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, Globe2, Maximize, Minus, Plus, Ship, X } from 'lucide-react'
import type { Route, ScenarioId } from '../domain/supplyChain'
import worldMap from '../data/world-map.json'
import './route-map.css'

interface RouteMapProps {
  routes: Route[]
  disrupted: boolean
  selectedRoute: string | null
  onSelectRoute: (id: string | null) => void
  activeScenario?: ScenarioId | null
}

interface Camera {
  zoom: number
  x: number
  y: number
}

type Point = [number, number]

const WIDTH = 1100
const HEIGHT = 390
const OVERVIEW: Camera = { zoom: 1, x: WIDTH / 2, y: HEIGHT / 2 }
const CORRIDOR: Camera = { zoom: 1.7, x: 735, y: 175 }
const AFFECTED_ROUTES = new Set(['shanghai', 'ningbo', 'shenzhen', 'hochi'])
const SCENARIOS = {
  cape: { label: 'Cape of Good Hope', mode: 'Ocean diversion', color: 'purple' },
  air: { label: 'Air freight', mode: 'Priority air corridor', color: 'purple' },
  rail: { label: 'Eurasian rail', mode: 'Overland alternative', color: 'teal' },
} as const

function project([longitude, latitude]: Point): Point {
  return [(longitude + 180) * WIDTH / 360, 15 + (85 - latitude) * 360 / 170]
}

function boundedCamera(camera: Camera): Camera {
  const zoom = Math.min(3, Math.max(1, camera.zoom))
  const halfWidth = WIDTH / (2 * zoom)
  const halfHeight = HEIGHT / (2 * zoom)
  return {
    zoom,
    x: Math.max(halfWidth, Math.min(WIDTH - halfWidth, camera.x)),
    y: Math.max(halfHeight, Math.min(HEIGHT - halfHeight, camera.y)),
  }
}

// Shipping waypoints follow Malacca, the Indian Ocean, Suez, and Gibraltar.
function oceanPath(route: Route, lane: number): string {
  const [ox, oy] = project(route.originCoordinates)
  const [dx, dy] = project(route.destinationCoordinates)
  const offset = lane * 2.4
  const viaMalacca = route.originCoordinates[1] > 4
    ? `C ${ox + 27} ${oy + 31}, 902 ${191 + offset}, 870 ${198 + offset}`
    : `C ${ox - 1} ${oy + 5}, 879 ${196 + offset}, 870 ${198 + offset}`
  const approach = route.destinationCoordinates[1] > 46
    ? `C 577 112, 535 133, 515 121 C 505 106, 536 97, ${dx} ${dy}`
    : `C 614 110, 585 111, ${dx} ${dy}`
  return `M ${ox} ${oy} ${viaMalacca}
    C 834 ${207 + offset}, 789 ${204 + offset}, 758 ${187 + offset}
    C 728 ${174 + offset}, 696 ${177 + offset}, 682 163
    C 670 152, 657 144, 648 132
    C 645 122, 628 117, 614 119 ${approach}`
}

function alternativePath(route: Route, scenario: ScenarioId): string {
  const [ox, oy] = project(route.originCoordinates)
  const [dx, dy] = project(route.destinationCoordinates)
  if (scenario === 'air') {
    return `M ${ox} ${oy} C ${ox - 82} ${oy - 112}, ${dx + 115} ${dy - 94}, ${dx} ${dy}`
  }
  if (scenario === 'rail') {
    return `M ${ox} ${oy} C ${ox - 35} ${oy - 18}, 850 88, 797 92
      S 656 82, 613 88 S 572 91, ${dx} ${dy}`
  }
  const approach = route.destinationCoordinates[1] > 46
    ? `C 500 134, 521 98, ${dx} ${dy}`
    : `C 508 114, 538 120, ${dx} ${dy}`
  return `M ${ox} ${oy} C ${ox + 22} ${oy + 38}, 900 196, 867 204
    C 813 223, 712 287, 619 279 C 558 279, 506 211, 505 164 ${approach}`
}

function keyboardActivate(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

export default function RouteMap({
  routes,
  disrupted,
  selectedRoute,
  onSelectRoute,
  activeScenario = null,
}: RouteMapProps) {
  const instanceId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; camera: Camera } | null>(null)
  const [camera, setCamera] = useState<Camera>(OVERVIEW)
  const [isDragging, setIsDragging] = useState(false)
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null)
  const [focusedRoute, setFocusedRoute] = useState<string | null>(null)
  const featuredRoute = routes.find((route) => route.id === selectedRoute)
    ?? routes.find((route) => route.id === focusedRoute)
    ?? routes.find((route) => route.id === hoveredRoute)
    ?? routes[0]
  const featuredAffected = Boolean(featuredRoute && disrupted && AFFECTED_ROUTES.has(featuredRoute.id))
  const scenario = activeScenario ? SCENARIOS[activeScenario] : null
  const affectedCount = routes.filter((route) => disrupted && AFFECTED_ROUTES.has(route.id)).length
  const destinations = Array.from(
    new Map(routes.map((route) => [route.destination, route])).values(),
  )
  const transform = `translate(${WIDTH / 2 - camera.x * camera.zoom} ${HEIGHT / 2 - camera.y * camera.zoom}) scale(${camera.zoom})`
  const routeDescription = (route: Route) =>
    `${route.origin} to ${route.destination}, ${route.transitDays} days, ${route.shipmentCount} shipments${disrupted && AFFECTED_ROUTES.has(route.id) ? ', disrupted' : ', operational'}`

  function chooseRoute(route: Route) {
    const nextId = selectedRoute === route.id ? null : route.id
    onSelectRoute(nextId)
    if (nextId) {
      const [originX] = project(route.originCoordinates)
      const [destinationX] = project(route.destinationCoordinates)
      setCamera(boundedCamera({ ...CORRIDOR, x: (originX + destinationX) / 2 }))
    }
  }

  function changeZoom(delta: number) {
    setCamera((previous) => boundedCamera({
      ...previous,
      zoom: previous.zoom + delta,
      ...(previous.zoom === 1 && delta > 0 ? { x: CORRIDOR.x, y: CORRIDOR.y } : {}),
    }))
  }

  function pointerPosition(event: PointerEvent<SVGSVGElement>): DOMPoint | null {
    const matrix = svgRef.current?.getScreenCTM()
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null
  }

  function startDrag(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || camera.zoom === 1) return
    const target = event.target
    if (target instanceof Element && target.closest('[data-map-interactive]')) return
    const point = pointerPosition(event)
    if (!point) return
    drag.current = { pointerId: event.pointerId, x: point.x, y: point.y, camera }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    const currentDrag = drag.current
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return
    const point = pointerPosition(event)
    if (!point) return
    setCamera(boundedCamera({
      zoom: currentDrag.camera.zoom,
      x: currentDrag.camera.x - (point.x - currentDrag.x) / currentDrag.camera.zoom,
      y: currentDrag.camera.y - (point.y - currentDrag.y) / currentDrag.camera.zoom,
    }))
  }

  function endDrag(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setIsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      className={`route-map${disrupted ? ' route-map--disrupted' : ''}${isDragging ? ' route-map--dragging' : ''}`}
      data-zoomed={camera.zoom > 1}
      role="region"
      aria-label="Interactive global supply network"
    >
      <svg
        ref={svgRef}
        className="route-map__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-labelledby={`${instanceId}-title ${instanceId}-description`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => {
          drag.current = null
          setIsDragging(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onSelectRoute(null)
            setCamera(OVERVIEW)
          }
        }}
      >
        <title id={`${instanceId}-title`}>CIPLEK global supply network</title>
        <desc id={`${instanceId}-description`}>
          World map showing {routes.length} shipping routes from Asia to France.
          Select a route or origin port with Enter or Space to filter shipments.
          Use World or Asia to Europe to change the view, and drag the map when zoomed.
          {disrupted ? ` ${affectedCount} routes are disrupted in the Suez corridor.` : ''}
          {scenario ? ` ${scenario.label} alternative is shown alongside the original routes.` : ''}
        </desc>
        <defs>
          <radialGradient id={`${instanceId}-ocean-glow`} cx="70%" cy="36%" r="65%">
            <stop offset="0%" stopColor="var(--map-ocean-glow)" stopOpacity=".6" />
            <stop offset="100%" stopColor="var(--map-ocean)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${instanceId}-land`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--map-land-top)" />
            <stop offset="100%" stopColor="var(--map-land)" />
          </linearGradient>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill={`url(#${instanceId}-ocean-glow)`} />
        <g className="route-map__geography" transform={transform}>
          <g className="route-map__graticule" aria-hidden="true">
            {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((longitude) => {
              const [x] = project([longitude, 0])
              return <path key={`lon-${longitude}`} d={`M ${x} 15 V 385`} />
            })}
            {[-60, -30, 0, 30, 60].map((latitude) => {
              const [, y] = project([0, latitude])
              return <path key={`lat-${latitude}`} d={`M 0 ${y} H ${WIDTH}`} />
            })}
          </g>
          <g className="route-map__land" fill={`url(#${instanceId}-land)`} aria-hidden="true">
            {worldMap.countries.filter((country) => country.d).map((country) => (
              <path
                key={country.id}
                d={country.d}
                className={country.id === 'FRA' ? 'route-map__country--destination' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="route-map__geographic-labels" aria-hidden="true">
            <text x="252" y="106" className="route-map__continent-label">NORTH AMERICA</text>
            <text x="365" y="227" className="route-map__continent-label">SOUTH AMERICA</text>
            <text x="607" y="202" className="route-map__continent-label">AFRICA</text>
            <text x="862" y="119" className="route-map__country-label">CHINA</text>
            <text x="798" y="151" className="route-map__country-label">INDIA</text>
            <text x="968" y="251" className="route-map__continent-label">AUSTRALIA</text>
            <text x="155" y="205" className="route-map__ocean-label">Pacific Ocean</text>
            <text x="458" y="199" className="route-map__ocean-label">Atlantic</text>
            <text x="458" y="213" className="route-map__ocean-label">Ocean</text>
            <text x="758" y="239" className="route-map__ocean-label">Indian Ocean</text>
          </g>

          <g className="route-map__routes">
            {routes.map((route, index) => {
              const affected = disrupted && AFFECTED_ROUTES.has(route.id)
              const isSelected = selectedRoute === route.id
              const isEmphasized = isSelected || hoveredRoute === route.id || focusedRoute === route.id
              const isMuted = Boolean(selectedRoute && !isSelected)
              const d = oceanPath(route, index)
              const routeId = `${instanceId}-route-${route.id}`
              return (
                <g
                  key={route.id}
                  className={`route-map__route${affected ? ' route-map__route--affected' : ''}${isEmphasized ? ' route-map__route--emphasized' : ''}${isMuted ? ' route-map__route--muted' : ''}${index > 2 ? ' route-map__route--secondary' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Filter shipments: ${routeDescription(route)}`}
                  aria-pressed={isSelected}
                  data-map-interactive
                  onClick={() => chooseRoute(route)}
                  onKeyDown={(event) => keyboardActivate(event, () => chooseRoute(route))}
                  onMouseEnter={() => setHoveredRoute(route.id)}
                  onMouseLeave={() => setHoveredRoute(null)}
                  onFocus={() => setFocusedRoute(route.id)}
                  onBlur={() => setFocusedRoute(null)}
                >
                  <title>{routeDescription(route)}. Click to {isSelected ? 'clear filter' : 'filter shipments'}.</title>
                  <path className="route-map__route-glow" d={d} fill="none" vectorEffect="non-scaling-stroke" />
                  <path
                    id={routeId}
                    className="route-map__route-line"
                    d={d}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path className="route-map__route-hit" d={d} fill="none" vectorEffect="non-scaling-stroke" />
                  <circle className="route-map__moving-dot" r="3" aria-hidden="true">
                    <animateMotion
                      dur={`${14 + index * 2}s`}
                      begin={`${-index * 3}s`}
                      repeatCount="indefinite"
                    >
                      <mpath href={`#${routeId}`} />
                    </animateMotion>
                  </circle>
                </g>
              )
            })}
          </g>

          {activeScenario && (
            <g className={`route-map__alternatives route-map__alternatives--${scenario?.color}`} aria-label={`${scenario?.label} alternative corridors`}>
              {routes.filter((route) => AFFECTED_ROUTES.has(route.id)).map((route) => (
                <path
                  key={`alternative-${route.id}`}
                  d={alternativePath(route, activeScenario)}
                  className={`route-map__alternative${selectedRoute && selectedRoute !== route.id ? ' route-map__alternative--muted' : ''}`}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{route.origin} to {route.destination}: {scenario?.label} alternative</title>
                </path>
              ))}
              <g className="route-map__scenario-label" transform={activeScenario === 'cape' ? 'translate(645 299)' : activeScenario === 'rail' ? 'translate(728 73)' : 'translate(735 43)'}>
                <rect x="-76" y="-12" width="152" height="23" rx="11.5" />
                <text textAnchor="middle" y="3">{scenario?.label}</text>
              </g>
            </g>
          )}

          {disrupted && (
            <g className="route-map__chokepoint" transform="translate(665 149)" aria-label="Suez corridor disrupted">
              <circle r="13" className="route-map__chokepoint-halo" />
              <circle r="7" />
              <text y="3.5" textAnchor="middle">!</text>
              <rect x="-59" y="20" width="118" height="21" rx="5" />
              <text className="route-map__chokepoint-label" y="34" textAnchor="middle">SUEZ DISRUPTION</text>
            </g>
          )}

          <g className="route-map__ports">
            {routes.map((route, index) => {
              const [x, y] = project(route.originCoordinates)
              const selected = selectedRoute === route.id
              const affected = disrupted && AFFECTED_ROUTES.has(route.id)
              const labelX = route.id === 'hochi' ? x - 12 : x + 12
              const labelOffsetY = route.id === 'shanghai' ? -18
                : route.id === 'ningbo' ? 2
                : route.id === 'shenzhen' ? 9
                : route.id === 'singapore' ? 5 : -9
              const labelY = y + labelOffsetY
              return (
                <g
                  key={`port-${route.id}`}
                  transform={`translate(${x} ${y})`}
                  className={`route-map__port${affected ? ' route-map__port--affected' : ''}${selected ? ' route-map__port--selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${route.origin} port. ${routeDescription(route)}. ${selected ? 'Clear route filter' : 'Select route'}.`}
                  aria-pressed={selected}
                  data-map-interactive
                  onClick={() => chooseRoute(route)}
                  onKeyDown={(event) => keyboardActivate(event, () => chooseRoute(route))}
                  onMouseEnter={() => setHoveredRoute(route.id)}
                  onMouseLeave={() => setHoveredRoute(null)}
                  onFocus={() => setFocusedRoute(route.id)}
                  onBlur={() => setFocusedRoute(null)}
                >
                  <title>{routeDescription(route)}</title>
                  <circle className="route-map__port-hit" r={index < 2 ? 5 : 11} />
                  <circle className="route-map__port-halo" r="8" />
                  <circle className="route-map__port-dot" r={selected ? 4.5 : 3.4} />
                  <path className="route-map__port-tick" d="M -2 0 L -.3 1.5 L 2 -1.5" />
                  <text
                    className="route-map__port-label"
                    x={labelX - x}
                    y={labelY - y}
                    textAnchor={route.id === 'hochi' ? 'end' : 'start'}
                  >
                    {route.id === 'hochi' ? 'Ho Chi Minh' : route.origin}
                  </text>
                </g>
              )
            })}
            {destinations.map((route, index) => {
              const [x, y] = project(route.destinationCoordinates)
              const destinationSelected = routes.some((candidate) =>
                candidate.destination === route.destination && candidate.id === selectedRoute,
              )
              return (
                <g
                  key={`destination-${route.destination}`}
                  transform={`translate(${x} ${y})`}
                  className={`route-map__destination${destinationSelected ? ' route-map__destination--selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${route.destination}, France, destination port. Show all routes.`}
                  data-map-interactive
                  onClick={() => onSelectRoute(null)}
                  onKeyDown={(event) => keyboardActivate(event, () => onSelectRoute(null))}
                >
                  <title>{route.destination}, France · Destination hub · Click to show all routes</title>
                  <circle className="route-map__destination-hit" r="13" />
                  <circle className="route-map__destination-pulse" r="8" style={{ animationDelay: `${index * .8}s` }} />
                  <circle className="route-map__destination-ring" r="7" />
                  <circle className="route-map__destination-dot" r="3.6" />
                  <text className="route-map__destination-label" x="-14" y={index === 0 ? -8 : 17} textAnchor="end">
                    {route.destination}
                  </text>
                </g>
              )
            })}
            <text className="route-map__france-label" x="540" y="73" textAnchor="middle" aria-hidden="true">FRANCE</text>
          </g>
        </g>
      </svg>

      <div className="route-map__live" title="Local simulation · no external tracking service">
        <span className="route-map__live-dot" />
        LIVE NETWORK
      </div>
      <div className="route-map__view-switch" role="group" aria-label="Map region">
        <button
          type="button"
          className={camera.zoom === 1 ? 'is-active' : ''}
          aria-pressed={camera.zoom === 1}
          onClick={() => setCamera(OVERVIEW)}
        >
          <Globe2 size={12} aria-hidden="true" />
          World
        </button>
        <button
          type="button"
          className={camera.zoom > 1 ? 'is-active' : ''}
          aria-pressed={camera.zoom > 1}
          onClick={() => setCamera(CORRIDOR)}
        >
          Asia <span aria-hidden="true">→</span> Europe
        </button>
      </div>

      {featuredRoute ? (
        <div className={`route-map__info${featuredAffected ? ' route-map__info--affected' : ''}`} aria-live="polite" aria-atomic="true">
          <div className="route-map__info-eyebrow">
            <span>{selectedRoute ? 'SELECTED ROUTE' : 'ROUTE SPOTLIGHT'}</span>
            {selectedRoute ? (
              <button type="button" aria-label="Clear selected route filter" onClick={() => onSelectRoute(null)}>
                <X size={12} aria-hidden="true" />
              </button>
            ) : <ArrowUpRight size={12} aria-hidden="true" />}
          </div>
          <button type="button" className="route-map__info-route" onClick={() => chooseRoute(featuredRoute)}>
            <span className="route-map__info-icon"><Ship size={16} aria-hidden="true" /></span>
            <span>
              <strong>{featuredRoute.origin === 'Ho Chi Minh City' ? 'Ho Chi Minh' : featuredRoute.origin} <span aria-hidden="true">→</span> {featuredRoute.destination}</strong>
              <span className="route-map__info-subtitle">
                {featuredAffected ? 'Suez corridor disrupted' : 'Ocean freight · via Suez Canal'}
              </span>
            </span>
          </button>
          <div className="route-map__info-stats">
            <span><strong>{featuredRoute.transitDays}<small>d</small></strong> base transit</span>
            <span className="route-map__info-divider" />
            <span><strong>{featuredRoute.shipmentCount}</strong> shipments</span>
            <span className={`route-map__info-status${featuredAffected ? ' is-affected' : ''}`} title={featuredAffected ? 'Route disrupted' : 'Route operational'}>
              {featuredAffected ? '!' : <Check size={10} aria-hidden="true" />}
            </span>
          </div>
          {scenario && featuredAffected && <div className={`route-map__info-alternative route-map__info-alternative--${scenario.color}`}><ArrowDownLeft size={11} aria-hidden="true" /> {scenario.label} alternative shown</div>}
        </div>
      ) : (
        <div className="route-map__empty">No routes in this view</div>
      )}

      <div className="route-map__bottom-bar">
        <div className="route-map__zoom" role="group" aria-label="Map zoom controls">
          <button type="button" aria-label="Zoom in on shipping network" title="Zoom in" disabled={camera.zoom >= 3} onClick={() => changeZoom(.4)}>
            <Plus size={15} aria-hidden="true" />
          </button>
          <span />
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={camera.zoom <= 1} onClick={() => changeZoom(-.4)}>
            <Minus size={15} aria-hidden="true" />
          </button>
          <span />
          <button type="button" aria-label="Reset to full world map" title="Reset view" onClick={() => setCamera(OVERVIEW)}>
            <Maximize size={13} aria-hidden="true" />
          </button>
        </div>
        <div className="route-map__map-note">
          {camera.zoom > 1 ? 'Drag to explore' : 'Click a port to explore'}
          <span>·</span>
          <span title={`${worldMap.source}. ${worldMap.license}`}>Natural Earth</span>
        </div>
        <div className="route-map__legend" aria-label="Map legend">
          <span><i className="route-map__legend-line" /> Active route</span>
          {disrupted && <span><i className="route-map__legend-line route-map__legend-line--affected" /> Disrupted</span>}
          {scenario && <span><i className={`route-map__legend-line route-map__legend-line--${scenario.color}`} /> Alternative</span>}
          <span><i className="route-map__legend-port" /> Port</span>
        </div>
      </div>

      <div className="route-map__sr-only" aria-live="polite">
        {selectedRoute && featuredRoute ? `Filtering shipments for ${featuredRoute.origin} to ${featuredRoute.destination}.` : 'Showing all shipping routes.'}
        {disrupted ? ` ${affectedCount} original routes disrupted.` : ''}
      </div>
      <span className="route-map__sr-only">
        Map zoom: {Math.round(camera.zoom * 100)} percent.
      </span>
    </div>
  )
}
