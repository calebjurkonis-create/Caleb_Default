import { useState } from 'react'
import { findPlace, type EndChoice, type Place, type SavedPlaces } from '../lib/places'
import type { Point } from '../lib/route'
import { Icon } from './Icon'

interface Props {
  places: SavedPlaces
  choice: EndChoice
  /** Where the phone is now, for "Use where I am now". */
  here: Point | null
  onChoice(c: EndChoice): void
  /** A place was just saved and picked (both at once, so the route re-orders with it). */
  onSaved(c: EndChoice, places: SavedPlaces): void
}

type Editing = 'home' | 'office' | 'custom' | null

/** Where today's route finishes: nowhere in particular, home, the office, or any address. */
export function EndPicker({ places, choice, here, onChoice, onSaved }: Props) {
  const [editing, setEditing] = useState<Editing>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open(kind: Exclude<Editing, null>) {
    setEditing(kind)
    setQ(kind === 'custom' ? '' : places[kind]?.label ?? '')
    setError(null)
  }

  function use(kind: Exclude<Editing, null>, place: Place) {
    if (kind === 'custom') onChoice({ kind: 'custom', place })
    else onSaved({ kind }, { ...places, [kind]: place })
    setEditing(null)
  }

  async function lookUp() {
    if (!editing) return
    setBusy(true)
    setError(null)
    const res = await findPlace(q.trim())
    setBusy(false)
    if (res.ok) use(editing, res.place)
    else setError(res.error)
  }

  const pick = (kind: 'home' | 'office') => (places[kind] ? onChoice({ kind }) : open(kind))
  const selected = choice.kind
  const current = choice.kind === 'home' ? places.home : choice.kind === 'office' ? places.office : choice.kind === 'custom' ? choice.place : undefined

  return (
    <div className="card end-picker">
      <div className="eyebrow">Starts where you are · ends at</div>
      <div className="chips" style={{ position: 'static', padding: 0, flexWrap: 'wrap' }} role="group" aria-label="Route ends at">
        <button className="chip" aria-pressed={selected === 'none'} onClick={() => { onChoice({ kind: 'none' }); setEditing(null) }}>No end</button>
        <button className="chip" aria-pressed={selected === 'home' && !!places.home} onClick={() => pick('home')}>Home</button>
        <button className="chip" aria-pressed={selected === 'office' && !!places.office} onClick={() => pick('office')}>Office</button>
        <button className="chip" aria-pressed={selected === 'custom'} onClick={() => open('custom')}>Other address…</button>
      </div>
      {current && !editing && (
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <div className="muted" style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Icon name="nav" /> {current.label}
          </div>
          {selected !== 'custom' && selected !== 'none' && (
            <button className="btn small" onClick={() => open(selected)}>Change</button>
          )}
        </div>
      )}
      {editing && (
        <form
          className="section"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault()
            lookUp()
          }}
        >
          <label className="field">
            {editing === 'home' ? 'Your home address' : editing === 'office' ? 'Office address' : 'Ending address'}
            <input id="end-address" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="123 Main St, Orlando FL" autoComplete="street-address" />
          </label>
          {editing !== 'custom' && <div className="muted" style={{ fontSize: 13 }}>Saved on this phone only. Nobody else on the team sees it.</div>}
          {error && <div className="err">{error}</div>}
          <div className="row">
            <button className="btn primary small" disabled={busy || q.trim().length < 5}>{busy ? 'Finding…' : 'Find address'}</button>
            {here && (
              <button type="button" className="btn small" disabled={busy} onClick={() => use(editing, { lat: here.lat, lng: here.lng, label: `${editing === 'home' ? 'Home' : editing === 'office' ? 'Office' : 'Spot'} · set from your location` })}>
                Use where I am now
              </button>
            )}
            <button type="button" className="btn small" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
