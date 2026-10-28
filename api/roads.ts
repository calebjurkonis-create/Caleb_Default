/**
 * POST /api/roads  { kind: 'optimize' | 'directions', key, body }
 *   -> OpenRouteService's response, unchanged (plus an x-roads-host header saying which address answered).
 *
 * Calls OpenRouteService from the server so phones never make cross-site requests
 * (browsers can refuse those). The app falls back to straight lines on any error.
 *
 * OpenRouteService moved to api.heigit.org (the old api.openrouteservice.org shuts down in
 * November 2026). The new address is tried first; if it's down or misrouted, the old one.
 */

const HOSTS: Record<'optimize' | 'directions', string[]> = {
  directions: [
    'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson',
    'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
  ],
  optimize: ['https://api.heigit.org/vroom/v0', 'https://api.openrouteservice.org/optimization'],
}
const PER_HOST_MS = 12_000

export async function POST(request: Request): Promise<Response> {
  let input: { kind: keyof typeof HOSTS; key: string; body: unknown }
  try {
    input = await request.json()
    if (!HOSTS[input.kind] || typeof input.key !== 'string' || !input.key) throw new Error()
  } catch {
    return Response.json({ error: 'Send { kind, key, body }.' }, { status: 400 })
  }
  let last: Response | null = null
  let lastError = 'routing service unreachable'
  for (const url of HOSTS[input.kind]) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PER_HOST_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: input.key, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
        body: JSON.stringify(input.body),
        signal: ctrl.signal,
      })
      const text = await res.text()
      const out = new Response(text, { status: res.status, headers: { 'content-type': 'application/json', 'x-roads-host': new URL(url).host } })
      // A real answer (success, or a problem with the request/key/limit): pass it on.
      // Server trouble or a path the host doesn't know: try the other address.
      if (res.status < 500 && res.status !== 404 && res.status !== 405) return out
      last = out
    } catch (err) {
      lastError = (err as Error).name === 'AbortError' ? 'routing service timed out' : (err as Error).message
    } finally {
      clearTimeout(timer)
    }
  }
  return last ?? Response.json({ error: lastError }, { status: 502 })
}
