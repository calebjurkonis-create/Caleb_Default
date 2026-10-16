import { useMemo, useState } from 'react'
import { memberName, type Snapshot, type Store } from '../data/store'
import { STATUS } from '../lib/dispositions'
import { BUCKETS, bucketOf, dueLabel } from '../lib/agenda'
import { cityLine, fullName } from '../lib/leads'
import type { Activity, Lead } from '../types'
import { Icon } from './Icon'
import { ItemUpdate } from './ItemUpdate'

interface Props {
  store: Store
  snap: Snapshot
  /** Open follow-ups and appointments this person may see (already filtered). */
  items: Activity[] | null
  error: string | null
  onClose(): void
  onOpenLead(l: Lead): void
  onUpdated(msg: string): void
}

type Kind = 'all' | 'appointment' | 'follow_up'

/** Upcoming appointments and follow-ups: agents see their own, managers see everyone's. */
export function AgendaPanel({ store, snap, items, error, onClose, onOpenLead, onUpdated }: Props) {
  const isManager = snap.me?.role === 'manager'
  const [who, setWho] = useState<string>('all')
  const [kind, setKind] = useState<Kind>('all')
  const [openItem, setOpenItem] = useState<string | null>(null)
  const leadById = useMemo(() => new Map(snap.leads.map((l) => [l.id, l])), [snap.leads])

  const shown = useMemo(
    () =>
      (items ?? []).filter(
        (i) => (kind === 'all' || i.outcome === kind) && (!isManager || who === 'all' || i.memberId === who) && leadById.has(i.leadId),
      ),
    [items, kind, who, isManager, leadById],
  )
  const groups = BUCKETS.map((b) => ({ ...b, items: shown.filter((i) => bucketOf(i.dueAt!) === b.key) })).filter((g) => g.items.length)
  const people = useMemo(() => [...new Set((items ?? []).map((i) => i.memberId))], [items])

  return (
    <section className="sheet full" aria-label="Agenda">
      <header className="sheet-head">
        <div className="grow">
          <h2>Agenda</h2>
          <div className="muted" style={{ marginTop: 4 }}>
            {isManager ? 'Everyone’s open appointments and follow-ups' : 'Your open appointments and follow-ups'}
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body" style={{ gap: 12 }}>
        {!snap.agendaReady ? (
          <div className="notice">
            Dates for appointments and follow-ups turn on after a one-time database update (004). Everything else works as usual until then.
          </div>
        ) : (
          <>
            <div className="seg" style={{ gridTemplateColumns: '1fr 1fr 1fr' }} role="group" aria-label="Type">
              <button aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All</button>
              <button aria-pressed={kind === 'appointment'} onClick={() => setKind('appointment')}>Appts</button>
              <button aria-pressed={kind === 'follow_up'} onClick={() => setKind('follow_up')}>Follow-ups</button>
            </div>
            {isManager && (
              <select id="agenda-who" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose agenda">
                <option value="all">Everyone</option>
                {snap.me && <option value={snap.me.id}>Mine</option>}
                {people
                  .filter((id) => id !== snap.me?.id)
                  .map((id) => ({ id, name: memberName(snap, id) }))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
            )}
            {error && <div className="err">Couldn't load the agenda: {error}</div>}
            {items === null && !error ? (
              <div className="muted">Loading…</div>
            ) : groups.length === 0 ? (
              <div className="empty">
                <h3>Nothing open</h3>
                <div>When you log an Appointment or Follow-Up, pick its date and it shows up here until you update it.</div>
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.key} className="section" style={{ gap: 0 }}>
                  <div className="bucket-head">
                    <h3 style={{ fontSize: 20 }}>{g.label}</h3>
                    <span className="muted num">{g.items.length}</span>
                  </div>
                  <ul className="list">
                    {g.items.map((i) => {
                      const lead = leadById.get(i.leadId)!
                      return (
                        <li key={i.id} className={`agenda-item${g.key === 'overdue' ? ' overdue' : ''}`}>
                          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                            <span className="when">{dueLabel(i.dueAt!)}</span>
                            <span className="status">
                              <span className="dot" style={{ background: STATUS[i.outcome].color }} />
                              {i.outcome === 'appointment' ? 'Appointment' : 'Follow-up'}
                            </span>
                          </div>
                          <div>
                            <button className="lead-link" onClick={() => onOpenLead(lead)}>{fullName(lead)}</button>
                            <div className="muted" style={{ fontSize: 14 }}>
                              {lead.address}, {cityLine(lead)}
                              {isManager && ` · ${i.memberId === snap.me?.id ? 'You' : memberName(snap, i.memberId)}`}
                            </div>
                            {i.notes && <div style={{ fontSize: 14 }}>“{i.notes}”</div>}
                          </div>
                          {openItem === i.id ? (
                            <ItemUpdate store={store} item={i} onDone={(m) => { setOpenItem(null); onUpdated(m) }} />
                          ) : (
                            <div className="row">
                              <button className="btn small" onClick={() => setOpenItem(i.id)}>Update status</button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </section>
  )
}
