import type { GatedZone } from '../types'
import { insidePolygon, type Point } from './route'

/** One OpenStreetMap feature, as /api/gated returns it. */
export interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  tags: Record<string, string>
  geometry: [number, number][]
}

/** A possible gated community for a manager to confirm or dismiss. */
export interface Suggestion {
  osmId: string
  name: string
  points: [number, number][]
  /** Why it was suggested, in plain words. */
  reason: string
}

/** Leads inside a gated area: anything inside one of its outlines. */
export function zoneAt(p: Point, zones: GatedZone[]): GatedZone | null {
  for (const z of zones) if (z.status === 'active' && z.points.length >= 3 && insidePolygon(p, z.points.map(([lat, lng]) => ({ lat, lng })))) return z
  return null
}

export function zoneLabel(z: GatedZone): string {
  return z.name.trim() || 'Gated community'
}

// Flat x/y in meters around a reference latitude; plenty accurate across one neighborhood.
const M_PER_DEG = 111_320
const toXY = (lat: number, lng: number, cos: number) => [lng * M_PER_DEG * cos, lat * M_PER_DEG] as const

function hull(pts: (readonly [number, number])[]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p.map(([x, y]) => [x, y])
  const cross = (o: readonly number[], a: readonly number[], b: readonly number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: (readonly [number, number])[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: (readonly [number, number])[] = []
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(([x, y]) => [x, y])
}

/** Outline around a set of points, pushed out a little so houses along the edge streets are inside. */
function outline(latlngs: [number, number][], padMeters: number): [number, number][] {
  const lat0 = latlngs.reduce((s, p) => s + p[0], 0) / latlngs.length
  const cos = Math.cos((lat0 * Math.PI) / 180)
  const h = hull(latlngs.map(([lat, lng]) => toXY(lat, lng, cos)))
  const cx = h.reduce((s, p) => s + p[0], 0) / h.length
  const cy = h.reduce((s, p) => s + p[1], 0) / h.length
  return h.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1
    const k = (d + padMeters) / d
    const nx = cx + (x - cx) * k
    const ny = cy + (y - cy) * k
    return [+(ny / M_PER_DEG).toFixed(6), +(nx / (M_PER_DEG * cos)).toFixed(6)]
  })
}

function meters(a: [number, number], b: [number, number]): number {
  const cos = Math.cos((a[0] * Math.PI) / 180)
  return Math.hypot((a[1] - b[1]) * M_PER_DEG * cos, (a[0] - b[0]) * M_PER_DEG)
}

const lengthOf = (g: [number, number][]) => g.slice(1).reduce((s, p, i) => s + meters(g[i], p), 0)
const centerOf = (g: [number, number][]): Point => ({ lat: g.reduce((s, p) => s + p[0], 0) / g.length, lng: g.reduce((s, p) => s + p[1], 0) / g.length })
const asPoints = (g: [number, number][]) => g.map(([lat, lng]) => ({ lat, lng }))

/** Private streets this close together count as one neighborhood. */
const JOIN_METERS = 60
/** A run of private streets this long (or one with a gate) looks like a gated community, not a driveway. */
const MIN_ROAD_METERS = 300
const GATE_NEAR_METERS = 80

/**
 * Turns OpenStreetMap features into suggested gated areas:
 *  - areas tagged gated, or private residential areas, as drawn in OpenStreetMap;
 *  - clusters of private residential streets, outlined (with any gates noted).
 * Skips anything already confirmed or dismissed, or already inside a marked area.
 */
export function buildSuggestions(elements: OsmElement[], zones: GatedZone[]): Suggestion[] {
  const known = new Set(zones.map((z) => z.osmId).filter(Boolean))
  const gates = elements.filter((e) => e.type === 'node' && e.tags.barrier && e.geometry.length)
  const named = elements.filter((e) => e.type !== 'node' && e.tags.landuse === 'residential' && e.tags.name && e.geometry.length >= 3)
  const areaOf = (p: Point) => named.find((n) => insidePolygon(p, asPoints(n.geometry)))?.tags.name

  const out: Suggestion[] = []

  // 1. Areas OpenStreetMap already marks as gated or private.
  const areas = elements.filter(
    (e) => e.type !== 'node' && e.geometry.length >= 3 && (e.tags.gated === 'yes' || (e.tags.landuse === 'residential' && /^(private|no)$/.test(e.tags.access ?? ''))),
  )
  for (const a of areas) {
    const c = centerOf(a.geometry)
    out.push({
      osmId: `${a.type}/${a.id}`,
      name: a.tags.name || areaOf(c) || '',
      points: outline(a.geometry, 0),
      reason: a.tags.gated === 'yes' ? 'Marked as gated in OpenStreetMap' : 'Marked as a private neighborhood in OpenStreetMap',
    })
  }
  const insideArea = (p: Point) => areas.some((a) => insidePolygon(p, asPoints(a.geometry)))

  // 2. Private residential streets, grouped into neighborhoods.
  const roads = elements.filter((e) => e.type === 'way' && e.tags.highway && e.geometry.length >= 2)
  const parent = roads.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      if (find(i) === find(j)) continue
      const near = roads[i].geometry.some((p) => roads[j].geometry.some((q) => meters(p, q) < JOIN_METERS))
      if (near) parent[find(i)] = find(j)
    }
  }
  const groups = new Map<number, OsmElement[]>()
  roads.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]))

  for (const group of groups.values()) {
    const pts = group.flatMap((r) => r.geometry)
    const length = group.reduce((s, r) => s + lengthOf(r.geometry), 0)
    const nearGates = gates.filter((g) => pts.some((p) => meters(p, g.geometry[0]) < GATE_NEAR_METERS))
    if (length < MIN_ROAD_METERS && !nearGates.length) continue
    const c = centerOf(pts)
    if (insideArea(c)) continue
    const streets = [...new Set(group.map((r) => r.tags.name).filter(Boolean))]
    const id = Math.min(...group.map((r) => r.id))
    out.push({
      osmId: `roads/${id}`,
      name: areaOf(c) || (streets.length ? `Private streets: ${streets.slice(0, 2).join(' & ')}${streets.length > 2 ? '…' : ''}` : ''),
      points: outline(pts, 35),
      reason:
        `${group.length} private street${group.length === 1 ? '' : 's'}` +
        (nearGates.length ? ` and ${nearGates.length} gate${nearGates.length === 1 ? '' : 's'}` : '') +
        ' in OpenStreetMap',
    })
  }

  // Drop ones already handled, and ones sitting inside an area someone already marked.
  return out.filter((s) => s.points.length >= 3 && !known.has(s.osmId) && !zoneAt(centerOf(s.points), zones))
}

export type GatedLookup = { ok: true; suggestions: Suggestion[] } | { ok: false; error: string }

/** Asks OpenStreetMap (through /api/gated) for possible gated areas in the map view. */
export async function findGated(bbox: [number, number, number, number], zones: GatedZone[]): Promise<GatedLookup> {
  try {
    const res = await fetch('/api/gated', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error || "Couldn't reach OpenStreetMap. Try again in a few minutes." }
    return { ok: true, suggestions: buildSuggestions(data.elements ?? [], zones) }
  } catch {
    return { ok: false, error: "Couldn't reach OpenStreetMap. Check your signal and try again." }
  }
}
