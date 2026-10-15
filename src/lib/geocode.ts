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
