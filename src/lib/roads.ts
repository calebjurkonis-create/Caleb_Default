import type { Point } from './route'

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

const TIMEOUT_MS = 10_000
/** Most stops the free plan takes in one request. */
const MAX_POINTS = 50

export interface RoadPath {
  /** [lat, lng] pairs along the roads, ready for the map. */
  line: [number, number][]
  miles: number
  minutes: number
}

/** Goes through our /api/roads function so the phone never calls OpenRouteService directly. */
async function call<T>(key: string, kind: 'optimize' | 'directions', body: unknown): Promise<T | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('/api/roads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, key, body }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Best driving order for the stops, starting from `start` (open route, no return).
 * Returns the stop ids in order, or null to keep the app's own ordering.
 */
export async function orderByRoads<T extends Point & { id: string }>(key: string, start: Point, stops: T[]): Promise<string[] | null> {
  if (!key || stops.length < 3 || stops.length > MAX_POINTS) return null
  const body = {
    jobs: stops.map((s, i) => ({ id: i + 1, location: [s.lng, s.lat] })),
    vehicles: [{ id: 1, profile: 'driving-car', start: [start.lng, start.lat] }],
  }
  const res = await call<{ routes?: { steps: { type: string; job?: number }[] }[]; unassigned?: unknown[] }>(key, 'optimize', body)
  const steps = res?.routes?.[0]?.steps
  if (!steps || (res?.unassigned && (res.unassigned as unknown[]).length)) return null
  const ids = steps.filter((s) => s.type === 'job' && s.job != null).map((s) => stops[s.job! - 1]?.id)
  // Only trust a complete answer that visits every stop exactly once.
  if (ids.length !== stops.length || new Set(ids).size !== stops.length || ids.some((x) => !x)) return null
  return ids as string[]
}

/** The driving path through the points in order, with real miles and minutes. */
export async function roadPath(key: string, points: Point[]): Promise<RoadPath | null> {
  if (!key || points.length < 2) return null
  const line: [number, number][] = []
  let meters = 0
  let seconds = 0
  // Long routes go in overlapping chunks (the last point of one is the first of the next).
  for (let i = 0; i < points.length - 1; i += MAX_POINTS - 1) {
    const chunk = points.slice(i, i + MAX_POINTS)
    const res = await call<{
      features?: { geometry: { coordinates: [number, number][] }; properties: { summary?: { distance?: number; duration?: number } } }[]
    }>(key, 'directions', { coordinates: chunk.map((p) => [p.lng, p.lat]) })
    const f = res?.features?.[0]
    if (!f?.geometry?.coordinates?.length) return null
    for (const [lng, lat] of f.geometry.coordinates) line.push([lat, lng])
    meters += f.properties.summary?.distance ?? 0
    seconds += f.properties.summary?.duration ?? 0
  }
  return { line, miles: meters / 1609.344, minutes: Math.round(seconds / 60) }
}
