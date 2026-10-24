import { spreadStreetPin } from './geocode'

/**
 * Puts leads the address lookup couldn't find onto the map anyway, near where they must be,
 * using leads that are already pinned. No network calls, so it's instant:
 *  1. Same street and ZIP: estimated from the house number between known neighbors
 *     (new builds on an existing street usually land within a few houses).
 *  2. Same ZIP: the middle of that ZIP's known leads, spread out so each pin can be tapped.
 * Anything with no pinned neighbor in its ZIP is returned as unplaced (see zipCenters).
 * All of these are approximate: shown as dashed pins, and Navigate goes by the address.
 */

export interface PlaceTarget {
  id: string
  address: string
  zip: string
  city: string
}

export interface KnownPin {
  address: string
  zip: string
  lat: number
  lng: number
}

const SUFFIX: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', drive: 'dr', road: 'rd', lane: 'ln', court: 'ct', circle: 'cir',
  boulevard: 'blvd', place: 'pl', terrace: 'ter', trail: 'trl', parkway: 'pkwy', highway: 'hwy', cove: 'cv',
  point: 'pt', loop: 'loop', way: 'way', run: 'run', square: 'sq', crossing: 'xing', path: 'path', pass: 'pass',
  north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
}

/** "1234 N Oak Street" → { num: 1234, street: "n oak st" } */
export function splitAddress(address: string): { num: number | null; street: string } {
  const m = /^\s*(\d+)[A-Za-z]?\s+(.*)$/.exec(address)
  const rest = (m ? m[2] : address).toLowerCase().replace(/[.,#]/g, ' ')
  const street = rest.split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] ?? w).join(' ')
  return { num: m ? Number(m[1]) : null, street }
}

const zip5 = (z: string) => String(z ?? '').trim().slice(0, 5)

/** A wider, deterministic spread for ZIP-level pins so a group of them doesn't stack on one dot. */
function spreadWide(id: string, lat: number, lng: number): { lat: number; lng: number } {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const angle = (h % 360) * (Math.PI / 180)
  const dist = 0.0004 + ((h >>> 9) % 100) * 0.00002 // ~45 m to ~260 m
  return { lat: lat + Math.sin(angle) * dist, lng: lng + Math.cos(angle) * dist }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function placeNearNeighbors(targets: PlaceTarget[], known: KnownPin[]): { placed: Map<string, { lat: number; lng: number }>; unplaced: PlaceTarget[] } {
  const byStreet = new Map<string, { num: number | null; lat: number; lng: number }[]>()
  const byZip = new Map<string, { lat: number; lng: number }[]>()
  for (const k of known) {
    const z = zip5(k.zip)
    const { num, street } = splitAddress(k.address)
    const key = `${street}|${z}`
    if (!byStreet.has(key)) byStreet.set(key, [])
    byStreet.get(key)!.push({ num, lat: k.lat, lng: k.lng })
    if (!byZip.has(z)) byZip.set(z, [])
    byZip.get(z)!.push({ lat: k.lat, lng: k.lng })
  }

  const placed = new Map<string, { lat: number; lng: number }>()
  const unplaced: PlaceTarget[] = []
  for (const t of targets) {
    const z = zip5(t.zip)
    const { num, street } = splitAddress(t.address)
    const onStreet = byStreet.get(`${street}|${z}`)
    if (onStreet?.length) {
      const numbered = onStreet.filter((s) => s.num != null).sort((a, b) => a.num! - b.num!)
      let at: { lat: number; lng: number } = onStreet[0]
      if (num != null && numbered.length) {
        const below = [...numbered].reverse().find((s) => s.num! <= num)
        const above = numbered.find((s) => s.num! >= num)
        if (below && above && above.num !== below.num) {
          const f = (num - below.num!) / (above.num! - below.num!)
          at = { lat: below.lat + (above.lat - below.lat) * f, lng: below.lng + (above.lng - below.lng) * f }
        } else at = below ?? above ?? at
      }
      placed.set(t.id, spreadStreetPin(t.id, at.lat, at.lng))
      continue
    }
    const inZip = byZip.get(z)
    if (inZip && inZip.length >= 3) {
      placed.set(t.id, spreadWide(t.id, median(inZip.map((p) => p.lat)), median(inZip.map((p) => p.lng))))
      continue
    }
    unplaced.push(t)
  }
  return { placed, unplaced }
}

/** Last resort: the center of each ZIP code (one lookup per ZIP, through /api/place). */
export async function zipCenters(targets: PlaceTarget[], state = 'FL'): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>()
  const zips = [...new Map(targets.filter((t) => zip5(t.zip)).map((t) => [zip5(t.zip), t])).values()]
  const centers = new Map<string, { lat: number; lng: number }>()
  for (let i = 0; i < zips.length; i += 4) {
    await Promise.all(
      zips.slice(i, i + 4).map(async (t) => {
        try {
          const res = await fetch('/api/place', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: `${t.city ? t.city + ', ' : ''}${state} ${zip5(t.zip)}`, area: true }),
          })
          const d = await res.json()
          if (res.ok && typeof d.lat === 'number') centers.set(zip5(t.zip), { lat: d.lat, lng: d.lng })
        } catch {
          /* stays unplaced */
        }
      }),
    )
  }
  for (const t of targets) {
    const c = centers.get(zip5(t.zip))
    if (c) out.set(t.id, spreadWide(t.id, c.lat, c.lng))
  }
  return out
}
