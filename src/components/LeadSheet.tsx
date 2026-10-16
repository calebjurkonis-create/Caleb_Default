import { useEffect, useState } from 'react'
import { memberName, type Snapshot, type Store } from '../data/store'
import { DATED, OUTCOMES, STATUS } from '../lib/dispositions'
import { currentItems, dueLabel, fromLocalInput } from '../lib/agenda'
import { DueEdit, ItemUpdate } from './ItemUpdate'
import { activeClaim, cityLine, clockTime, formatPhone, fullName, houseNumberOf, navTarget, timeAgo, turning65 } from '../lib/leads'
import { navUrl, type NavApp } from '../lib/route'
import type { Activity, Lead, Outcome } from '../types'
import { Icon } from './Icon'
import { geocodeAll, geocodeFallback, spreadStreetPin } from '../lib/geocode'

interface Props {
  store: Store
  snap: Snapshot
  lead: Lead
  onRoute: boolean
  navApp: NavApp
  onClose(): void
  onToggleRoute(): void
  onSaved(lead: Lead, outcome: Outcome): void
  /** Managers: pick the house on the map by tapping it. */
  onPlacePin(): void
}

export function LeadSheet({ store, snap, lead, onRoute, navApp, onClose, onToggleRoute, onSaved, onPlacePin }: Props) {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [notes, setNotes] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Activity[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [releaseMsg, setReleaseMsg] = useState<string | null>(null)

  // Fresh form for each lead; reload history whenever the team logs something on it.
  useEffect(() => {
    setOutcome(null)
    setNotes('')
    setDue('')
    setError(null)
  }, [lead.id])
  useEffect(() => {
    let live = true
    store.history(lead.id).then((h) => live && setHistory(h)).catch(() => live && setHistory([]))
    return () => {
      live = false
    }
  }, [store, lead.id, lead.attempts, lead.status, lead.lastActivityAt, snap.itemsVersion])

  const age = turning65(lead.dob)
  const claim = activeClaim(lead)
  const isManager = snap.me?.role === 'manager'
  const hasPoint = lead.lat != null && lead.lng != null

  // Every disposition needs a note except No Answer/Not Home.
  const noteRequired = outcome !== 'no_answer'
  const noteMissing = noteRequired && !notes.trim()
  // Appointments and follow-ups get a date (once the database supports it).
  const needsDate = snap.agendaReady && !!outcome && DATED.includes(outcome)
  const dateMissing = needsDate && !fromLocalInput(due)

  async function save() {
    if (!outcome || noteMissing || dateMissing) return
    setSaving(true)
    setError(null)
    try {
      await store.logActivity(lead.id, outcome, notes.trim(), needsDate ? fromLocalInput(due) : null)
      onSaved(lead, outcome)
      setOutcome(null)
      setNotes('')
      setDue('')
    } catch (e) {
      setError(`Couldn't save: ${(e as Error).message}. Check your signal and tap Submit again.`)
    } finally {
      setSaving(false)
    }
  }

  async function copyPhone() {
    try {
      await navigator.clipboard.writeText(lead.phone)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* number stays selectable */
    }
  }

  return (
    <section className="sheet" aria-label={`Lead: ${fullName(lead)}`}>
      <div className="grabber" />
      <header className="sheet-head">
        <div className="grow">
          <h2>{fullName(lead)}</h2>
          <div className="row" style={{ marginTop: 6, gap: 8 }}>
            <span className="status">
              <span className="dot" style={{ background: STATUS[lead.status].color }} />
              {STATUS[lead.status].label}
            </span>
            {lead.lastActivityAt && (
              <span className="muted" style={{ fontSize: 13 }}>
                {memberName(snap, lead.lastActivityBy)} · {timeAgo(lead.lastActivityAt)}
              </span>
            )}
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>

      <div className="sheet-body">
        <div className="facts">
          <div className="addr">{lead.address}</div>
          <div className="muted">
            {cityLine(lead)}
            {lead.county && ` · ${lead.county} County`}
          </div>
          {lead.phone && (
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <span className="phone num">
                <Icon name="phone" />
                <a href={`tel:${lead.phone.replace(/\D/g, '')}`}>{formatPhone(lead.phone)}</a>
              </span>
              <button className="btn small" onClick={copyPhone}>
                <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>

        <div className="tags">
          {age && <span className={`tag${age.monthsAway <= 2 ? ' warn' : ''}`}>{age.label}</span>}
          <span className="tag">{lead.assignedTo ? `Assigned to ${memberName(snap, lead.assignedTo)}` : 'Shared pool'}</span>
          {claim && <span className="tag warn">{claim === snap.me?.id ? 'On your route today' : `On ${memberName(snap, claim)}'s route today`}</span>}
          {claim && claim !== snap.me?.id && isManager && (
            <button
              className="btn small"
              disabled={releasing}
              onClick={async () => {
                setReleasing(true)
                setReleaseMsg(null)
                try {
                  await store.claim([lead.id], false)
                  setReleaseMsg('Released. Anyone can route this door now.')
                } catch (e) {
                  setReleaseMsg(`Couldn't release: ${(e as Error).message}. Check your signal and try again.`)
                } finally {
                  setReleasing(false)
                }
              }}
            >
              {releasing ? 'Releasing…' : 'Release'}
            </button>
          )}
          {lead.attempts > 0 && <span className="tag">{lead.attempts} attempt{lead.attempts === 1 ? '' : 's'}</span>}
          {!hasPoint && <span className="tag warn">Address not found on map</span>}
          {hasPoint && lead.pinApprox && (
            <span className="tag warn">Pin is on the street · look for house #{houseNumberOf(lead) || '?'}</span>
          )}
        </div>

        {releaseMsg && <div className="muted" style={{ fontSize: 14 }}>{releaseMsg}</div>}

        <div className="row">
          {hasPoint && (
            <a className="btn primary" href={navUrl(navApp, navTarget(lead))} target="_blank" rel="noreferrer">
              <Icon name="nav" /> Navigate
            </a>
          )}
          {hasPoint && (
            <button className={`btn ${onRoute ? '' : 'route'}`} onClick={onToggleRoute}>
              <Icon name={onRoute ? 'minus' : 'plus'} /> {onRoute ? 'Remove from route' : 'Add to route'}
            </button>
          )}
        </div>

        <OpenItem store={store} snap={snap} lead={lead} history={history} />

        <div className="section">
          <h3 style={{ fontSize: 20 }}>Door knock disposition</h3>
          <div className="outcomes" role="group" aria-label="Next disposition">
            {OUTCOMES.map((o) => (
              <button key={o} className="outcome" aria-pressed={outcome === o} onClick={() => setOutcome(o)}>
                <span className="dot" style={{ background: STATUS[o].color }} />
                {STATUS[o].label}
              </button>
            ))}
          </div>
          {needsDate && (
            <label className="field">
              {outcome === 'appointment' ? 'Appointment date & time' : 'Follow-up date & time'}
              <input id={`due-${lead.id}`} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required />
            </label>
          )}
          <label className="field">
            {outcome === 'no_answer' ? 'Notes (optional)' : 'Notes (required)'}
            <textarea
              id={`notes-${lead.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened? Best time to come back?"
              required={noteRequired}
            />
          </label>
          {error && <div className="err">{error}</div>}
          <button className="btn primary block" disabled={!outcome || noteMissing || dateMissing || saving} onClick={save}>
            {saving
              ? 'Saving…'
              : !outcome
                ? 'Pick a disposition'
                : dateMissing
                  ? `Pick the ${outcome === 'appointment' ? 'appointment' : 'follow-up'} date`
                  : noteMissing
                    ? 'Add a note to submit'
                    : `Submit · ${STATUS[outcome].label}`}
          </button>
        </div>

        {isManager && (
          <label className="field">
            Who works this lead
            <select
              id={`assign-${lead.id}`}
              value={lead.assignedTo ?? ''}
              onChange={(e) => store.assign([lead.id], e.target.value || null)}
            >
              <option value="">Shared pool (everyone)</option>
              {snap.members.map((m) => (
                <option key={m.id} value={m.id}>
                  Only {m.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {isManager && <PinTools store={store} lead={lead} onPlacePin={onPlacePin} />}

        <div className="section">
          <h3 style={{ fontSize: 20 }}>History</h3>
          <HistoryList snap={snap} history={history} />
        </div>
      </div>
    </section>
  )
}

/** Fix a lead that has no pin (or a pin in the wrong spot). */
function PinTools({ store, lead, onPlacePin }: { store: Store; lead: Lead; onPlacePin(): void }) {
  const hasPin = lead.lat != null && lead.lng != null
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState(lead.address)
  const [city, setCity] = useState(lead.city)
  const [zip, setZip] = useState(lead.zip)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setEditing(false)
    setAddress(lead.address)
    setCity(lead.city)
    setZip(lead.zip)
    setMsg(null)
  }, [lead.id, lead.address, lead.city, lead.zip])

  async function lookUp(fix: { address: string; city: string; zip: string }) {
    setBusy(true)
    setMsg('Looking it up…')
    try {
      const input = [{ id: lead.id, street: fix.address, city: fix.city, state: lead.state, zip: fix.zip }]
      let [hit] = await geocodeAll(input, () => {})
      if (hit?.lat == null) [hit] = await geocodeFallback(input)
      const changed = fix.address !== lead.address || fix.city !== lead.city || fix.zip !== lead.zip
      if (hit?.lat != null && hit.lng != null) {
        const pos = hit.approx ? spreadStreetPin(lead.id, hit.lat, hit.lng) : { lat: hit.lat, lng: hit.lng }
        await store.updateLeads([{ id: lead.id, ...fix, ...pos, pinApprox: !!hit.approx }])
        setMsg(
          hit.approx
            ? "The house isn't on the map services yet, so the pin is on its street. Use “Move pin” to put it on the exact house."
            : 'Found it. The pin is on the map.',
        )
        setEditing(false)
      } else {
        if (changed) await store.updateLeads([{ id: lead.id, ...fix }])
        setMsg(`Still not found${changed ? ' (address saved)' : ''}. Check the spelling, or tap “Place pin on the map” and tap the house.`)
      }
    } catch (e) {
      setMsg(`Couldn't look it up: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section">
      <h3 style={{ fontSize: 20 }}>Map pin</h3>
      {!hasPin && <div className="notice">This address wasn't found, so the lead isn't on the map yet.</div>}
      {editing ? (
        <form
          className="section"
          onSubmit={(e) => {
            e.preventDefault()
            lookUp({ address: address.trim(), city: city.trim(), zip: zip.trim() })
          }}
        >
          <label className="field">
            Street address
            <input id={`fix-address-${lead.id}`} type="text" value={address} onChange={(e) => setAddress(e.target.value)} required />
          </label>
          <div className="row" style={{ alignItems: 'end' }}>
            <label className="field" style={{ flex: '2 1 160px' }}>
              City
              <input id={`fix-city-${lead.id}`} type="text" value={city} onChange={(e) => setCity(e.target.value)} required />
            </label>
            <label className="field" style={{ flex: '1 1 90px' }}>
              ZIP
              <input id={`fix-zip-${lead.id}`} inputMode="numeric" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy}>Save and find on map</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="row">
          {!hasPin && (
            <button className="btn" disabled={busy} onClick={() => lookUp({ address: lead.address, city: lead.city, zip: lead.zip })}>
              Look up again
            </button>
          )}
          <button className="btn" onClick={() => setEditing(true)}>Fix address</button>
          <button className="btn" onClick={onPlacePin}>{hasPin ? 'Move pin' : 'Place pin on the map'}</button>
        </div>
      )}
      {msg && <div className="muted">{msg}</div>}
    </div>
  )
}

/** The lead's open follow-up or appointment, with its status buttons (its agent and managers only). */
function OpenItem({ store, snap, lead, history }: { store: Store; snap: Snapshot; lead: Lead; history: Activity[] | null }) {
  const [msg, setMsg] = useState<string | null>(null)
  const item = history ? currentItems(history, new Map([[lead.id, lead]]))[0] : undefined
  const isManager = snap.me?.role === 'manager'
  if (!item) return msg ? <div className="notice">{msg}</div> : null
  if (item.memberId !== snap.me?.id && !isManager) return null
  return (
    <div className="card" style={{ borderColor: STATUS[item.outcome].color }}>
      <div>
        <span className="eyebrow">Open {item.outcome === 'appointment' ? 'appointment' : 'follow-up'}</span>
        <div style={{ fontWeight: 600, fontSize: 18 }}>{item.dueAt ? dueLabel(item.dueAt) : 'No date yet'}</div>
        <div className="muted" style={{ fontSize: 14 }}>
          Set by {memberName(snap, item.memberId)}
          {item.notes && ` · “${item.notes}”`}
        </div>
      </div>
      {msg && <div className="notice">{msg}</div>}
      {snap.canSetDates && (
        <div className="row">
          <DueEdit store={store} item={item} onDone={(m) => setMsg(m)} />
        </div>
      )}
      {snap.agendaReady && <ItemUpdate store={store} item={item} onDone={(m) => setMsg(m)} />}
    </div>
  )
}

/** Every visit and status update on a lead, newest first. */
export function HistoryList({ snap, history, limit }: { snap: Snapshot; history: Activity[] | null; limit?: number }) {
  if (history === null) return <div className="muted">Loading…</div>
  if (history.length === 0) return <div className="muted">Nobody has worked this lead yet.</div>
  const isManager = snap.me?.role === 'manager'
  const shown = limit ? history.slice(0, limit) : history
  return (
    <>
      <ol className="timeline">
        {shown.map((a) => (
          <li key={a.id}>
            <span className="dot" style={{ background: STATUS[a.outcome].color }} />
            <div>
              <div>
                <span className="who">{memberName(snap, a.memberId)}</span>{' '}
                <span className="muted">
                  · {a.channel === 'update' ? 'Status update' : a.channel === 'phone' ? 'Phone call' : 'Door knock'} · {STATUS[a.outcome].label}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {new Date(a.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                {clockTime(a.createdAt)}
                {a.dueAt && (a.memberId === snap.me?.id || isManager) && (
                  <> · {a.outcome === 'appointment' ? 'Appt' : 'Due'} {dueLabel(a.dueAt)}{a.resolution ? ` → ${STATUS[a.resolution].label}` : ''}</>
                )}
              </div>
              {a.notes && <div className="note">“{a.notes}”</div>}
            </div>
          </li>
        ))}
      </ol>
      {limit && history.length > limit && <div className="muted" style={{ fontSize: 13 }}>{history.length - limit} older…</div>}
    </>
  )
}
