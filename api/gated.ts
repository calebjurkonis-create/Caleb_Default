/**
 * POST /api/gated  { bbox: [south, west, north, east] }
 *   -> { elements: [{ type, id, tags, geometry: [[lat, lng], ...] }] }
 *
 * Looks up possible gated communities in OpenStreetMap (the map data behind the road
 * routing): areas tagged gated or private, private residential streets, and gates.
 * Public OpenStreetMap servers are often busy, so this tries a few in turn.
 */

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
const PER_SERVER_MS = 18_000
/** About 30 km across: bigger areas take too long and are rarely what someone is looking at. */
const MAX_SPAN = 0.3

type Raw = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: { role?: string; geometry?: { lat: number; lon: number }[] }[]
}

const KEEP = ['name', 'highway', 'access', 'gated', 'landuse', 'barrier']

function query([s, w, n, e]: number[]): string {
  const b = `(${s},${w},${n},${e})`
  return `[out:json][timeout:20];
(
  way["highway"~"^(residential|living_street|unclassified)$"]["access"~"^(private|no|permit)$"]${b};
  way["gated"="yes"]${b};
  relation["gated"="yes"]${b};
  way["landuse"="residential"]["access"~"^(private|no)$"]${b};
  node["barrier"~"^(gate|lift_gate|swing_gate|sliding_gate)$"]${b};
  way["landuse"="residential"]["name"]${b};
);
out tags geom;`
}

export async function POST(request: Request): Promise<Response> {
  let bbox: number[]
  try {
    bbox = (await request.json()).bbox
    const [s, w, n, e] = bbox
    if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw new Error()
    if (s >= n || w >= e || n - s > MAX_SPAN || e - w > MAX_SPAN) throw new Error()
  } catch {
    return Response.json({ error: 'Zoom in closer and try again.' }, { status: 400 })
  }
  const body = 'data=' + encodeURIComponent(query(bbox))
  let lastError = 'OpenStreetMap is busy'
  for (const url of SERVERS) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PER_SERVER_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'KnockRoute (door-knocking route planner)' },
        body,
        signal: ctrl.signal,
      })
      if (!res.ok) {
        lastError = `OpenStreetMap answered ${res.status}`
        continue
      }
      const data = (await res.json()) as { elements?: Raw[] }
      const elements = (data.elements ?? []).map((el) => {
        const tags: Record<string, string> = {}
        for (const k of KEEP) if (el.tags?.[k]) tags[k] = el.tags[k]
        const geometry =
          el.type === 'node'
            ? [[el.lat!, el.lon!]]
            : el.type === 'way'
              ? (el.geometry ?? []).map((g) => [g.lat, g.lon])
              : (el.members ?? []).filter((m) => m.role !== 'inner').flatMap((m) => (m.geometry ?? []).map((g) => [g.lat, g.lon]))
        return { type: el.type, id: el.id, tags, geometry }
      })
      return Response.json({ elements })
    } catch (err) {
      lastError = (err as Error).name === 'AbortError' ? 'OpenStreetMap took too long' : "Couldn't reach OpenStreetMap"
    } finally {
      clearTimeout(timer)
    }
  }
  return Response.json({ error: `${lastError}. Try again in a few minutes.` }, { status: 503 })
}
