import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { statusColor } from '../lib/dispositions'
import type { Suggestion } from '../lib/gated'
import type { Point } from '../lib/route'
import type { GatedZone, Lead } from '../types'

export interface MapHandle {
  flyTo(p: Point, zoom?: number): void
  fit(points: Point[]): void
  center(): Point
  /** [south, west, north, east] of what's on screen. */
  bounds(): [number, number, number, number]
}

interface Props {
  leads: Lead[]
  selected: Set<string>
  /** Lead ids claimed by teammates (drawn faded). */
  claimedByOthers: Set<string>
  route: Lead[]
  /** Road-following path for the route ([lat, lng] pairs); straight lines between stops when absent. */
  roadLine?: [number, number][]
  doneStops: Set<string>
  /** Where the route finishes (home, office…), if it has an end point. */
  routeEnd?: Point | null
  me: Point | null
  focusId: string | null
  drawing: boolean
  satellite: boolean
  themeKey: string
  onTap(lead: Lead): void
  onLasso(poly: Point[]): void
  /** When set, a tap anywhere on the map reports where (used to place a lead's pin). */
  onMapTap?: (p: Point) => void
  onReady(h: MapHandle): void
  /** Gated areas everyone sees (outlined, under the pins). */
  zones: GatedZone[]
  /** OpenStreetMap suggestions a manager is reviewing; the active one is highlighted. */
  suggestions?: Suggestion[]
  activeSuggestion?: string | null
  /** Lasso color (red while drawing a gated area). */
  drawColor?: string
}

const TILES = {
  streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
}

export function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)
  const pins = useRef<L.LayerGroup | null>(null)
  const routeLayer = useRef<L.LayerGroup | null>(null)
  const zoneLayer = useRef<L.LayerGroup | null>(null)
  const zoneRenderer = useRef<L.SVG | null>(null)
  const routeRenderer = useRef<L.SVG | null>(null)
  const meLayer = useRef<L.Marker | null>(null)
  const onTap = useRef(props.onTap)
  onTap.current = props.onTap
  const onMapTap = useRef(props.onMapTap)
  onMapTap.current = props.onMapTap
  // Bumps after every pan/zoom so only pins in view get drawn (keeps 10,000+ leads smooth).
  const [view, setView] = useState(0)
  const markers = useRef(new Map<string, L.CircleMarker>())
  const leadById = useRef(new Map<string, Lead>())
  const renderer = useRef<L.Canvas | null>(null)

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: false, preferCanvas: true, attributionControl: true }).setView([28.42, -81.5], 10)
    // Fixed layers, bottom to top: gated areas, the route line, then the lead pins. Each draws
    // on its own surface; if the route line shared the pins' layer, its surface could end up on
    // top and swallow taps meant for the pins.
    const zonePane = m.createPane('zones')
    zonePane.style.zIndex = '350'
    zonePane.style.pointerEvents = 'none'
    zoneRenderer.current = L.svg({ pane: 'zones' })
    const routePane = m.createPane('routeLine')
    routePane.style.zIndex = '380'
    routePane.style.pointerEvents = 'none'
    routeRenderer.current = L.svg({ pane: 'routeLine' })
    m.createPane('pins').style.zIndex = '420'
    zoneLayer.current = L.layerGroup().addTo(m)
    pins.current = L.layerGroup().addTo(m)
    routeLayer.current = L.layerGroup().addTo(m)
    m.on('moveend', () => setView((v) => v + 1))
    m.on('click', (e: L.LeafletMouseEvent) => onMapTap.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    map.current = m
    // Lets automated tests find pins on the map (development builds only).
    if (import.meta.env.DEV) (window as unknown as { __kmap?: L.Map }).__kmap = m
    props.onReady({
      flyTo: (p, zoom) => m.flyTo([p.lat, p.lng], zoom ?? Math.max(m.getZoom(), 16), { duration: 0.6 }),
      fit: (pts) => {
        if (!pts.length) return
        m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [48, 48], maxZoom: 16 })
      },
      center: () => {
        const c = m.getCenter()
        return { lat: c.lat, lng: c.lng }
      },
      bounds: () => {
        const b = m.getBounds()
        return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
      },
    })
    return () => {
      m.remove()
      map.current = null
      // Pins and their canvas belong to this map instance; start fresh with the next one.
      markers.current.clear()
      renderer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Base layer.
  useEffect(() => {
    const m = map.current
    if (!m) return
    tiles.current?.remove()
    const t = props.satellite ? TILES.satellite : TILES.streets
    tiles.current = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: t.maxZoom }).addTo(m)
    tiles.current.bringToBack()
  }, [props.satellite])

  // Lead pins: only what's on screen (plus a margin), smaller when zoomed far out.
  // Markers are kept and updated in place on one canvas, so big lists stay fast.
  useEffect(() => {
    const group = pins.current
    const m = map.current
    if (!group || !m) return
    renderer.current ??= L.canvas({ padding: 0.5, tolerance: 6, pane: 'pins' })
    const bounds = m.getBounds().pad(0.3)
    const far = m.getZoom() <= 10
    const colors = new Map<string, string>()
    const keep = new Set<string>()
    leadById.current = new Map(props.leads.map((l) => [l.id, l]))
    for (const lead of props.leads) {
      if (lead.lat == null || lead.lng == null) continue
      if (lead.id !== props.focusId && !bounds.contains([lead.lat, lead.lng])) continue
      keep.add(lead.id)
      let c = colors.get(lead.status)
      if (!c) colors.set(lead.status, (c = statusColor(lead.status)))
      const sel = props.selected.has(lead.id)
      const focus = props.focusId === lead.id
      const faded = props.claimedByOthers.has(lead.id)
      // Street-level pins: hollow with a dashed ring in the status color.
      const ring = lead.pinApprox && !focus && !sel
      const style = {
        color: ring ? c : focus || sel ? '#10202e' : '#ffffff',
        weight: ring ? (far ? 1.5 : 2.5) : focus ? 4 : sel ? 3 : far ? 1 : 2,
        dashArray: ring ? (far ? '2 2' : '3 3') : undefined,
        fillColor: c,
        fillOpacity: ring ? 0.25 : faded ? 0.35 : 1,
        opacity: faded ? 0.6 : 1,
      }
      const radius = focus ? 11 : sel ? 9 : far ? 4 : 7
      const existing = markers.current.get(lead.id)
      if (existing) {
        existing.setStyle(style)
        existing.setRadius(radius)
        if (focus) existing.bringToFront()
      } else {
        const id = lead.id
        const mk = L.circleMarker([lead.lat, lead.lng], { renderer: renderer.current, pane: 'pins', radius, ...style })
          .on('click', () => {
            const l = leadById.current.get(id)
            if (l) onTap.current(l)
          })
          .addTo(group)
        markers.current.set(id, mk)
      }
    }
    for (const [id, mk] of markers.current) {
      if (!keep.has(id)) {
        group.removeLayer(mk)
        markers.current.delete(id)
      }
    }
  }, [props.leads, props.selected, props.focusId, props.claimedByOthers, props.themeKey, view])

  // Gated areas, plus any suggestions being reviewed. Names show once zoomed in.
  useEffect(() => {
    const group = zoneLayer.current
    const m = map.current
    if (!group || !m || !zoneRenderer.current) return
    group.clearLayers()
    const css = getComputedStyle(document.documentElement)
    // Red, so gated areas never get mixed up with the yellow route line.
    const ink = css.getPropertyValue('--gated').trim() || '#c62828'
    const named = m.getZoom() >= 14
    for (const z of props.zones) {
      if (z.status !== 'active' || z.points.length < 3) continue
      L.polygon(z.points, {
        renderer: zoneRenderer.current, pane: 'zones', interactive: false,
        color: ink, weight: 2, dashArray: '7 5', fillColor: ink, fillOpacity: 0.1,
      }).addTo(group)
      if (named) {
        // Along the top edge, so it doesn't sit on the houses in the middle.
        const bb = L.polygon(z.points).getBounds()
        L.marker([bb.getNorth(), bb.getCenter().lng], {
          pane: 'zones', interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'zone-label', html: `<span>Gated${z.name ? ' · ' + escapeHtml(z.name) : ''}</span>`, iconSize: [0, 0] }),
        }).addTo(group)
      }
    }
    for (const s of props.suggestions ?? []) {
      const on = s.osmId === props.activeSuggestion
      L.polygon(s.points, {
        renderer: zoneRenderer.current, pane: 'zones', interactive: false,
        color: ink, weight: on ? 4 : 2, dashArray: on ? undefined : '4 6', fillColor: ink, fillOpacity: on ? 0.22 : 0.08,
      }).addTo(group)
    }
  }, [props.zones, props.suggestions, props.activeSuggestion, props.themeKey, view])

  // Route line + numbered stops.
  useEffect(() => {
    const group = routeLayer.current
    if (!group) return
    group.clearLayers()
    const stops = props.route.filter((l) => l.lat != null && l.lng != null)
    if (!stops.length) return
    const line: L.LatLngExpression[] = props.roadLine?.length
      ? props.roadLine
      : [
          ...(props.me ? [[props.me.lat, props.me.lng] as L.LatLngTuple] : []),
          ...stops.map((s) => [s.lat!, s.lng!] as L.LatLngTuple),
          ...(props.routeEnd ? [[props.routeEnd.lat, props.routeEnd.lng] as L.LatLngTuple] : []),
        ]
    const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#f2b632'
    const lineStyle = { renderer: routeRenderer.current ?? undefined, pane: 'routeLine', interactive: false }
    L.polyline(line, { ...lineStyle, color: '#10202e', weight: 7, opacity: 0.35 }).addTo(group)
    L.polyline(line, { ...lineStyle, color: routeColor, weight: 4, dashArray: '8 8' }).addTo(group)
    stops.forEach((s, i) => {
      const done = props.doneStops.has(s.id)
      L.marker([s.lat!, s.lng!], {
        icon: L.divIcon({ className: '', html: `<div class="stop-pin${done ? ' done' : ''}">${i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        zIndexOffset: 1000 - i,
        keyboard: false,
      })
        .on('click', () => onTap.current(s))
        .addTo(group)
    })
    if (props.routeEnd) {
      L.marker([props.routeEnd.lat, props.routeEnd.lng], {
        icon: L.divIcon({ className: '', html: '<div class="end-pin"><span>END</span></div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
        zIndexOffset: 1001,
        keyboard: false,
        interactive: false,
      }).addTo(group)
    }
  }, [props.route, props.roadLine, props.doneStops, props.me, props.routeEnd, props.themeKey])

  // My location.
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!props.me) {
      meLayer.current?.remove()
      meLayer.current = null
      return
    }
    if (!meLayer.current) {
      meLayer.current = L.marker([props.me.lat, props.me.lng], {
        icon: L.divIcon({ className: '', html: '<div class="me-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
        zIndexOffset: 2000,
      }).addTo(m)
    } else meLayer.current.setLatLng([props.me.lat, props.me.lng])
  }, [props.me])

  return (
    <>
      <div ref={el} className={`map${props.onMapTap ? ' placing' : ''}`} />
      {props.drawing && map.current && <Lasso map={map.current} onDone={props.onLasso} color={props.drawColor} />}
    </>
  )
}

/** Freehand lasso: drag a loop around the houses you want. */
function Lasso({ map, onDone, color = '#f2b632' }: { map: L.Map; onDone(poly: Point[]): void; color?: string }) {
  const [pts, setPts] = useState<[number, number][]>([])
  const drawing = useRef(false)
  const ref = useRef<HTMLDivElement>(null)

  const local = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  return (
    <div
      ref={ref}
      className="draw-layer"
      onPointerDown={(e) => {
        drawing.current = true
        ;(e.target as Element).setPointerCapture(e.pointerId)
        setPts([local(e)])
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return
        const p = local(e)
        setPts((prev) => {
          const last = prev[prev.length - 1]
          return last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 4 ? prev : [...prev, p]
        })
      }}
      onPointerUp={() => {
        drawing.current = false
        if (pts.length > 4) {
          onDone(pts.map(([x, y]) => {
            const ll = map.containerPointToLatLng([x, y])
            return { lat: ll.lat, lng: ll.lng }
          }))
        }
        setPts([])
      }}
    >
      <svg>
        {pts.length > 1 && (
          <polygon
            points={pts.map((p) => p.join(',')).join(' ')}
            fill={color}
            fillOpacity={0.18}
            stroke={color}
            strokeWidth={3}
            strokeDasharray="6 5"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
