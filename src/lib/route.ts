export interface Point {
  lat: number
  lng: number
}

const EARTH_MILES = 3958.8

export function milesBetween(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h))
}

/**
 * Orders stops for the shortest drive from `start` (and on to `end`, when the route has a
 * destination): nearest-neighbor or cheapest insertion, then 2-opt clean-up.
 * Straight-line distance is a good stand-in for road distance inside a neighborhood,
 * and it keeps planning free and instant with no routing service.
 */
export function optimizeOrder<T extends Point>(start: Point, stops: T[], end?: Point | null): T[] {
  if (stops.length < 2) return [...stops]
  const order: T[] = end ? insertionOrder(start, stops, end) : nearestOrder(start, stops)

  // 2-opt on a path anchored at `start` (and at `end`, which never moves).
  const path: Point[] = end ? [start, ...order, end] : [start, ...order]
  const last = end ? path.length - 2 : path.length - 1
  const d = (i: number, j: number) => milesBetween(path[i], path[j])
  let improved = true
  let passes = 0
  while (improved && passes++ < 50) {
    improved = false
    for (let i = 1; i < last; i++) {
      for (let k = i + 1; k <= last; k++) {
        const before = d(i - 1, i) + (k + 1 < path.length ? d(k, k + 1) : 0)
        const after = d(i - 1, k) + (k + 1 < path.length ? d(i, k + 1) : 0)
        if (after + 1e-9 < before) {
          const rev = path.slice(i, k + 1).reverse()
          path.splice(i, rev.length, ...rev)
          improved = true
        }
      }
    }
  }
  return path.slice(1, last + 1) as T[]
}

function nearestOrder<T extends Point>(start: Point, stops: T[]): T[] {
  const remaining = [...stops]
  const order: T[] = []
  let here: Point = start
  while (remaining.length) {
    let best = 0
    let bestD = Infinity
    remaining.forEach((s, i) => {
      const d = milesBetween(here, s)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    here = remaining.splice(best, 1)[0]
    order.push(here as T)
  }
  return order
}

/** With a destination: grow the trip by slotting each stop wherever it adds the least driving. */
function insertionOrder<T extends Point>(start: Point, stops: T[], end: Point): T[] {
  // Farthest-from-the-straight-line stops first gives a better outline to fill in.
  const detour = (s: Point) => milesBetween(start, s) + milesBetween(s, end)
  const todo = [...stops].sort((a, b) => detour(b) - detour(a))
  const path: Point[] = [start, end]
  for (const s of todo) {
    let best = 1
    let bestCost = Infinity
    for (let i = 1; i < path.length; i++) {
      const cost = milesBetween(path[i - 1], s) + milesBetween(s, path[i]) - milesBetween(path[i - 1], path[i])
      if (cost < bestCost) {
        bestCost = cost
        best = i
      }
    }
    path.splice(best, 0, s)
  }
  return path.slice(1, -1) as T[]
}

/** How far out of the way a stop is on the drive from `start` to `end` (miles of extra driving). */
export function detourMiles(start: Point, end: Point, s: Point): number {
  return milesBetween(start, s) + milesBetween(s, end) - milesBetween(start, end)
}

/** Rough drive estimate: streets wind ~35% more than a straight line, ~25 mph in neighborhoods. */
export function routeEstimate(start: Point, stops: Point[], end?: Point | null): { miles: number; driveMin: number } {
  let miles = 0
  let here = start
  for (const s of end ? [...stops, end] : stops) {
    miles += milesBetween(here, s)
    here = s
  }
  miles *= 1.35
  return { miles, driveMin: Math.round((miles / 25) * 60) }
}

export type NavApp = 'apple' | 'google' | 'waze'

/** A street address (for street-level pins, so the maps app finds the house itself) or exact coordinates. */
export function navUrl(app: NavApp, to: Point | string): string {
  if (typeof to === 'string') {
    const q = encodeURIComponent(to)
    if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
    if (app === 'waze') return `https://waze.com/ul?q=${q}&navigate=yes`
    return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`
  }
  const ll = `${to.lat},${to.lng}`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${ll}&dirflg=d`
  if (app === 'waze') return `https://waze.com/ul?ll=${ll}&navigate=yes`
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`
}

/**
 * Google Maps takes up to 9 waypoints in one link; longer routes open in legs.
 * `where` gives a stop's street address (preferred, so Google finds the house itself);
 * stops without one go by coordinates.
 */
export function googleRouteLegs(start: Point | null, stopsOnly: Point[], end?: Point | null, where?: (p: Point) => string | null): string[] {
  const stops = end && stopsOnly.length ? [...stopsOnly, end] : stopsOnly
  const legs: string[] = []
  const ll = (p: Point) => (p === start ? null : where?.(p)) || `${p.lat},${p.lng}`
  let origin = start
  for (let i = 0; i < stops.length; i += 10) {
    const chunk = stops.slice(i, i + 10)
    const dest = chunk[chunk.length - 1]
    const waypoints = chunk.slice(0, -1).map(ll).join('|')
    const params = new URLSearchParams({ api: '1', destination: ll(dest), travelmode: 'driving' })
    if (origin) params.set('origin', ll(origin))
    if (waypoints) params.set('waypoints', waypoints)
    legs.push(`https://www.google.com/maps/dir/?${params.toString()}`)
    origin = dest
  }
  return legs
}

/** Ray-casting point-in-polygon, used by the lasso. */
export function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.lng > p.lng !== b.lng > p.lng && p.lat < ((b.lat - a.lat) * (p.lng - a.lng)) / (b.lng - a.lng) + a.lat) {
      inside = !inside
    }
  }
  return inside
}
