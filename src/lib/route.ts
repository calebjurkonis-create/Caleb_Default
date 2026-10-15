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
 * Orders stops for the shortest drive from `start`: nearest-neighbor, then 2-opt clean-up.
 * Straight-line distance is a good stand-in for road distance inside a neighborhood,
 * and it keeps planning free and instant with no routing service.
 */
export function optimizeOrder<T extends Point>(start: Point, stops: T[]): T[] {
  if (stops.length < 2) return [...stops]
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

  // 2-opt on an open path anchored at `start`.
  const path: Point[] = [start, ...order]
  const d = (i: number, j: number) => milesBetween(path[i], path[j])
  let improved = true
  let passes = 0
  while (improved && passes++ < 50) {
    improved = false
    for (let i = 1; i < path.length - 1; i++) {
      for (let k = i + 1; k < path.length; k++) {
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
  return path.slice(1) as T[]
}

/** Rough drive estimate: streets wind ~35% more than a straight line, ~25 mph in neighborhoods. */
export function routeEstimate(start: Point, stops: Point[]): { miles: number; driveMin: number } {
  let miles = 0
  let here = start
  for (const s of stops) {
    miles += milesBetween(here, s)
    here = s
  }
  miles *= 1.35
  return { miles, driveMin: Math.round((miles / 25) * 60) }
}

export type NavApp = 'apple' | 'google' | 'waze'

export function navUrl(app: NavApp, to: Point): string {
  const ll = `${to.lat},${to.lng}`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${ll}&dirflg=d`
  if (app === 'waze') return `https://waze.com/ul?ll=${ll}&navigate=yes`
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`
}

/** Google Maps takes up to 9 waypoints in one link; longer routes open in legs. */
export function googleRouteLegs(start: Point | null, stops: Point[]): string[] {
  const legs: string[] = []
  const ll = (p: Point) => `${p.lat},${p.lng}`
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
