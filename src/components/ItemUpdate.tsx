import { useState } from 'react'
import type { Store } from '../data/store'
import { RESOLUTIONS, STATUS } from '../lib/dispositions'
import { fromLocalInput, toLocalInput } from '../lib/agenda'
import { Icon } from './Icon'
import type { Activity, Outcome } from '../types'

/**
 * Status buttons for an open follow-up or appointment:
 * follow-up → Booked / Not Interested; appointment → Sold / Follow-Up / Not Interested.
 */
export function ItemUpdate({ store, item, onDone }: { store: Store; item: Activity; onDone(msg: string): void }) {
  const choices = RESOLUTIONS[item.outcome] ?? []
  const [pick, setPick] = useState<Outcome | null>(null)
  const [when, setWhen] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choice = choices.find((c) => c.outcome === pick)
  const needsDate = !!choice?.needsDate

  async function save() {
    if (!pick) return
    const due = needsDate ? fromLocalInput(when) : null
    if (needsDate && !due) {
      setError(`Pick a date and time for the ${pick === 'appointment' ? 'appointment' : 'follow-up'}.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await store.resolveItem(item.id, pick, notes.trim(), due)
      onDone(`Updated: ${choice!.label}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="section" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6 }} role="group" aria-label="Update status">
        {choices.map((c) => (
          <button
            key={c.outcome}
            className="outcome"
            style={{ flex: '1 1 30%', minHeight: 44 }}
            aria-pressed={pick === c.outcome}
            onClick={() => { setPick(c.outcome); setError(null) }}
          >
            <span className="dot" style={{ background: STATUS[c.outcome].color }} />
            {c.label}
          </button>
        ))}
      </div>
      {pick && (
        <>
          {needsDate && (
            <label className="field">
              {pick === 'appointment' ? 'Appointment date & time' : 'Follow-up date & time'}
              <input id={`due-${item.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
            </label>
          )}
          <label className="field">
            Notes (optional)
            <input id={`note-${item.id}`} type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the team should know" />
          </label>
          {error && <div className="err">{error}</div>}
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : `Save · ${choice!.label}`}
            </button>
            <button className="btn" disabled={busy} onClick={() => setPick(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}

/** Set the date on an undated follow-up/appointment, or move it to a new one. */
export function DueEdit({ store, item, onDone }: { store: Store; item: Activity; onDone(msg: string): void }) {
  const [editing, setEditing] = useState(false)
  const [when, setWhen] = useState(() => toLocalInput(item.dueAt))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kind = item.outcome === 'appointment' ? 'appointment' : 'follow-up'

  async function save() {
    const due = fromLocalInput(when)
    if (!due) {
      setError(`Pick a date and time for the ${kind}.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await store.setDue(item.id, due)
      setEditing(false)
      onDone(item.dueAt ? 'Date changed' : 'Date set')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <button className={`btn small${item.dueAt ? '' : ' route'}`} onClick={() => { setWhen(toLocalInput(item.dueAt)); setEditing(true) }}>
        <Icon name="calendar" /> {item.dueAt ? 'Change date' : 'Set date'}
      </button>
    )
  }
  return (
    <div className="section" style={{ gap: 8, flexBasis: '100%' }}>
      <label className="field">
        {item.outcome === 'appointment' ? 'Appointment date & time' : 'Follow-up date & time'}
        <input id={`set-due-${item.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      </label>
      {error && <div className="err">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save date'}</button>
        <button className="btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  )
}
