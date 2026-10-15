import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImportWizard } from './components/ImportWizard'
import { Icon, Logo, type IconName } from './components/Icon'
import { LeadSheet } from './components/LeadSheet'
import { LeadsPanel } from './components/LeadsPanel'
import { Login, SetPassword } from './components/Login'
import { MapView, type MapHandle } from './components/MapView'
import { MorePanel } from './components/MorePanel'
import { RoutePanel } from './components/RoutePanel'
import { TeamPanel } from './components/TeamPanel'
import { useSnapshot, visibleLeads, type Store } from './data/store'
import { STATUS, STATUS_ORDER } from './lib/dispositions'
import { activeClaim } from './lib/leads'
import { insidePolygon, milesBetween, optimizeOrder, type NavApp, type Point } from './lib/route'
import type { Lead, LeadStatus, Outcome } from './types'

type Tab = 'map' | 'route' | 'leads' | 'team' | 'more'
type MapFilter = 'all' | 'open' | 'new' | 'callbacks' | 'appointments'

const FILTERS: { key: MapFilter; label: string; match(s: LeadStatus): boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'open', label: 'Still open', match: (s) => !STATUS[s].closed },
  { key: 'new', label: 'Not worked', match: (s) => s === 'new' },
  { key: 'callbacks', label: 'Follow-ups', match: (s) => s === 'follow_up' },
  { key: 'appointments', label: 'Appointments', match: (s) => s === 'appointment' },
]

interface SavedRoute {
  ids: string[]
  startedAt: string
}

function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: T) => {
      setV(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* ignore */
      }
    },
    [key],
  )
  return [v, set]
}

export function App({ store }: { store: Store }) {
  const snap = useSnapshot(store)
  if (!snap.ready) {
    return (
      <main className="login" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <span style={{ width: 64, height: 64 }}><Logo /></span>
      </main>
    )
  }
  if (!snap.me) return <Login store={store} snap={snap} />
  if (snap.mustChangePassword) return <SetPassword store={store} name={snap.me.name.split(' ')[0]} />
  return <Field store={store} />
}

function Field({ store }: { store: Store }) {
  const snap = useSnapshot(store)
  const me = snap.me!
  const isManager = me.role === 'manager'

  const [tab, setTab] = useState<Tab>('map')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [drawing, setDrawing] = useState(false)
  const [filter, setFilter] = useState<MapFilter>('all')
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [here, setHere] = useState<Point | null>(null)
  const [route, setRoute] = usePref<SavedRoute | null>(`knockroute-route-${me.id}`, null)
  const [navApp, setNavApp] = usePref<NavApp>('knockroute-nav', 'apple')
  const [satellite, setSatellite] = usePref('knockroute-sat', false)
  const [themeKey, setThemeKey] = useState('')
  const [assignTo, setAssignTo] = useState('')
  const [placingId, setPlacingId] = useState<string | null>(null)
  const mapRef = useRef<MapHandle | null>(null)
  const didFit = useRef(false)

  // Re-color pins when the phone flips between light and dark.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setThemeKey(mq.matches ? 'dark' : 'light')
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // Follow my location while the app is open.
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600)
  }

  const visible = useMemo(() => visibleLeads(snap), [snap])
  const byId = useMemo(() => new Map(visible.map((l) => [l.id, l])), [visible])
  const fmatch = FILTERS.find((f) => f.key === filter)!.match
  const mapLeads = useMemo(() => visible.filter((l) => fmatch(l.status)), [visible, fmatch])
  const claimedByOthers = useMemo(
    () => new Set(visible.filter((l) => { const c = activeClaim(l); return c && c !== me.id }).map((l) => l.id)),
    [visible, me.id],
  )
  const routeLeads = useMemo(() => (route ? route.ids.map((id) => byId.get(id)).filter((l): l is Lead => !!l) : []), [route, byId])
  const doneStops = useMemo(
    () => new Set(routeLeads.filter((l) => l.lastActivityAt && route && l.lastActivityAt >= route.startedAt).map((l) => l.id)),
    [routeLeads, route],
  )
  const openLead = openId ? byId.get(openId) ?? null : null

  // Frame all leads the first time the map has data.
  useEffect(() => {
    if (didFit.current || !mapRef.current) return
    const pts = (routeLeads.length ? routeLeads : visible).filter((l) => l.lat != null) as Point[]
    if (pts.length) {
      mapRef.current.fit(pts)
      didFit.current = true
    }
  }, [visible, routeLeads])

  const routable = (l: Lead) => l.lat != null && l.lng != null && !STATUS[l.status].closed && !claimedByOthers.has(l.id)

  async function planRoute(leads: Lead[]) {
    const stops = leads.filter(routable)
    if (!stops.length) {
      flash('No open leads to route there')
      return
    }
    const start = here ?? mapRef.current?.center() ?? (stops[0] as Point)
    const ordered = optimizeOrder(start, stops as (Lead & Point)[])
    if (route) await store.claim(route.ids.filter((id) => !ordered.some((o) => o.id === id)), false).catch(() => {})
    setRoute({ ids: ordered.map((l) => l.id), startedAt: new Date().toISOString() })
    await store.claim(ordered.map((l) => l.id), true).catch(() => {})
    setSelection(new Set())
    mapRef.current?.fit(ordered as Point[])
    setTab('route')
    flash(`Route planned: ${ordered.length} stops`)
  }

  function nearest(n: number) {
    const start = here ?? mapRef.current?.center()
    if (!start) return
    const pool = visible.filter((l) => routable(l) && !route?.ids.includes(l.id))
    pool.sort((a, b) => milesBetween(start, a as Point) - milesBetween(start, b as Point))
    planRoute(pool.slice(0, n))
  }

  async function toggleOnRoute(l: Lead) {
    if (route?.ids.includes(l.id)) {
      setRoute({ ...route, ids: route.ids.filter((id) => id !== l.id) })
      await store.claim([l.id], false).catch(() => {})
      flash('Removed from route')
    } else {
      const ids = [...(route?.ids ?? []), l.id]
      const leads = ids.map((id) => byId.get(id)).filter((x): x is Lead => !!x && x.lat != null)
      const start = here ?? (leads[0] as Point)
      const ordered = optimizeOrder(start, leads as (Lead & Point)[])
      setRoute({ ids: ordered.map((x) => x.id), startedAt: route?.startedAt ?? new Date().toISOString() })
      await store.claim([l.id], true).catch(() => {})
      flash(`Added as stop ${ordered.findIndex((x) => x.id === l.id) + 1}`)
    }
  }

  function reoptimize() {
    if (!route) return
    const remaining = routeLeads.filter((l) => !doneStops.has(l.id))
    const done = routeLeads.filter((l) => doneStops.has(l.id))
    const start = here ?? (remaining[0] as Point)
    if (!start) return
    const ordered = optimizeOrder(start, remaining as (Lead & Point)[])
    setRoute({ ...route, ids: [...done, ...ordered].map((l) => l.id) })
    flash('Re-ordered from your location')
  }

  async function endRoute() {
    if (!route) return
    const unvisited = routeLeads.filter((l) => !doneStops.has(l.id)).map((l) => l.id)
    await store.claim(unvisited, false).catch(() => {})
    setRoute(null)
    flash('Route ended')
  }

  function onSaved(l: Lead, outcome: Outcome) {
    const onRoute = route?.ids.includes(l.id)
    flash(`Saved: ${STATUS[outcome].label}. The team sees it now.`)
    if (onRoute) {
      setOpenId(null)
      setTab('route')
    }
  }

  function onLasso(poly: Point[]) {
    setDrawing(false)
    const hit = mapLeads.filter((l) => l.lat != null && insidePolygon(l as Point, poly))
    setSelection(new Set(hit.map((l) => l.id)))
    if (!hit.length) flash('No pins inside that shape')
  }

  function openFromList(l: Lead) {
    setOpenId(l.id)
    setTab('map')
    if (l.lat != null) mapRef.current?.flyTo(l as Point)
  }

  const selected = [...selection].map((id) => byId.get(id)).filter((l): l is Lead => !!l)
  const selectedOpen = selected.filter(routable).length
  const remaining = routeLeads.length - doneStops.size

  const tabs: { key: Tab; label: string; icon: IconName; badge?: number }[] = [
    { key: 'map', label: 'Map', icon: 'map' },
    { key: 'route', label: 'Route', icon: 'route', badge: remaining || undefined },
    { key: 'leads', label: 'Leads', icon: 'list' },
    { key: 'team', label: 'Team', icon: 'team' },
    { key: 'more', label: 'More', icon: 'more' },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <span className="brandmark"><Logo /> KnockRoute</span>
        <span className="spacer" />
        <span className={`live-pill${store.mode === 'demo' ? ' demo' : ''}`} title={store.mode === 'demo' ? 'Sample data on this phone only' : 'Connected to team data'}>
          <span className="live-dot" /> {store.mode === 'demo' ? 'Demo' : 'Live'}
        </span>
        <button className="avatar" onClick={() => setTab('more')} aria-label="Settings">
          {me.name.slice(0, 2).toUpperCase()}
        </button>
      </header>

      <div className="stage">
        <MapView
          leads={mapLeads}
          selected={selection}
          claimedByOthers={claimedByOthers}
          route={routeLeads}
          doneStops={doneStops}
          me={here}
          focusId={openId}
          drawing={drawing}
          satellite={satellite}
          themeKey={themeKey}
          onTap={(l) => !placingId && setOpenId(l.id)}
          onMapTap={
            placingId
              ? async (p) => {
                  const id = placingId
                  setPlacingId(null)
                  try {
                    await store.updateLeads([{ id, lat: p.lat, lng: p.lng, pinApprox: false }])
                    flash('Pin placed')
                  } catch (e) {
                    flash(`Couldn't save the pin: ${(e as Error).message}`)
                  }
                  setOpenId(id)
                }
              : undefined
          }
          onLasso={onLasso}
          onReady={(h) => (mapRef.current = h)}
        />

        {snap.error && <div className="banner" style={{ top: 60, bottom: 'auto' }}><span className="err">Can't reach team data: {snap.error}</span></div>}

        <div className="chips" role="group" aria-label="Show on map">
          {FILTERS.map((f) => (
            <button key={f.key} className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="map-tools">
          <button className="tool stack" aria-pressed={drawing} onClick={() => { setDrawing(!drawing); setOpenId(null); setTab('map') }} aria-label="Draw around leads">
            <Icon name="lasso" />
            <span className="tool-label">{drawing ? 'Cancel' : 'Draw'}</span>
          </button>
          <button className="tool" onClick={() => (here ? mapRef.current?.flyTo(here, 16) : flash('Turn on Location for KnockRoute in your phone settings'))} aria-label="Center on my location">
            <Icon name="locate" />
          </button>
          <button className="tool" aria-pressed={satellite} onClick={() => setSatellite(!satellite)} aria-label="Satellite view">
            <Icon name="layers" />
          </button>
        </div>

        {drawing && <div className="draw-hint">Drag a loop around the houses</div>}
        {placingId && (
          <div className="banner">
            <div className="banner-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>Tap the house</b> for {(() => { const l = snap.leads.find((x) => x.id === placingId); return l ? `${l.firstName} ${l.lastName}, ${l.address}` : 'this lead' })()}. Zoom in first for accuracy.
              </div>
              <button className="btn small" onClick={() => { const id = placingId; setPlacingId(null); setOpenId(id) }}>Cancel</button>
            </div>
          </div>
        )}

        {!drawing && selection.size > 0 && !openLead && (
          <div className="banner">
            <div className="banner-row">
              <h3 className="num" style={{ flex: 1 }}>
                {selection.size} selected · {selectedOpen} open
              </h3>
              <button className="close" onClick={() => setSelection(new Set())} aria-label="Clear selection">
                <Icon name="close" />
              </button>
            </div>
            <div className="row">
              <button className="btn route" disabled={!selectedOpen} onClick={() => planRoute(selected)}>
                <Icon name="route" /> Plan route ({selectedOpen})
              </button>
            </div>
            {isManager && (
              <div className="row">
                <select id="bulk-assign" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} style={{ flex: '1 1 160px' }}>
                  <option value="">Shared pool (everyone)</option>
                  {snap.members.map((m) => (
                    <option key={m.id} value={m.id}>Only {m.name}</option>
                  ))}
                </select>
                <button
                  className="btn"
                  onClick={async () => {
                    await store.assign([...selection], assignTo || null)
                    flash(assignTo ? `${selection.size} leads assigned to ${snap.members.find((m) => m.id === assignTo)?.name}` : `${selection.size} leads back in the shared pool`)
                    setSelection(new Set())
                  }}
                >
                  Assign
                </button>
              </div>
            )}
          </div>
        )}

        {!drawing && !placingId && selection.size === 0 && !openLead && tab === 'map' && (
          <div className="legend" aria-label="Pin colors">
            {STATUS_ORDER.map((s) => (
              <span key={s}><span className="dot" style={{ background: STATUS[s].color }} />{STATUS[s].label}</span>
            ))}
          </div>
        )}

        {openLead && (
          <LeadSheet
            store={store}
            snap={snap}
            lead={openLead}
            onRoute={!!route?.ids.includes(openLead.id)}
            navApp={navApp}
            onClose={() => setOpenId(null)}
            onToggleRoute={() => toggleOnRoute(openLead)}
            onSaved={onSaved}
            onPlacePin={() => {
              setPlacingId(openLead.id)
              setOpenId(null)
              setSatellite(true)
              if (openLead.lat != null) mapRef.current?.flyTo(openLead as Point, 18)
              else if (here) mapRef.current?.flyTo(here, 16)
            }}
          />
        )}

        {!openLead && tab === 'route' && (
          <RoutePanel
            stops={routeLeads}
            done={doneStops}
            me={here}
            navApp={navApp}
            openCount={visible.filter(routable).length}
            onClose={() => setTab('map')}
            onOpenLead={(l) => { setOpenId(l.id); if (l.lat != null) mapRef.current?.flyTo(l as Point) }}
            onRemove={(id) => { const l = byId.get(id); if (l) toggleOnRoute(l) }}
            onReoptimize={reoptimize}
            onEnd={endRoute}
            onNearest={nearest}
            onDraw={() => { setTab('map'); setDrawing(true) }}
          />
        )}
        {!openLead && tab === 'leads' && <LeadsPanel snap={snap} leads={visible} me={here} onClose={() => setTab('map')} onOpenLead={openFromList} />}
        {!openLead && tab === 'team' && !importing && (
          <TeamPanel store={store} snap={snap} onClose={() => setTab('map')} onOpenLead={openFromList} onImport={() => setImporting(true)} />
        )}
        {importing && (
          <ImportWizard
            store={store}
            snap={snap}
            onClose={() => setImporting(false)}
            onDone={(msg) => { setImporting(false); setTab('map'); setFilter('all'); flash(msg); mapRef.current?.fit(visible.filter((l) => l.lat != null) as Point[]) }}
          />
        )}
        {!openLead && tab === 'more' && (
          <MorePanel store={store} snap={snap} navApp={navApp} satellite={satellite} onNavApp={setNavApp} onSatellite={setSatellite} onClose={() => setTab('map')} />
        )}
      </div>

      <nav className="tabbar" style={{ ['--tabs' as string]: tabs.length }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className="tab"
            aria-current={tab === t.key && !openLead ? 'page' : undefined}
            onClick={() => { setOpenId(null); setDrawing(false); setImporting(false); setTab(tab === t.key && t.key !== 'map' ? 'map' : t.key) }}
          >
            <Icon name={t.icon} />
            {t.label}
            {t.badge ? <span className="badge num">{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
