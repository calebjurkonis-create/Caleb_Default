/**
 * POST /api/geocode-fallback  { addresses: [{ id, street, city, state, zip }] }  (up to 20)
 *   -> { results: [{ id, lat, lng, source }] }
 *
 * Second chance for addresses the Census geocoder missed (often new construction).
 * Tries OpenStreetMap's Nominatim, then Photon, one address at a time. Nominatim's
 * usage policy allows about one request per second, so this paces itself and only
 * ever handles the small leftover set, never whole lists.
 * Only house-level matches count; street-only guesses come back empty so nobody
 * gets sent to the wrong door.
 */

interface Input {
  id: string
  street: string
  city: string
  state: string
  zip: string
}

const MAX = 20
const UA = 'KnockRoute/1.0 (internal door-knocking route planner)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function houseNumber(street: string): string {
  return (/^\s*(\d+[A-Za-z]?)\b/.exec(street)?.[1] ?? '').toLowerCase()
}

async function nominatim(a: Input): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'us',
    street: a.street,
    city: a.city,
    state: a.state,
    postalcode: a.zip,
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } })
  if (!res.ok) return null
  const [hit] = (await res.json()) as { lat: string; lon: string; address?: { house_number?: string } }[]
  if (!hit || !hit.address?.house_number) return null
  if (houseNumber(a.street) && hit.address.house_number.toLowerCase() !== houseNumber(a.street)) return null
  return { lat: Number(hit.lat), lng: Number(hit.lon) }
}

async function photon(a: Input): Promise<{ lat: number; lng: number } | null> {
  const q = `${a.street}, ${a.city}, ${a.state} ${a.zip}`
  const res = await fetch(`https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: '1', lang: 'en' })}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const body = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: { housenumber?: string; postcode?: string } }[] }
  const f = body.features?.[0]
  if (!f?.properties.housenumber) return null
  if (houseNumber(a.street) && f.properties.housenumber.toLowerCase() !== houseNumber(a.street)) return null
  if (a.zip && f.properties.postcode && !f.properties.postcode.startsWith(a.zip.slice(0, 5))) return null
  const [lng, lat] = f.geometry.coordinates
  return { lat, lng }
}

export async function POST(request: Request): Promise<Response> {
  let addresses: Input[]
  try {
    addresses = ((await request.json()) as { addresses: Input[] }).addresses
    if (!Array.isArray(addresses)) throw new Error()
  } catch {
    return Response.json({ error: 'Send JSON like { "addresses": [...] }.' }, { status: 400 })
  }
  if (addresses.length > MAX) return Response.json({ error: `Send at most ${MAX} addresses per request.` }, { status: 413 })

  const results: { id: string; lat: number | null; lng: number | null; source: string | null }[] = []
  for (let i = 0; i < addresses.length; i++) {
    const a = addresses[i]
    let hit: { lat: number; lng: number } | null = null
    let source: string | null = null
    try {
      hit = await nominatim(a)
      if (hit) source = 'openstreetmap'
    } catch {
      /* try the next service */
    }
    if (!hit) {
      try {
        hit = await photon(a)
        if (hit) source = 'photon'
      } catch {
        /* leave it unfound */
      }
    }
    results.push({ id: a.id, lat: hit?.lat ?? null, lng: hit?.lng ?? null, source })
    if (i < addresses.length - 1) await sleep(1100)
  }
  return Response.json({ results })
}
