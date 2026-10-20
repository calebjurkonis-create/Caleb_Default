import type { Point } from './route'

/** A saved spot a route can end at. Kept only on this phone. */
export interface Place extends Point {
  label: string
}

export interface SavedPlaces {
  home?: Place
  office?: Place
}

export type EndChoice = { kind: 'none' } | { kind: 'home' } | { kind: 'office' } | { kind: 'custom'; place: Place }

export function endPlace(choice: EndChoice, places: SavedPlaces): Place | null {
  if (choice.kind === 'home') return places.home ?? null
  if (choice.kind === 'office') return places.office ?? null
  if (choice.kind === 'custom') return choice.place
  return null
}

export function endName(choice: EndChoice, places: SavedPlaces): string | null {
  if (!endPlace(choice, places)) return null
  if (choice.kind === 'home') return 'Home'
  if (choice.kind === 'office') return 'Office'
  if (choice.kind === 'custom') return choice.place.label.split(',')[0]
  return null
}

/** Looks up a typed address (through /api/place). */
export async function findPlace(q: string): Promise<{ ok: true; place: Place } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/place', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || typeof data.lat !== 'number') return { ok: false, error: data.error || "Couldn't find that address." }
    return { ok: true, place: { lat: data.lat, lng: data.lng, label: data.label || q } }
  } catch {
    return { ok: false, error: "Couldn't look it up. Check your signal and try again." }
  }
}
