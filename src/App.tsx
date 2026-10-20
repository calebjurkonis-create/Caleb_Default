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
import { AgendaPanel } from './components/AgendaPanel'
import { PeekCard } from './components/PeekCard'
import { dueNowCount } from './lib/agenda'
import { findGated, zoneAt, zoneLabel, type Suggestion } from './lib/gated'
import { useSnapshot, visibleLeads, type Store } from './data/store'
import { STATUS, STATUS_ORDER } from './lib/dispositions'
import { activeClaim } from './lib/leads'
import { effectiveRoadKey, orderByRoads, roadPath, type RoadPath } from './lib/roads'
import { insidePolygon, milesBetween, optimizeOrder, type NavApp, type Point } from './lib/route'
import type { Activity, Lead, LeadStatus, Outcome } from './types'

type Tab = 'map' | 'route' | 'leads' | 'agenda' | 'team' | 'more'
type MapFilter = 'all' | 'open' | 'new' | 'callbacks' | 'appointments'

/** One-tap presets. Each one sets which dispositions show; the color key below fine-tunes them. */
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
  /** Where the route was planned from, so the road path can start there. */
  start?: Point
  /** Road-following path for these exact stops (sig = ids it was drawn for). */
  path?: RoadPath & { sig: string }
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
  // Tapping a pin shows a quick look first; the full lead opens from there.
  const [peekId, setPeekId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [drawing, setDrawing] = useState(false)
  // Managers marking a gated area: drawing it, naming it, or reviewing OpenStreetMap suggestions.
  const [zoneDraw, setZoneDraw] = useState(false)
  const [pendingZone, setPendingZone] = useState<[number, number][] | null>(null)
  const [zoneName, setZoneName] = useState('')
  const [review, setReview] = useState<{ list: Suggestion[]; i: number; name: string } | null>(null)
  const [findingGated, setFindingGated] = useState(false)
  const [zoneBusy, setZoneBusy] = useState(false)
  // Dispositions hidden on the map, remembered on this phone. Empty = show everything.
  const [hiddenList, setHiddenList] = usePref<LeadStatus[]>('knockroute-hidden', [])
  const hidden = useMemo(() => new Set(hiddenList), [hiddenList])
  const applyPreset = (f: (typeof FILTERS)[number]) => setHiddenList(STATUS_ORDER.filter((s) => !f.match(s)))
  const presetOn = (f: (typeof FILTERS)[number]) => STATUS_ORDER.every((s) => f.match(s) === !hidden.has(s))
  const toggleStatus = (s: LeadStatus) => setHiddenList(hidden.has(s) ? hiddenList.filter((x) => x !== s) : [...hiddenList, s])
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [here, setHere] = useState<Point | null>(null)
  const [route, setRoute] = usePref<SavedRoute | null>(`knockroute-route-${me.id}`, null)
  const [navApp, setNavApp] = usePref<NavApp>('knockroute-nav', 'apple')
  const [satellite, setSatellite] = usePref('knockroute-sat', false)
  const [themeKey, setThemeKey] = useState('')
  const [assignTo, setAssignTo] = useState('')
  const [placingId, setPlacingId] = useState<string | null>(null)
  // Road-routing key managers set under More; empty = straight lines, exactly as before.
  const [roadSetting, setRoadSetting] = useState('')
  const roadKey = effectiveRoadKey(roadSetting)
  const [routing, setRouting] = useState(false)
  useEffect(() => {
    store.getSetting('ors_key').then(setRoadSetting).catch(() => {})
  }, [store])
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
  const mapLeads = useMemo(() => visible.filter((l) => !hidden.has(l.status)), [visible, hidden])
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
  const peekLead = !openLead && peekId ? byId.get(peekId) ?? null : null
  const overlay = !!(openLead || peekLead)

  // Open appointments and follow-ups. Agents only get their own; managers get everyone's.
  const [items, setItems] = useState<Activity[] | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const latestActivity = snap.activities[0]?.id
  useEffect(() => {
    let live = true
    store
      .openItems()
      .then((all) => {
        if (!live) return
        setItems(isManager ? all : all.filter((i) => i.memberId === me.id))
        setItemsError(null)
      })
      .catch((e) => live && setItemsError((e as Error).message))
    return () => {
      live = false
    }
  }, [store, snap.agendaReady, snap.itemsVersion, latestActivity, isManager, me.id])
  const myDue = useMemo(() => dueNowCount((items ?? []).filter((i) => i.memberId === me.id)), [items, me.id])

  // No leads yet (a fresh demo or a brand-new office): start the map where the person is.
  const centeredOnMe = useRef(false)
  useEffect(() => {
    if (centeredOnMe.current || !here || visible.length || !mapRef.current) return
    centeredOnMe.current = true
    mapRef.current.flyTo(here, 12)
  }, [here, visible.length])

  // Frame all leads the first time the map has data.
  useEffect(() => {
    if (didFit.current || !mapRef.current) return
    const pts = (routeLeads.length ? routeLeads : visible).filter((l) => l.lat != null) as Point[]
    if (pts.length) {
      mapRef.current.fit(pts)
      didFit.current = true
    }
  }, [visible, routeLeads])

  // Releasing doors must not fail silently: anything that doesn't go through is kept on this
  // phone and retried when the signal comes back, when the app reopens, and every minute.
  const [pendingRelease, setPendingRelease] = usePref<string[]>(`knockroute-pending-release-${me.id}`, [])
  const pendingRef = useRef(pendingRelease)
  pendingRef.current = pendingRelease
  async function releaseDoors(ids: string[], quiet = false): Promise<boolean> {
    const all = [...new Set([...pendingRef.current, ...ids])]
    if (!all.length) return true
    try {
      await store.claim(all, false)
      setPendingRelease([])
      return true
    } catch {
      setPendingRelease(all)
      if (!quiet) flash(`Couldn't release ${all.length} door${all.length === 1 ? '' : 's'}: no signal. KnockRoute will keep trying.`)
      return false
    }
  }
  async function claimDoors(ids: string[]) {
    // A door taken back onto a route must not be released later by a queued retry.
    if (pendingRef.current.some((id) => ids.includes(id))) setPendingRelease(pendingRef.current.filter((id) => !ids.includes(id)))
    try {
      await store.claim(ids, true)
    } catch {
      flash("Couldn't mark these doors as yours: check your signal. Teammates may not see your route yet.")
    }
  }
  useEffect(() => {
    const retry = () => {
      if (pendingRef.current.length && navigator.onLine !== false) releaseDoors([], true)
    }
    retry()
    const onVisible = () => document.visibilityState === 'visible' && retry()
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(retry, 60_000)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const routable = (l: Lead) => l.lat != null && l.lng != null && !STATUS[l.status].closed && !claimedByOthers.has(l.id)

  async function planRoute(leads: Lead[]) {
    const stops = leads.filter(routable)
    if (!stops.length) {
      flash('No open leads to route there')
      return
    }
    const start = here ?? mapRef.current?.center() ?? (stops[0] as Point)
    let ordered = optimizeOrder(start, stops as (Lead & Point)[])
    if (roadKey) {
      // Order by real drive time when the routing service answers; otherwise keep the straight-line order.
      setRouting(true)
      const ids = await orderByRoads(roadKey, start, ordered)
      setRouting(false)
      if (ids) {
        const byLead = new Map(ordered.map((l) => [l.id, l]))
        ordered = ids.map((id) => byLead.get(id)!)
      }
    }
    if (route) await releaseDoors(route.ids.filter((id) => !ordered.some((o) => o.id === id)))
    setRoute({ ids: ordered.map((l) => l.id), startedAt: new Date().toISOString(), start: { lat: start.lat, lng: start.lng } })
    await claimDoors(ordered.map((l) => l.id))
    setSelection(new Set())
    mapRef.current?.fit(ordered as Point[])
    setTab('route')
    flash(`Route planned: ${ordered.length} stops`)
  }

  function nearest(n: number) {
    const start = here ?? mapRef.current?.center()
    if (!start) return
    // Only what's showing on the map, so hidden dispositions don't end up on the route.
    const pool = mapLeads.filter((l) => routable(l) && !route?.ids.includes(l.id))
    pool.sort((a, b) => milesBetween(start, a as Point) - milesBetween(start, b as Point))
    planRoute(pool.slice(0, n))
  }

  async function toggleOnRoute(l: Lead) {
    if (route?.ids.includes(l.id)) {
      setRoute({ ...route, ids: route.ids.filter((id) => id !== l.id) })
      if (await releaseDoors([l.id])) flash('Removed from route')
    } else {
      const ids = [...(route?.ids ?? []), l.id]
      const leads = ids.map((id) => byId.get(id)).filter((x): x is Lead => !!x && x.lat != null)
      const start = here ?? (leads[0] as Point)
      const ordered = optimizeOrder(start, leads as (Lead & Point)[])
      setRoute({ ids: ordered.map((x) => x.id), startedAt: route?.startedAt ?? new Date().toISOString() })
      await claimDoors([l.id])
      flash(`Added as stop ${ordered.findIndex((x) => x.id === l.id) + 1}`)
    }
  }

  async function reoptimize() {
    if (!route) return
    const remaining = routeLeads.filter((l) => !doneStops.has(l.id))
    const done = routeLeads.filter((l) => doneStops.has(l.id))
    const start = here ?? (remaining[0] as Point)
    if (!start) return
    let ordered = optimizeOrder(start, remaining as (Lead & Point)[])
    if (roadKey) {
      setRouting(true)
      const ids = await orderByRoads(roadKey, start, ordered)
      setRouting(false)
      if (ids) {
        const byLead = new Map(ordered.map((l) => [l.id, l]))
        ordered = ids.map((id) => byLead.get(id)!)
      }
    }
    setRoute({ ...route, ids: [...done, ...ordered].map((l) => l.id), start: { lat: start.lat, lng: start.lng } })
    flash('Re-ordered from your location')
  }

  // Draw the route along real roads whenever its stops change (only with a routing key).
  const pathSig = route && roadKey ? `${route.start?.lat},${route.start?.lng}|${route.ids.join(',')}` : ''
  // If routing is briefly unavailable (no signal, busy service), try again a few times.
  const [pathTry, setPathTry] = useState(0)
  useEffect(() => setPathTry(0), [pathSig])
  useEffect(() => {
    if (!pathSig || !route || route.path?.sig === pathSig) return
    const pts = routeLeads.filter((l) => l.lat != null && l.lng != null) as Point[]
    const points = route.start ? [route.start, ...pts] : pts
    let live = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const t = setTimeout(() => {
      roadPath(roadKey, points).then((p) => {
        if (!live) return
        if (!p) {
          if (pathTry < 3) retry = setTimeout(() => setPathTry((n) => n + 1), 20_000)
          return
        }
        setRoute({ ...route, path: { ...p, sig: pathSig } })
      })
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
      clearTimeout(retry)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathSig, routeLeads.length, pathTry])
  const roadLine = route?.path && route.path.sig === pathSig ? route.path : null

  async function endRoute() {
    if (!route) return
    const unvisited = routeLeads.filter((l) => !doneStops.has(l.id)).map((l) => l.id)
    setRoute(null)
    if (await releaseDoors(unvisited)) flash('Route ended. Unvisited doors are free for the team.')
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
    if (zoneDraw) {
      setZoneDraw(false)
      setPendingZone(poly.map((p) => [+p.lat.toFixed(6), +p.lng.toFixed(6)]))
      setZoneName('')
      return
    }
    const hit = mapLeads.filter((l) => l.lat != null && insidePolygon(l as Point, poly))
    setSelection(new Set(hit.map((l) => l.id)))
    if (!hit.length) flash('No pins inside that shape')
  }

  const gatedAt = (l: Lead) => (l.lat != null && l.lng != null ? zoneAt({ lat: l.lat, lng: l.lng }, snap.zones) : null)

  function startZoneDraw() {
    setOpenId(null)
    setPeekId(null)
    setSelection(new Set())
    setTab('map')
    setZoneDraw(true)
    setDrawing(true)
  }

  async function saveZone() {
    if (!pendingZone) return
    setZoneBusy(true)
    try {
      await store.addZone({ name: zoneName.trim(), points: pendingZone })
      setPendingZone(null)
      flash('Gated area saved. Everyone sees it now.')
    } catch (e) {
      flash(`Couldn't save it: ${(e as Error).message}`)
    } finally {
      setZoneBusy(false)
    }
  }

  function showSuggestion(list: Suggestion[], i: number) {
    const s = list[i]
    setReview({ list, i, name: s.name })
    mapRef.current?.fit(s.points.map(([lat, lng]) => ({ lat, lng })))
  }

  async function findGatedHere() {
    const b = mapRef.current?.bounds()
    if (!b) return
    setTab('map')
    if (b[2] - b[0] > 0.3 || b[3] - b[1] > 0.3) {
      flash('Zoom in to a few neighborhoods first, then try again.')
      return
    }
    setFindingGated(true)
    const res = await findGated(b, snap.zones)
    setFindingGated(false)
    if (!res.ok) flash(res.error)
    else if (!res.suggestions.length) flash('OpenStreetMap has no new gated areas here. You can still draw one.')
    else showSuggestion(res.suggestions, 0)
  }

  async function answerSuggestion(gated: boolean | null) {
    if (!review) return
    const s = review.list[review.i]
    if (gated !== null) {
      setZoneBusy(true)
      try {
        await store.addZone({ name: gated ? review.name.trim() : s.name, points: s.points, source: 'osm', osmId: s.osmId, status: gated ? 'active' : 'dismissed' })
      } catch (e) {
        flash(`Couldn't save it: ${(e as Error).message}`)
        setZoneBusy(false)
        return
      }
      setZoneBusy(false)
    }
    if (review.i + 1 < review.list.length) showSuggestion(review.list, review.i + 1)
    else {
      setReview(null)
      flash('All suggestions reviewed.')
    }
  }

  function openFromList(l: Lead) {
    setPeekId(null)
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
    { key: 'agenda', label: 'Agenda', icon: 'calendar', badge: myDue || undefined },
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
        <button className="avatar" onClick={() => { setOpenId(null); setPeekId(null); setTab('more') }} aria-label="Settings">
          {me.name.slice(0, 2).toUpperCase()}
        </button>
      </header>

      <div className="stage">
        <MapView
          leads={mapLeads}
          selected={selection}
          claimedByOthers={claimedByOthers}
          route={routeLeads}
          roadLine={roadLine?.line}
          doneStops={doneStops}
          me={here}
          focusId={openId ?? peekId}
          drawing={drawing}
          satellite={satellite}
          themeKey={themeKey}
          onTap={(l) => { if (!placingId) { setOpenId(null); setPeekId(l.id) } }}
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
          zones={snap.zones}
          drawColor={zoneDraw ? getComputedStyle(document.documentElement).getPropertyValue('--gated').trim() || '#c62828' : undefined}
          suggestions={review ? [review.list[review.i]] : pendingZone ? [{ osmId: 'new', name: '', points: pendingZone, reason: '' }] : undefined}
          activeSuggestion={review ? review.list[review.i].osmId : pendingZone ? 'new' : null}
        />

        {snap.error && <div className="banner" style={{ top: 60, bottom: 'auto' }}><span className="err">Can't reach team data: {snap.error}</span></div>}

        <div className="chips" role="group" aria-label="Show on map">
          {FILTERS.map((f) => (
            <button key={f.key} className="chip" aria-pressed={presetOn(f)} onClick={() => applyPreset(f)}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="map-tools">
          <button className="tool stack" aria-pressed={drawing} onClick={() => { setDrawing(!drawing); setZoneDraw(false); setOpenId(null); setPeekId(null); setTab('map') }} aria-label="Draw around leads">
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

        {drawing && <div className="draw-hint">{zoneDraw ? 'Drag a loop around the gated neighborhood' : 'Drag a loop around the houses'}</div>}
        {findingGated && <div className="draw-hint">Checking OpenStreetMap for gated areas…</div>}
        {pendingZone && (
          <div className="banner">
            <h3>Mark this as a gated area?</h3>
            <input id="zone-name" type="text" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="Name (optional), e.g. Heron Bay" />
            <div className="row">
              <button className="btn primary" disabled={zoneBusy} onClick={saveZone}>{zoneBusy ? 'Saving…' : 'Save gated area'}</button>
              <button className="btn" disabled={zoneBusy} onClick={startZoneDraw}>Redraw</button>
              <button className="btn" disabled={zoneBusy} onClick={() => setPendingZone(null)}>Cancel</button>
            </div>
          </div>
        )}
        {review && (
          <div className="banner">
            <div className="banner-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="eyebrow">Possible gated area · {review.i + 1} of {review.list.length}</span>
                <div className="muted" style={{ fontSize: 14 }}>{review.list[review.i].reason}. Check the satellite view if unsure.</div>
              </div>
              <button className="close" onClick={() => setReview(null)} aria-label="Stop reviewing"><Icon name="close" /></button>
            </div>
            <input id="suggestion-name" type="text" value={review.name} onChange={(e) => setReview({ ...review, name: e.target.value })} placeholder="Name (optional)" />
            <div className="row">
              <button className="btn primary" disabled={zoneBusy} onClick={() => answerSuggestion(true)}><Icon name="check" /> Gated</button>
              <button className="btn" disabled={zoneBusy} onClick={() => answerSuggestion(false)}>Not gated</button>
              <button className="btn" disabled={zoneBusy} onClick={() => answerSuggestion(null)}>Skip</button>
            </div>
          </div>
        )}
        {snap.ready && visible.length === 0 && tab === 'map' && !overlay && !importing && (
          <div className="banner">
            <h3>No leads on the map yet</h3>
            <div className="muted">
              {isManager ? 'Add a list: Team → Import a spreadsheet (.xlsx or .csv).' : 'Your manager will add a lead list. Check back soon.'}
            </div>
            {isManager && (
              <div className="row">
                <button className="btn route" onClick={() => { setTab('team'); setImporting(true) }}>
                  <Icon name="upload" /> Import a spreadsheet
                </button>
              </div>
            )}
          </div>
        )}
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

        {!drawing && !pendingZone && !review && selection.size > 0 && !overlay && (
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

        {!drawing && !placingId && !pendingZone && !review && selection.size === 0 && !overlay && tab === 'map' && visible.length > 0 && (
          <div className="legend" role="group" aria-label="Show or hide pins by disposition">
            <span className="legend-hint">Tap to show/hide</span>
            {STATUS_ORDER.map((s) => (
              <button key={s} className="legend-item" aria-pressed={!hidden.has(s)} onClick={() => toggleStatus(s)}>
                <span className="dot" style={{ background: STATUS[s].color }} />
                {STATUS[s].label}
              </button>
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

        {peekLead && (
          <PeekCard
            store={store}
            snap={snap}
            lead={peekLead}
            onRoute={!!route?.ids.includes(peekLead.id)}
            navApp={navApp}
            onClose={() => setPeekId(null)}
            onOpen={() => { setOpenId(peekLead.id); setPeekId(null) }}
            onToggleRoute={() => toggleOnRoute(peekLead)}
          />
        )}

        {!overlay && tab === 'route' && (
          <RoutePanel
            road={roadLine ? { miles: roadLine.miles, minutes: roadLine.minutes, partial: roadLine.partial } : null}
            planning={routing}
            stops={routeLeads}
            done={doneStops}
            me={here}
            navApp={navApp}
            openCount={visible.filter(routable).length}
            onClose={() => setTab('map')}
            onOpenLead={(l) => { setPeekId(null); setOpenId(l.id); if (l.lat != null) mapRef.current?.flyTo(l as Point) }}
            onRemove={(id) => { const l = byId.get(id); if (l) toggleOnRoute(l) }}
            onReoptimize={reoptimize}
            onEnd={endRoute}
            onNearest={nearest}
            onDraw={() => { setTab('map'); setZoneDraw(false); setDrawing(true) }}
            gatedAt={(l) => { const z = gatedAt(l); return z ? zoneLabel(z) : null }}
          />
        )}
        {!overlay && tab === 'leads' && <LeadsPanel snap={snap} leads={visible} me={here} onClose={() => setTab('map')} onOpenLead={openFromList} />}
        {!overlay && tab === 'agenda' && (
          <AgendaPanel
            store={store}
            snap={snap}
            items={items}
            error={itemsError}
            onClose={() => setTab('map')}
            onOpenLead={openFromList}
            onUpdated={flash}
          />
        )}
        {!overlay && tab === 'team' && !importing && (
          <TeamPanel
            store={store}
            snap={snap}
            onClose={() => setTab('map')}
            onImport={() => setImporting(true)}
            onDrawZone={startZoneDraw}
            onFindGated={findGatedHere}
            onShowZone={(z) => { setTab('map'); mapRef.current?.fit(z.points.map(([lat, lng]) => ({ lat, lng }))) }}
          />
        )}
        {importing && (
          <ImportWizard
            store={store}
            snap={snap}
            onClose={() => setImporting(false)}
            onDone={(msg) => { setImporting(false); setTab('map'); setHiddenList([]); flash(msg); mapRef.current?.fit(visible.filter((l) => l.lat != null) as Point[]) }}
          />
        )}
        {!overlay && tab === 'more' && (
          <MorePanel store={store} snap={snap} navApp={navApp} satellite={satellite} onNavApp={setNavApp} onSatellite={setSatellite} onClose={() => setTab('map')} roadKey={roadKey} onRoadKey={setRoadSetting} />
        )}
      </div>

      <nav className="tabbar" style={{ ['--tabs' as string]: tabs.length }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className="tab"
            aria-current={tab === t.key && !overlay ? 'page' : undefined}
            onClick={() => { setOpenId(null); setPeekId(null); setDrawing(false); setZoneDraw(false); setImporting(false); setTab(tab === t.key && t.key !== 'map' ? 'map' : t.key) }}
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
