export interface GeocodeInput {
  id: string
  street: string
  city: string
  state: string
  zip: string
}

export interface GeocodeResult {
  id: string
  lat: number | null
  lng: number | null
}

const BATCH = 250

/**
 * Turns addresses into map coordinates through our /api/geocode function,
 * which uses the free U.S. Census Bureau geocoder. Runs in batches so a
 * 1,000-row list shows steady progress.
 */
export async function geocodeAll(
  items: GeocodeInput[],
  onProgress: (done: number, total: number) => void,
): Promise<GeocodeResult[]> {
  const out: GeocodeResult[] = []
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH)
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ addresses: chunk }),
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      throw new Error(`The address lookup service didn't respond (${res.status}). ${msg}`.trim())
    }
    const body = (await res.json()) as { results: GeocodeResult[] }
    out.push(...body.results)
    onProgress(Math.min(i + BATCH, items.length), items.length)
  }
  return out
}

const FALLBACK_BATCH = 10

/**
 * Second try for addresses the Census missed, through OpenStreetMap. Slow on purpose
 * (about one address per second), so use it only for the leftovers.
 */
export async function geocodeFallback(
  items: GeocodeInput[],
  onProgress: (done: number, total: number) => void = () => {},
): Promise<GeocodeResult[]> {
  const out: GeocodeResult[] = []
  for (let i = 0; i < items.length; i += FALLBACK_BATCH) {
    const chunk = items.slice(i, i + FALLBACK_BATCH)
    try {
      const res = await fetch('/api/geocode-fallback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addresses: chunk }),
      })
      if (!res.ok) throw new Error(String(res.status))
      out.push(...((await res.json()) as { results: GeocodeResult[] }).results)
    } catch {
      // A second-chance lookup failing just leaves these without a pin.
      out.push(...chunk.map((c) => ({ id: c.id, lat: null, lng: null })))
    }
    onProgress(Math.min(i + FALLBACK_BATCH, items.length), items.length)
  }
  return out
}
