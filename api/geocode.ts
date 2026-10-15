/**
 * POST /api/geocode  { addresses: [{ id, street, city, state, zip }] }
 *   -> { results: [{ id, lat, lng }] }
 *
 * Proxies the U.S. Census Bureau batch geocoder (free, no API key, up to 10,000 rows per call).
 * Runs server-side because the Census service doesn't accept calls straight from a browser.
 * https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 */

interface Input {
  id: string
  street: string
  city: string
  state: string
  zip: string
}

const CENSUS_BATCH = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'
const MAX_ROWS = 1000

function csvField(v: string): string {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ')
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Minimal CSV line parser for the Census response (quoted fields, commas inside quotes). */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

export async function POST(request: Request): Promise<Response> {
  let addresses: Input[]
  try {
    addresses = ((await request.json()) as { addresses: Input[] }).addresses
    if (!Array.isArray(addresses)) throw new Error()
  } catch {
    return Response.json({ error: 'Send JSON like { "addresses": [...] }.' }, { status: 400 })
  }
  if (addresses.length > MAX_ROWS) {
    return Response.json({ error: `Send at most ${MAX_ROWS} addresses per request.` }, { status: 413 })
  }

  // Census wants: Unique ID, Street address, City, State, ZIP — no header row.
  const csv = addresses
    .map((a, i) => [String(i), a.street, a.city, a.state, a.zip].map(csvField).join(','))
    .join('\n')
  const form = new FormData()
  form.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv')
  form.append('benchmark', 'Public_AR_Current')

  let text: string
  try {
    const res = await fetch(CENSUS_BATCH, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`Census geocoder returned ${res.status}`)
    text = await res.text()
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 })
  }

  const coords = new Map<number, { lat: number; lng: number }>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    // id, input address, Match|No_Match|Tie, Exact|Non_Exact, matched address, "lon,lat", tiger id, side
    const f = parseCsvLine(line)
    if (f[2] !== 'Match' || !f[5]) continue
    const [lng, lat] = f[5].split(',').map(Number)
    if (Number.isFinite(lat) && Number.isFinite(lng)) coords.set(Number(f[0]), { lat, lng })
  }

  return Response.json({
    results: addresses.map((a, i) => ({ id: a.id, lat: coords.get(i)?.lat ?? null, lng: coords.get(i)?.lng ?? null })),
  })
}
