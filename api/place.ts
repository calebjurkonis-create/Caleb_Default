/**
 * POST /api/place  { q: "123 Main St, Orlando FL 32801" }
 *   -> { lat, lng, label }  or 404 { error }
 *
 * Finds one typed address (a route's end point, like home or the office).
 * Tries the Census geocoder first, then OpenStreetMap's Nominatim, then Photon.
 */

const UA = 'KnockRoute/1.0 (internal door-knocking route planner)'
const TIMEOUT_MS = 8000

async function get(url: string): Promise<unknown | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: ctrl.signal })
    return res.ok ? await res.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type Found = { lat: number; lng: number; label: string }

async function census(q: string): Promise<Found | null> {
  const params = new URLSearchParams({ address: q, benchmark: 'Public_AR_Current', format: 'json' })
  const body = (await get(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`)) as {
    result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number } }[] }
  } | null
  const m = body?.result?.addressMatches?.[0]
  return m ? { lat: m.coordinates.y, lng: m.coordinates.x, label: m.matchedAddress } : null
}

async function nominatim(q: string): Promise<Found | null> {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'us', q })
  const body = (await get(`https://nominatim.openstreetmap.org/search?${params}`)) as { lat: string; lon: string; display_name: string }[] | null
  const hit = body?.[0]
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null
}

async function photon(q: string): Promise<Found | null> {
  const body = (await get(`https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: '1', lang: 'en' })}`)) as {
    features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[]
  } | null
  const f = body?.features?.[0]
  if (!f) return null
  const p = f.properties
  const label = [[p.housenumber, p.street].filter(Boolean).join(' ') || p.name, p.city, p.state].filter(Boolean).join(', ')
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label }
}

export async function POST(request: Request): Promise<Response> {
  let q = ''
  try {
    q = String((await request.json()).q ?? '').trim().slice(0, 200)
  } catch {
    /* handled below */
  }
  if (q.length < 5) return Response.json({ error: 'Type the full address.' }, { status: 400 })
  const found = (await census(q)) ?? (await nominatim(q)) ?? (await photon(q))
  if (!found) return Response.json({ error: "Couldn't find that address. Check the spelling and include the city." }, { status: 404 })
  return Response.json(found)
}
