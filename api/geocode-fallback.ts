/**
 * POST /api/geocode-fallback  { addresses: [{ id, street, city, state, zip }] }  (up to 20)
 *   -> { results: [{ id, lat, lng, source }] }
 *
 * Second chance for addresses the Census geocoder missed (often new construction).
 * Tries OpenStreetMap's Nominatim, then Photon, one address at a time. Nominatim's
 * usage policy allows about one request per second, so this paces itself and only
 * ever handles the small leftover set, never whole lists.
 * House-level matches come first. If neither service knows the house (typical for
 * new builds), it settles for the street itself and flags the result approx: true,
 * so the app can draw it as a street pin and agents read the house number on arrival.
 */

interface Input {
  id: string
  street: string
  city: string
  state: string
  zip: string
}

const MAX = 10
const UA = 'KnockRoute/1.0 (internal door-knocking route planner)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Hit = { lat: number; lng: number }

function streetName(street: string): string {
  return street.replace(/^\s*\d+[A-Za-z]?\s+/, '').trim()
}

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

/** The street's own location, only when the match is clearly that street in that ZIP or city. */
async function nominatimStreet(a: Input): Promise<Hit | null> {
  const name = streetName(a.street)
  if (!name || name === a.street.trim()) return null
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'us',
    street: name,
    city: a.city,
    state: a.state,
    postalcode: a.zip,
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } })
  if (!res.ok) return null
  const [hit] = (await res.json()) as { lat: string; lon: string; category?: string; addresstype?: string; address?: { road?: string; postcode?: string; city?: string; town?: string; village?: string } }[]
  if (!hit || !(hit.category === 'highway' || hit.addresstype === 'road') || !hit.address?.road) return null
  if (!sameArea(a, hit.address.postcode, hit.address.city ?? hit.address.town ?? hit.address.village)) return null
  return { lat: Number(hit.lat), lng: Number(hit.lon) }
}

async function photonStreet(a: Input): Promise<Hit | null> {
  const name = streetName(a.street)
  if (!name || name === a.street.trim()) return null
  const q = `${name}, ${a.city}, ${a.state} ${a.zip}`
  const res = await fetch(`https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: '3', lang: 'en' })}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const body = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: { type?: string; name?: string; postcode?: string; city?: string } }[] }
  const f = body.features?.find((x) => x.properties.type === 'street' && sameArea(a, x.properties.postcode, x.properties.city))
  if (!f) return null
  const [lng, lat] = f.geometry.coordinates
  return { lat, lng }
}

/** ZIP must agree when both sides have one; otherwise the city must. */
function sameArea(a: Input, postcode?: string, city?: string): boolean {
  if (a.zip && postcode) return postcode.slice(0, 5) === a.zip.slice(0, 5)
  return !!city && city.toLowerCase().replace(/^saint /, 'st ') === a.city.toLowerCase().replace(/^saint /, 'st ')
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

  const results: { id: string; lat: number | null; lng: number | null; source: string | null; approx: boolean }[] = []
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
    let approx = false
    if (!hit) {
      await sleep(1100)
      try {
        hit = await nominatimStreet(a)
        if (hit) source = 'openstreetmap-street'
      } catch {
        /* try the next service */
      }
      if (!hit) {
        try {
          hit = await photonStreet(a)
          if (hit) source = 'photon-street'
        } catch {
          /* leave it unfound */
        }
      }
      approx = !!hit
    }
    results.push({ id: a.id, lat: hit?.lat ?? null, lng: hit?.lng ?? null, source, approx })
    if (i < addresses.length - 1) await sleep(1100)
  }
  return Response.json({ results })
}
