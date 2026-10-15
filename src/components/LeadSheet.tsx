import { useEffect, useState } from 'react'
import { memberName, type Snapshot, type Store } from '../data/store'
import { OUTCOMES, STATUS } from '../lib/dispositions'
import { activeClaim, cityLine, clockTime, formatPhone, fullName, timeAgo, turning65 } from '../lib/leads'
import { navUrl, type NavApp } from '../lib/route'
import type { Activity, Lead, Outcome } from '../types'
import { Icon } from './Icon'

interface Props {
  store: Store
  snap: Snapshot
  lead: Lead
  onRoute: boolean
  navApp: NavApp
  onClose(): void
  onToggleRoute(): void
  onSaved(lead: Lead, outcome: Outcome): void
}

export function LeadSheet({ store, snap, lead, onRoute, navApp, onClose, onToggleRoute, onSaved }: Props) {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Activity[] | null>(null)
  const [copied, setCopied] = useState(false)

  // Fresh form for each lead; reload history whenever the team logs something on it.
  useEffect(() => {
    setOutcome(null)
    setNotes('')
    setError(null)
  }, [lead.id])
  useEffect(() => {
    let live = true
    store.history(lead.id).then((h) => live && setHistory(h)).catch(() => live && setHistory([]))
    return () => {
      live = false
    }
  }, [store, lead.id, lead.attempts])

  const age = turning65(lead.dob)
  const claim = activeClaim(lead)
  const isManager = snap.me?.role === 'manager'
  const hasPoint = lead.lat != null && lead.lng != null

  const noteMissing = !notes.trim()

  async function save() {
    if (!outcome || noteMissing) return
    setSaving(true)
    setError(null)
    try {
      await store.logActivity(lead.id, outcome, notes.trim())
      onSaved(lead, outcome)
      setOutcome(null)
      setNotes('')
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
          {lead.attempts > 0 && <span className="tag">{lead.attempts} attempt{lead.attempts === 1 ? '' : 's'}</span>}
          {!hasPoint && <span className="tag warn">Address not found on map</span>}
        </div>

        <div className="row">
          {hasPoint && (
            <a className="btn primary" href={navUrl(navApp, { lat: lead.lat!, lng: lead.lng! })} target="_blank" rel="noreferrer">
              <Icon name="nav" /> Navigate
            </a>
          )}
          {hasPoint && (
            <button className={`btn ${onRoute ? '' : 'route'}`} onClick={onToggleRoute}>
              <Icon name={onRoute ? 'minus' : 'plus'} /> {onRoute ? 'Remove from route' : 'Add to route'}
            </button>
          )}
        </div>

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
          <label className="field">
            Notes (required)
            <textarea
              id={`notes-${lead.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened? Best time to come back?"
              required
            />
          </label>
          {error && <div className="err">{error}</div>}
          <button className="btn primary block" disabled={!outcome || noteMissing || saving} onClick={save}>
            {saving
              ? 'Saving…'
              : !outcome
                ? 'Pick a disposition'
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

        <div className="section">
          <h3 style={{ fontSize: 20 }}>History</h3>
          {history === null ? (
            <div className="muted">Loading…</div>
          ) : history.length === 0 ? (
            <div className="muted">Nobody has worked this lead yet.</div>
          ) : (
            <ol className="timeline">
              {history.map((a) => (
                <li key={a.id}>
                  <span className="dot" style={{ background: STATUS[a.outcome].color }} />
                  <div>
                    <div>
                      <span className="who">{memberName(snap, a.memberId)}</span>{' '}
                      <span className="muted">
                        · {a.channel === 'phone' ? 'Phone call' : 'Door knock'} · {STATUS[a.outcome].label}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {new Date(a.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                      {clockTime(a.createdAt)}
                    </div>
                    {a.notes && <div className="note">“{a.notes}”</div>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
