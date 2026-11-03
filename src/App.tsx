import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType } from 'react'
import {
  Activity, ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpRight,
  Bell, Box, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, Clock3, Container, Ellipsis, Euro, FlaskConical,
  Globe2, LayoutDashboard, Leaf, Menu, Moon, Package, Plane, Plus,
  RotateCcw, Search, Ship, SlidersHorizontal, Sparkles, Sun, TrainFront, TriangleAlert,
  TrendingUp, X,
} from 'lucide-react'
import {
  applyScenario, formatCurrency, formatEta, getMetrics, initialShipments,
  routes, scenarios, simulateDisruption,
} from './domain/supplyChain'
import type { ScenarioId, Shipment, ShipmentStatus } from './domain/supplyChain'
import RouteMap from './components/RouteMap'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis,
} from 'recharts'
import './App.css'

type View = 'Overview' | 'Shipments' | 'Analytics' | 'Scenarios'
type SortKey = 'id' | 'origin' | 'destination' | 'eta' | 'status' | 'containers' | 'value'
const pageSize = 6
const statusClass: Record<ShipmentStatus, string> = {
  'On time': 'on-time', Delayed: 'delayed', 'At risk': 'at-risk', Delivered: 'delivered',
}
const navigation: { name: View; icon: ElementType; caption?: string }[] = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Shipments', icon: Ship },
  { name: 'Analytics', icon: Activity },
  { name: 'Scenarios', icon: FlaskConical, caption: 'LAB' },
]

function AnimatedNumber({ value, currency = false }: { value: number; currency?: boolean }) {
  const [display, setDisplay] = useState(0)
  const previous = useRef(0)
  const frame = useRef(0)
  useEffect(() => {
    const from = previous.current
    previous.current = value
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const animate = (now: number) => {
      const progress = reducedMotion ? 1 : Math.min((now - start) / 750, 1)
      setDisplay(Math.round(from + (value - from) * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame.current = requestAnimationFrame(animate)
    }
    frame.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame.current)
  }, [value])
  return <span aria-label={currency ? formatCurrency(value) : value.toLocaleString('en-GB')}>
    <span aria-hidden="true">{currency ? formatCurrency(display, true) : display.toLocaleString('en-GB')}</span>
  </span>
}

function App() {
  const [view, setView] = useState<View>('Overview')
  const [disrupted, setDisrupted] = useState(false)
  const [scenario, setScenario] = useState<ScenarioId | null>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('All statuses')
  const [mode, setMode] = useState('All modes')
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'id', ascending: true })
  const [page, setPage] = useState(1)
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [detail, setDetail] = useState<Shipment | null>(null)
  const [toast, setToast] = useState('')
  const [period, setPeriod] = useState('This week')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const drawerWasOpen = useRef(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const update = () => setIsMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!mobileOpen || !isMobile) {
      if (drawerWasOpen.current) menuRef.current?.focus()
      drawerWasOpen.current = false
      return
    }
    drawerWasOpen.current = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sidebarRef.current?.querySelector<HTMLButtonElement>('.sidebar-close')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); menuRef.current?.focus() }
      if (event.key !== 'Tab') return
      const controls = sidebarRef.current?.querySelectorAll<HTMLElement>('a, button')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
    }
  }, [mobileOpen, isMobile])

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim().toLowerCase()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const followSystem = () => {
      try { if (localStorage.getItem('ciplek-theme')) return } catch { /* Storage may be unavailable. */ }
      const next = media.matches ? 'dark' : 'light'
      document.documentElement.dataset.theme = next
      setTheme(next)
    }
    media.addEventListener('change', followSystem)
    return () => media.removeEventListener('change', followSystem)
  }, [])
  useEffect(() => {
    if ((detail || helpOpen) && !dialogRef.current?.open) dialogRef.current?.showModal()
    if (!detail && !helpOpen) dialogRef.current?.close()
  }, [detail, helpOpen])

  const shipments = useMemo(() => {
    if (!disrupted) return initialShipments
    const impacted = simulateDisruption(initialShipments)
    return scenario ? applyScenario(impacted, scenario) : impacted
  }, [disrupted, scenario])
  const metrics = getMetrics(shipments)
  const baseline = getMetrics(initialShipments)
  const filtered = useMemo(() => shipments.filter((shipment) => {
    const matchesSearch = [
      shipment.id, shipment.origin, shipment.originCountry, shipment.destination,
      shipment.destinationCountry, shipment.cargo, shipment.mode, shipment.status,
    ].some((value) => value.toLowerCase().includes(query))
    return matchesSearch && (status === 'All statuses' || shipment.status === status)
      && (mode === 'All modes' || shipment.mode === mode)
      && (!selectedRoute || shipment.routeId === selectedRoute)
  }).sort((a, b) => {
    const left = a[sort.key]
    const right = b[sort.key]
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right : String(left).localeCompare(String(right))
    return sort.ascending ? comparison : -comparison
  }), [shipments, query, status, mode, selectedRoute, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visibleShipments = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const affected = shipments.filter((s) => s.status === 'Delayed' && s.delayDays > 0)
  const periodData = period === 'This week'
    ? [{ day: 'Mon', volume: 22 }, { day: 'Tue', volume: 34 }, { day: 'Wed', volume: 28 }, { day: 'Thu', volume: 47 }, { day: 'Fri', volume: 39 }, { day: 'Sat', volume: 56 }, { day: 'Sun', volume: 48 }]
    : [{ day: 'W1', volume: 128 }, { day: 'W2', volume: 154 }, { day: 'W3', volume: 139 }, { day: 'W4', volume: 182 }]
  const chartData = periodData.map((point) => ({ ...point, onTime: Math.round(point.volume * metrics.onTimeRate / 100) }))

  const changeView = (next: View) => {
    setView(next)
    setMobileOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('ciplek-theme', next) } catch { /* The theme still works without storage. */ }
  }
  const resetFilters = () => {
    setSearch(''); setQuery(''); setStatus('All statuses'); setMode('All modes'); setSelectedRoute(null); setPage(1)
  }
  const selectRoute = (id: string | null) => { setSelectedRoute(id); setPage(1) }
  const toggleDisruption = () => {
    setDisrupted(!disrupted)
    setScenario(null)
    setToast(disrupted ? 'Simulation reset. Your baseline network is restored.' : 'Suez Canal disruption simulated. Routes and delivery estimates updated.')
  }
  const exportReport = () => {
    const rows = [
      ['Shipment', 'Origin', 'Destination', 'Status', 'Mode', 'Containers', 'ETA', 'Delay days', 'Value EUR'],
      ...filtered.map((s) => [s.id, s.origin, s.destination, s.status, s.mode, s.containers, s.eta, s.delayDays, s.value]),
    ]
    const csv = rows.map((row) => row.map((cell) => {
      const text = String(cell)
      return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`
    }).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `ciplek-${disrupted ? 'simulation' : 'shipments'}-2026-11.csv`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setToast(`${filtered.length} synthetic shipments exported to CSV.`)
  }
  const sortBy = (key: SortKey) => {
    setSort((old) => ({ key, ascending: old.key === key ? !old.ascending : true }))
    setPage(1)
  }
  const renderSortHeader = (key: SortKey, label: string) => <th scope="col" aria-sort={sort.key === key ? (sort.ascending ? 'ascending' : 'descending') : 'none'}>
    <button className="sort-button" onClick={() => sortBy(key)}>{label}{sort.key === key ? (sort.ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronDown size={12} />}</button>
  </th>
  const kpis = [
    { label: 'Active shipments', value: metrics.activeShipments, icon: Ship, tone: 'teal', trend: 'Across 5 trade routes', detail: 'shipments', bars: [30, 48, 40, 63, 53, 78, 70, 91, 82, 100] },
    { label: 'Containers in transit', value: metrics.containersInTransit, icon: Container, tone: 'blue', trend: 'Moving your business forward', detail: 'containers', bars: [45, 37, 57, 48, 72, 60, 85, 75, 96, 89] },
    { label: 'Delayed deliveries', value: metrics.delayedDeliveries, icon: Clock3, tone: 'amber', trend: disrupted ? `${metrics.delayedDeliveries - baseline.delayedDeliveries} vs. baseline` : `${routes.filter((r) => initialShipments.some((s) => s.routeId === r.id && s.status === 'Delayed')).length} routes need attention`, detail: 'deliveries', bars: [80, 65, 75, 45, 53, 30, 42, 27, 35, 20] },
    { label: 'Total shipment value', value: metrics.totalValue, icon: Euro, tone: 'violet', trend: 'In active shipments · EUR', detail: 'shipment value', currency: true, bars: [20, 38, 31, 52, 45, 65, 58, 78, 88, 100] },
  ]

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside ref={sidebarRef} className={`sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Main navigation" role={isMobile && mobileOpen ? 'dialog' : undefined} aria-modal={isMobile && mobileOpen ? true : undefined} inert={isMobile && !mobileOpen}>
        <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => { setMobileOpen(false); menuRef.current?.focus() }}><X size={19} /></button>
        <a href="#" className="brand" aria-label="CIPLEK Control Tower home" onClick={(event) => { event.preventDefault(); changeView('Overview') }}>
          <span className="brand-symbol"><Box size={25} strokeWidth={1.7} /></span>
          <span>CIPLEK<span className="brand-subtitle">CONTROL TOWER</span></span>
          <span className="brand-dot" />
        </a>
        <div className="workspace"><span className="workspace-icon"><Globe2 size={18} /></span><span>Global operations<small>Supply chain workspace</small></span><ChevronDown size={14} /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navigation.map(({ name, icon: Icon, caption }) => (
            <button key={name} className={`nav-item ${view === name ? 'active' : ''}`} aria-current={view === name ? 'page' : undefined} onClick={() => changeView(name)}>
              <Icon size={19} /><span>{name}</span>{caption && <span className="nav-badge">{caption}</span>}{name === 'Shipments' && <span className="nav-count">{metrics.activeShipments}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="network-status"><span className="status-light" /><span>All systems operational</span><ArrowUpRight size={13} /></div>
          <div className="sidebar-help"><div className="help-orbit"><Sparkles size={20} /></div><h3>A clearer view. Better decisions.</h3><p>Your entire supply chain,<br />one connected workspace.</p><button onClick={() => setHelpOpen(true)}>Explore your control tower <ArrowRight size={14} /></button></div>
          <button className="help-link" onClick={() => setHelpOpen(true)}><CircleHelp size={18} />Help & getting started<ArrowUpRight size={14} /></button>
          <div className="profile"><span className="avatar">ML</span><span>Marie Laurent<small>Supply Chain Manager</small></span><span className="profile-badge">DEMO</span></div>
        </div>
      </aside>

      <div className="main-shell" inert={isMobile && mobileOpen}>
        <header className="topbar">
          <div className="breadcrumb"><button ref={menuRef} className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{view}</strong></div>
          <div className="topbar-actions"><span className="demo-label"><span />Synthetic data · Demo environment</span><span className="topbar-divider" /><button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button><div className="notification-wrap"><button className={`icon-button notification-button ${notificationsOpen ? 'selected' : ''}`} aria-label="View notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={19} /><span className="notification-dot" /></button>{notificationsOpen && <div className="notification-popover"><strong>Network notifications</strong><p><span className="status-light" />All 5 trade routes are being monitored.</p><p><TriangleAlert size={15} />{metrics.delayedDeliveries} deliveries need your attention.</p><small>Demo alerts derived from synthetic data.</small></div>}</div><span className="avatar topbar-avatar">ML</span></div>
        </header>

        <main id="main-content">
          <section className="page-heading">
            <div><div className="eyebrow"><span />CONNECTED INTELLIGENCE</div><h1>{view === 'Overview' ? 'Your supply chain. In focus.' : view === 'Shipments' ? 'Every shipment. Every milestone.' : view === 'Analytics' ? 'Clarity behind every movement.' : 'Plan for the unexpected.'}</h1><p>{view === 'Overview' ? 'A global perspective. The confidence to move forward.' : view === 'Shipments' ? 'Track, filter, and explore every shipment across your network.' : view === 'Analytics' ? 'Turn your network performance into your next advantage.' : 'Explore disruptions, compare alternatives, and build a more resilient network.'}</p></div>
            <div className="heading-actions"><span className="date-label"><CalendarDays size={15} />Nov 2026<span className="date-label-dot" /></span><button className="button button-outline" onClick={exportReport}><ArrowDownToLine size={16} /><span>Export report</span></button></div>
          </section>

          <section className="kpi-grid" aria-label="Network key performance indicators">
            {kpis.map(({ label, value, icon: Icon, tone, trend, currency, bars }) => (
              <article className={`kpi-card ${tone}`} key={label}>
                <div className="kpi-top"><span>{label}</span><span className="kpi-icon"><Icon size={18} /></span></div>
                <div className="kpi-middle"><strong><AnimatedNumber value={value} currency={currency} /></strong><div className="mini-bars" aria-hidden="true">{bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div>
                <div className="kpi-bottom">{tone === 'amber' ? <span className="trend-tag amber"><TriangleAlert size={11} />{disrupted ? 'Simulation' : 'Monitor'}</span> : <span className="trend-tag"><ArrowUpRight size={12} />{tone === 'teal' ? 'Live' : tone === 'blue' ? 'In transit' : 'Portfolio'}</span>}<span>{trend}</span></div>
              </article>
            ))}
          </section>

          {(view === 'Overview' || view === 'Scenarios') && <section className={`simulation-strip ${disrupted ? 'is-disrupted' : ''}`} aria-label="Disruption simulation">
            <span className="simulation-icon">{disrupted ? <TriangleAlert size={21} /> : <FlaskConical size={21} />}</span>
            <div><h2>{disrupted ? (scenario ? 'Alternative scenario applied' : 'Suez Canal disruption · Simulation active') : 'What if your supply chain took an unexpected turn?'}</h2><p>{disrupted ? `${affected.length} delayed shipments · Delivery estimates recalculated${scenario ? ` · ${scenarios.find((s) => s.id === scenario)?.title}` : ' · Compare alternative routes below'}` : 'Simulate a disruption. Understand the impact. Find a smarter way forward.'}</p></div>
            <button className={`button ${disrupted ? 'button-outline' : 'button-dark'}`} onClick={toggleDisruption}>{disrupted ? <RotateCcw size={15} /> : <Plus size={16} />}{disrupted ? 'Reset simulation' : 'Simulate disruption'}</button>
          </section>}

          {(view === 'Overview' || view === 'Analytics') && <section className="network-grid">
            <article className="card map-card">
              <div className="card-heading"><div><h2>Global shipment network <span className="live-tag"><span />LIVE</span></h2><p>Connected across continents. Visible at every step.</p></div><button className="icon-button" aria-label="Clear selected route" title="Reset route selection" onClick={() => { setSelectedRoute(null); setToast('Showing all trade routes.') }}><Ellipsis size={20} /></button></div>
              <RouteMap routes={routes} disrupted={disrupted} selectedRoute={selectedRoute} onSelectRoute={selectRoute} activeScenario={scenario} />
              <div className="map-footer"><span><span className="status-light" />{routes.length} active trade routes</span><span><Ship size={13} />Asia <ArrowRight size={12} /> France</span><span>Click a route to explore <ArrowUpRight size={12} /></span></div>
            </article>
            <article className="card performance-card">
              <div className="card-heading"><div><h2>Delivery performance</h2><p>Consistency that moves you forward.</p></div><TrendingUp size={18} className="muted" /></div>
              <div className="performance-value"><strong>{metrics.onTimeRate}<span>%</span></strong><span className={`performance-trend ${disrupted ? 'negative' : ''}`}>{disrupted ? <ArrowDown size={13} /> : <ArrowUpRight size={13} />}{disrupted ? `${baseline.onTimeRate - metrics.onTimeRate} pts` : 'On track'}</span></div>
              <div className="performance-caption">On-time delivery rate <span>Active portfolio</span></div>
              <div className="performance-chart" role="img" aria-label={`Synthetic ${period.toLowerCase()} volume trend. Current on-time delivery rate: ${metrics.onTimeRate} percent.`}>
                <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 14, right: 2, left: 2, bottom: 0 }}><defs><linearGradient id="volume-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9986" stopOpacity={0.19} /><stop offset="100%" stopColor="#0d9986" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" /><XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} dy={6} /><Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 12 }} /><Area type="monotone" dataKey="volume" name="Shipment volume" stroke="#b3c9c4" fill="transparent" strokeDasharray="4 4" strokeWidth={1.5} /><Area type="monotone" dataKey="onTime" name="On time" stroke="#159c88" fill="url(#volume-fill)" strokeWidth={2.5} /></AreaChart></ResponsiveContainer>
              </div>
              <div className="performance-footer"><span><i />On time <i className="legend-volume" />Total volume</span><select aria-label="Performance chart period" value={period} onChange={(e) => setPeriod(e.target.value)}><option>This week</option><option>This month</option></select></div>
            </article>
          </section>}

          {(disrupted || view === 'Scenarios') && view !== 'Shipments' && <section className="scenarios-section" aria-labelledby="scenario-heading">
            <div className="section-title"><div><div className="eyebrow"><Sparkles size={12} />RESILIENCE LAB</div><h2 id="scenario-heading">One disruption. Three ways forward.</h2><p>Compare the trade-offs. Choose the right move for your business.</p></div>{disrupted && <span className="simulation-pill">Simulation only · No live changes</span>}</div>
            {!disrupted && <div className="scenario-hint"><FlaskConical size={16} />Activate a disruption simulation above to compare and apply these alternatives.</div>}
            <div className="scenario-grid">{scenarios.map((item, index) => {
              const Icon = index === 0 ? Ship : index === 1 ? Plane : Container
              return <article className={`card scenario-card ${scenario === item.id ? 'chosen' : ''}`} key={item.id}><div className="scenario-card-top"><span className="scenario-icon"><Icon size={21} /></span>{item.recommended && <span className="recommended"><Sparkles size={11} />Recommended</span>}</div><h3>{item.title}</h3><p>{item.description}</p><div className="scenario-stats"><span><Clock3 size={14} /><strong>{item.daysRecovered} days</strong><small>recovered</small></span><span><Euro size={14} /><strong>+{item.costIncrease}%</strong><small>est. cost</small></span><span><Leaf size={14} /><strong>{item.co2Change > 0 ? '+' : ''}{item.co2Change}%</strong><small>est. CO₂</small></span></div><button className={`button ${scenario === item.id ? 'button-teal' : 'button-outline'}`} disabled={!disrupted || scenario === item.id} onClick={() => { setScenario(item.id); setToast(`${item.title} applied. Delivery estimates and KPIs updated.`) }}>{scenario === item.id ? <><CheckCheck size={16} />Scenario applied</> : <>Apply scenario<ArrowRight size={15} /></>}</button></article>
            })}</div>
          </section>}

          {(view === 'Overview' || view === 'Shipments') && <section className="card shipments-card" aria-labelledby="shipments-heading">
            <div className="card-heading shipment-card-heading"><div><h2 id="shipments-heading">Shipment tracker <span className="count-badge">{shipments.length}</span></h2><p>Every journey, from origin to destination.</p></div>{view === 'Overview' && <button className="text-button" onClick={() => changeView('Shipments')}>View all shipments <ArrowUpRight size={14} /></button>}</div>
            <div className="table-toolbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shipments, ports, cargo..." aria-label="Search shipments" />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label><div className="filter-controls"><SlidersHorizontal size={15} className="muted" /><select aria-label="Filter by shipment status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option>All statuses</option><option>On time</option><option>Delayed</option><option>At risk</option><option>Delivered</option></select><select aria-label="Filter by transport mode" value={mode} onChange={(e) => { setMode(e.target.value); setPage(1) }}><option>All modes</option><option>Ocean</option><option>Air</option><option>Rail</option></select><select aria-label="Filter by trade route" value={selectedRoute ?? ''} onChange={(e) => selectRoute(e.target.value || null)}><option value="">All routes</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.origin}</option>)}</select></div></div>
            {(selectedRoute || status !== 'All statuses' || mode !== 'All modes' || search) && <div className="active-filters"><span>{filtered.length} matching shipments{selectedRoute ? ` · ${routes.find((r) => r.id === selectedRoute)?.origin} route` : ''}</span><button onClick={resetFilters}>Clear filters <X size={12} /></button></div>}
            <div className="table-scroll">
              <table>
                <caption className="sr-only">Synthetic shipment tracking. Select column headings to sort, and shipment IDs for details.</caption>
                <thead><tr>
                  {renderSortHeader('id', 'Shipment ID')}
                  {renderSortHeader('origin', 'Origin')}
                  {renderSortHeader('destination', 'Destination')}
                  <th scope="col">Mode</th>
                  {renderSortHeader('status', 'Status')}
                  {renderSortHeader('eta', 'Est. arrival')}
                  {renderSortHeader('containers', 'Containers')}
                  <th scope="col">Journey</th>
                  <th scope="col"><span className="sr-only">Details</span></th>
                </tr></thead>
                <tbody>{visibleShipments.map((shipment) => (
                  <tr key={shipment.id}>
                    <td><button className="shipment-id" onClick={() => setDetail(shipment)}><span className="shipment-box"><Package size={15} /></span>{shipment.id}</button></td>
                    <td><strong>{shipment.origin}</strong><small>{shipment.originCountry}</small></td>
                    <td><strong>{shipment.destination}</strong><small>{shipment.destinationCountry}</small></td>
                    <td><span className="mode-label">{shipment.mode === 'Ocean' ? <Ship size={13} /> : shipment.mode === 'Rail' ? <TrainFront size={13} /> : <Plane size={13} />}{shipment.mode}</span></td>
                    <td><span className={`shipment-status ${statusClass[shipment.status]}`}><i />{shipment.status}</span></td>
                    <td><span className="eta">{formatEta(shipment.eta)}</span>{shipment.delayDays > 0 && <small className="delay-text">+{shipment.delayDays} days</small>}</td>
                    <td><span className="container-count">{shipment.containers}<small>TEU</small></span></td>
                    <td><div className="journey"><div className={`journey-track ${shipment.status === 'Delayed' ? 'journey-delayed' : ''}`}><span style={{ width: `${shipment.progress}%` }} /></div><span>{shipment.progress}%</span></div></td>
                    <td><button className="icon-button row-detail" aria-label={`View ${shipment.id} details`} onClick={() => setDetail(shipment)}><ArrowUpRight size={16} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
              {filtered.length === 0 && <div className="empty-state"><Search size={26} /><h3>No shipments found</h3><p>Try another search or clear your filters.</p><button className="button button-outline" onClick={resetFilters}>Clear filters</button></div>}
            </div>
            <div className="table-footer"><p>Showing <strong>{filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong> shipments</p><div className="pagination"><button aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></button>{Array.from({ length: pages }, (_, index) => <button key={index} className={currentPage === index + 1 ? 'current' : ''} aria-label={`Page ${index + 1}`} aria-current={currentPage === index + 1 ? 'page' : undefined} onClick={() => setPage(index + 1)}>{index + 1}</button>)}<button aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></button></div></div>
          </section>}

          {view === 'Analytics' && <section className="card route-analytics"><div className="card-heading"><div><h2>Trade route performance</h2><p>Current synthetic portfolio, grouped by origin.</p></div><Globe2 size={20} className="muted" /></div><div className="analytics-routes">{routes.map((route) => {
            const routeShipments = shipments.filter((s) => s.routeId === route.id)
            const routeMetrics = getMetrics(routeShipments)
            return <div key={route.id}><span className="analytics-route-icon"><Ship size={18} /></span><strong>{route.origin}<small>{route.destination}, France</small></strong><span>{routeMetrics.activeShipments}<small>active shipments</small></span><span>{routeMetrics.delayedDeliveries}<small>delayed</small></span><span className="route-rate">{routeMetrics.onTimeRate}%<small>on time</small></span></div>
          })}</div></section>}

          <footer className="page-footer"><span><span className="footer-mark"><Box size={13} /></span>CIPLEK Control Tower<span className="footer-separator">/</span>Built for a connected world.</span><span><span className="status-light" />All data is synthetic<span className="footer-separator">·</span>November 2026</span></footer>
        </main>
      </div>
      <div className={`toast ${toast ? 'visible' : ''}`} role="status">{toast && <><Check size={17} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></button></>}</div>
      <dialog ref={dialogRef} className="detail-dialog" aria-labelledby="dialog-heading" onCancel={() => { setDetail(null); setHelpOpen(false) }} onClick={(e) => { if (e.target === e.currentTarget) { setDetail(null); setHelpOpen(false) } }}>
        <button className="icon-button dialog-close" aria-label="Close dialog" onClick={() => { setDetail(null); setHelpOpen(false) }}><X size={20} /></button>
        {detail ? <><span className="dialog-symbol"><Package size={26} /></span><div className="eyebrow">SHIPMENT DETAILS</div><h2 id="dialog-heading">{detail.id}</h2><p className="dialog-subtitle">{detail.cargo}</p><div className="detail-route"><span><small>ORIGIN</small><strong>{detail.origin}</strong>{detail.originCountry}</span><ArrowRight size={24} /><span><small>DESTINATION</small><strong>{detail.destination}</strong>{detail.destinationCountry}</span></div><dl className="detail-grid"><div><dt>Status</dt><dd><span className={`shipment-status ${statusClass[detail.status]}`}><i />{detail.status}</span></dd></div><div><dt>Transport</dt><dd>{detail.mode}</dd></div><div><dt>Estimated arrival</dt><dd>{formatEta(detail.eta)}</dd></div><div><dt>Delay</dt><dd>{detail.delayDays} days</dd></div><div><dt>Containers</dt><dd>{detail.containers} TEU</dd></div><div><dt>Shipment value</dt><dd>{formatCurrency(detail.value)}</dd></div></dl><p className="dialog-note"><CircleHelp size={14} />Synthetic shipment. No live tracking or personal data.</p></> : helpOpen ? <><span className="dialog-symbol"><Globe2 size={27} /></span><div className="eyebrow">WELCOME ABOARD</div><h2 id="dialog-heading">Your world, connected.</h2><p className="dialog-subtitle">A decision-making workspace for CIPLEK's supply chain.</p><ul className="help-steps"><li><Globe2 size={20} /><span><strong>Explore your network</strong>Click map routes to filter shipments. Zoom in for a closer look.</span></li><li><Search size={20} /><span><strong>Find every shipment</strong>Search ports and cargo, filter status, or sort table columns.</span></li><li><FlaskConical size={20} /><span><strong>Test your resilience</strong>Simulate a Suez disruption, then compare and apply three alternatives. Reset anytime.</span></li></ul><p className="dialog-note"><CircleHelp size={14} />Entirely synthetic data. No backend, API keys, or real authorization.</p><button className="button button-teal" onClick={() => setHelpOpen(false)}>Let's explore <ArrowRight size={16} /></button></> : null}
      </dialog>
    </div>
  )
}

export default App
