import { milesBetween, type Point } from './route'

/**
 * Road routing through OpenRouteService (free plan: about 2,000 route drawings and
 * 500 route orderings a day). Every call here is optional: on any failure, slowness
 * or missing key it returns null and the app keeps its straight-line behavior.
 */

/**
 * The office's OpenRouteService key, built in so routing works with no setup.
 * A manager can replace it (or turn routing off) under More → Road routing.
 */
export const BUILT_IN_ROAD_KEY =
  'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImNiMmVhMjg0OGZiZjQ3ZDBhOTBjYTExYWRjODY0Mjk5IiwiaCI6Im11cm11cjY0In0='

/** The key to use: a manager's saved key, the built-in one, or none if a manager turned routing off. */
export function effectiveRoadKey(saved: string): string {
  if (saved === 'off') return ''
  return saved || BUILT_IN_ROAD_KEY
}

const TIMEOUT_MS = 15_000
/** Most stops the free plan takes in one request. */
const MAX_POINTS = 50

export interface RoadPath {
  /** [lat, lng] pairs along the roads, ready for the map. */
  line: [number, number][]
  miles: number
  minutes: number
  /** Some legs couldn't be routed by road and are drawn straight (e.g. a new street not on the map yet). */
  partial?: boolean
}

type Reply<T> = { data: T | null; status: number }

/** Goes through our /api/roads function so the phone never calls OpenRouteService directly. */
async function call<T>(key: string, kind: 'optimize' | 'directions', body: unknown): Promise<Reply<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch('/api/roads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, key, body }),
        signal: ctrl.signal,
      })
      // Too many requests at once (the whole team shares one key): wait a moment, try once more.
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 2500))
        continue
      }
      if (!res.ok) return { data: null, status: res.status }
      return { data: (await res.json()) as T, status: res.status }
    } catch {
      return { data: null, status: 0 }
    } finally {
      clearTimeout(timer)
    }
  }
  return { data: null, status: 429 }
}

/**
 * Best driving order for the stops, starting from `start` and finishing at `end` if given
 * (otherwise an open route).
 * Returns the stop ids in order, or null to keep the app's own ordering.
 */
export async function orderByRoads<T extends Point & { id: string }>(key: string, start: Point, stops: T[], end?: Point | null): Promise<string[] | null> {
  if (!key || stops.length < 3 || stops.length > MAX_POINTS - (end ? 1 : 0)) return null
  const body = {
    jobs: stops.map((s, i) => ({ id: i + 1, location: [s.lng, s.lat] })),
    vehicles: [{ id: 1, profile: 'driving-car', start: [start.lng, start.lat], ...(end ? { end: [end.lng, end.lat] } : {}) }],
  }
  const { data: res } = await call<{ routes?: { steps: { type: string; job?: number }[] }[]; unassigned?: unknown[] }>(key, 'optimize', body)
  const steps = res?.routes?.[0]?.steps
  if (!steps || (res?.unassigned && (res.unassigned as unknown[]).length)) return null
  const ids = steps.filter((s) => s.type === 'job' && s.job != null).map((s) => stops[s.job! - 1]?.id)
  // Only trust a complete answer that visits every stop exactly once.
  if (ids.length !== stops.length || new Set(ids).size !== stops.length || ids.some((x) => !x)) return null
  return ids as string[]
}

type Leg = { line: [number, number][]; meters: number; seconds: number; straight: boolean }

/** Requests for one route drawing at most, so a bad stretch can't use up the team's daily allowance. */
const MAX_REQUESTS = 24
/** Rough city driving speed for legs drawn straight. */
const STRAIGHT_MPS = 11

function straightLeg(a: Point, b: Point): Leg {
  const meters = milesBetween(a, b) * 1609.344
  return { line: [[a.lat, a.lng], [b.lat, b.lng]], meters, seconds: meters / STRAIGHT_MPS, straight: true }
}

/**
 * The driving path through the points in order, with real miles and minutes.
 * If part of the route can't be routed (one house far from any mapped road, say), only that
 * stretch is drawn straight; the rest still follows the roads. Null only if routing is
 * unavailable altogether (bad key, daily limit, no signal).
 */
export async function roadPath(key: string, points: Point[]): Promise<RoadPath | null> {
  if (!key || points.length < 2) return null
  let requests = 0
  let unavailable = false

  async function solve(pts: Point[]): Promise<Leg[]> {
    if (unavailable || requests >= MAX_REQUESTS) return pts.slice(1).map((p, i) => straightLeg(pts[i], p))
    requests++
    const { data, status } = await call<{
      features?: { geometry: { coordinates: [number, number][] }; properties: { summary?: { distance?: number; duration?: number } } }[]
    }>(key, 'directions', {
      coordinates: pts.map((p) => [p.lng, p.lat]),
      // Snap each stop to the nearest road however far it is, instead of failing the whole request.
      radiuses: pts.map(() => -1),
    })
    const f = data?.features?.[0]
    if (f?.geometry?.coordinates?.length) {
      return [{
        line: f.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
        meters: f.properties.summary?.distance ?? 0,
        seconds: f.properties.summary?.duration ?? 0,
        straight: false,
      }]
    }
    // Key refused, daily limit used up, or no connection: no point trying smaller pieces.
    if (status === 0 || status === 401 || status === 403 || status === 429) {
      unavailable = true
      return pts.slice(1).map((p, i) => straightLeg(pts[i], p))
    }
    if (pts.length <= 2) return [straightLeg(pts[0], pts[1])]
    // Split the stretch in half and try each part, so one bad stop only straightens its own legs.
    const mid = Math.floor(pts.length / 2)
    return [...(await solve(pts.slice(0, mid + 1))), ...(await solve(pts.slice(mid)))]
  }

  const legs: Leg[] = []
  // Long routes go in overlapping chunks (the last point of one is the first of the next).
  for (let i = 0; i < points.length - 1; i += MAX_POINTS - 1) legs.push(...(await solve(points.slice(i, i + MAX_POINTS))))
  if (legs.every((l) => l.straight)) return null
  const line: [number, number][] = []
  for (const l of legs) line.push(...(line.length ? l.line.slice(1) : l.line))
  const meters = legs.reduce((t, l) => t + l.meters, 0)
  const seconds = legs.reduce((t, l) => t + l.seconds, 0)
  return { line, miles: meters / 1609.344, minutes: Math.round(seconds / 60), partial: legs.some((l) => l.straight) }
}
