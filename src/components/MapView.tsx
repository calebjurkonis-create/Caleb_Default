import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { statusColor } from '../lib/dispositions'
import type { Point } from '../lib/route'
import type { Lead } from '../types'

export interface MapHandle {
  flyTo(p: Point, zoom?: number): void
  fit(points: Point[]): void
  center(): Point
}

interface Props {
  leads: Lead[]
  selected: Set<string>
  /** Lead ids claimed by teammates (drawn faded). */
  claimedByOthers: Set<string>
  route: Lead[]
  doneStops: Set<string>
  me: Point | null
  focusId: string | null
  drawing: boolean
  satellite: boolean
  themeKey: string
  onTap(lead: Lead): void
  onLasso(poly: Point[]): void
  onReady(h: MapHandle): void
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
  const meLayer = useRef<L.Marker | null>(null)
  const onTap = useRef(props.onTap)
  onTap.current = props.onTap
  // Bumps after every pan/zoom so only pins in view get drawn (keeps 10,000+ leads smooth).
  const [view, setView] = useState(0)
  const markers = useRef(new Map<string, L.CircleMarker>())
  const leadById = useRef(new Map<string, Lead>())
  const renderer = useRef<L.Canvas | null>(null)

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: false, preferCanvas: true, attributionControl: true }).setView([28.42, -81.5], 10)
    pins.current = L.layerGroup().addTo(m)
    routeLayer.current = L.layerGroup().addTo(m)
    m.on('moveend', () => setView((v) => v + 1))
    map.current = m
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
    renderer.current ??= L.canvas({ padding: 0.5, tolerance: 6 })
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
      const style = {
        color: focus || sel ? '#10202e' : '#ffffff',
        weight: focus ? 4 : sel ? 3 : far ? 1 : 2,
        fillColor: c,
        fillOpacity: faded ? 0.35 : 1,
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
        const mk = L.circleMarker([lead.lat, lead.lng], { renderer: renderer.current, radius, ...style })
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

  // Route line + numbered stops.
  useEffect(() => {
    const group = routeLayer.current
    if (!group) return
    group.clearLayers()
    const stops = props.route.filter((l) => l.lat != null && l.lng != null)
    if (!stops.length) return
    const line: L.LatLngExpression[] = [
      ...(props.me ? [[props.me.lat, props.me.lng] as L.LatLngTuple] : []),
      ...stops.map((s) => [s.lat!, s.lng!] as L.LatLngTuple),
    ]
    const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#f2b632'
    L.polyline(line, { color: '#10202e', weight: 7, opacity: 0.35, interactive: false }).addTo(group)
    L.polyline(line, { color: routeColor, weight: 4, dashArray: '8 8', interactive: false }).addTo(group)
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
  }, [props.route, props.doneStops, props.me, props.themeKey])

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
      <div ref={el} className="map" />
      {props.drawing && map.current && <Lasso map={map.current} onDone={props.onLasso} />}
    </>
  )
}

/** Freehand lasso: drag a loop around the houses you want. */
function Lasso({ map, onDone }: { map: L.Map; onDone(poly: Point[]): void }) {
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
            fill="rgba(242,182,50,0.18)"
            stroke="#f2b632"
            strokeWidth={3}
            strokeDasharray="6 5"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  )
}
