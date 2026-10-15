/**
 * POST /api/roads  { kind: 'optimize' | 'directions', key, body }
 *   -> OpenRouteService's response, unchanged.
 *
 * Calls OpenRouteService from the server so phones never make cross-site requests
 * (browsers can refuse those). The app falls back to straight lines on any error.
 */

const ORS = 'https://api.openrouteservice.org'
const PATHS = { optimize: '/optimization', directions: '/v2/directions/driving-car/geojson' } as const

export async function POST(request: Request): Promise<Response> {
  let input: { kind: keyof typeof PATHS; key: string; body: unknown }
  try {
    input = await request.json()
    if (!PATHS[input.kind] || typeof input.key !== 'string' || !input.key) throw new Error()
  } catch {
    return Response.json({ error: 'Send { kind, key, body }.' }, { status: 400 })
  }
  try {
    const res = await fetch(ORS + PATHS[input.kind], {
      method: 'POST',
      headers: { Authorization: input.key, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
      body: JSON.stringify(input.body),
    })
    return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 })
  }
}
