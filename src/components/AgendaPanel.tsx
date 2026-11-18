import { useMemo, useState } from 'react'
import { memberName, type Snapshot, type Store } from '../data/store'
import { STATUS } from '../lib/dispositions'
import { bucketOf, type Bucket } from '../lib/agenda'
import { fullName, navTarget } from '../lib/leads'
import { navUrl, type NavApp } from '../lib/route'
import type { Activity, Lead } from '../types'
import { Icon } from './Icon'
import { DueEdit, ItemUpdate } from './ItemUpdate'

interface Props {
  store: Store
  snap: Snapshot
  /** Open follow-ups and appointments this person may see (already filtered). */
  items: Activity[] | null
  error: string | null
  navApp: NavApp
  onClose(): void
  onOpenLead(l: Lead): void
  onUpdated(msg: string): void
}

type Kind = 'all' | 'appointment' | 'follow_up'

/** Managers see this many of today's items before "+ N more today". */
const TODAY_PREVIEW = 3

const initials = (name: string) => name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '?'

/** The time chip on each row: "3:00 PM" today, "Mon 5 PM" this week, "Dec 3" further out. */
function chipLabel(iso: string, bucket: Bucket): string {
  const d = new Date(iso)
  const hm = d.getMinutes() ? { hour: 'numeric', minute: '2-digit' } as const : { hour: 'numeric' } as const
  if (bucket === 'today') return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (bucket === 'later') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, hm)}`
}

/** Appointments and follow-ups, one line each: agents see their own, managers see everyone's with initials. */
export function AgendaPanel({ store, snap, items, error, navApp, onClose, onOpenLead, onUpdated }: Props) {
  const isManager = snap.me?.role === 'manager'
  const [who, setWho] = useState<string>('all')
  const [kind, setKind] = useState<Kind>('all')
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [allToday, setAllToday] = useState(false)
  const leadById = useMemo(() => new Map(snap.leads.map((l) => [l.id, l])), [snap.leads])

  const shown = useMemo(
    () =>
      (items ?? [])
        .filter((i) => (kind === 'all' || i.outcome === kind) && (!isManager || who === 'all' || i.memberId === who) && leadById.has(i.leadId))
        .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    [items, kind, who, isManager, leadById],
  )
  const by = (keys: Bucket[]) => shown.filter((i) => keys.includes(bucketOf(i.dueAt)))
  const overdue = by(['overdue'])
  const today = by(['today'])
  const week = by(['tomorrow', 'week'])
  const later = by(['later'])
  const undated = by(['undated'])
  const people = useMemo(() => [...new Set((items ?? []).map((i) => i.memberId))], [items])
  const toggleGroup = (k: string) =>
    setOpenGroups((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const row = (i: Activity) => {
    const lead = leadById.get(i.leadId)!
    const b = bucketOf(i.dueAt)
    const open = openRow === i.id
    const note = i.notes ? `“${i.notes}”` : `${i.outcome === 'appointment' ? 'Appointment' : 'Follow-up'} · ${lead.address}`
    return (
      <li key={i.id} className={`ag-row${open ? ' open' : ''}`}>
        <button className="ag-main" onClick={() => setOpenRow(open ? null : i.id)} aria-expanded={open}>
          <span className="dot" style={{ background: STATUS[i.outcome].color }} />
          <span className="ag-name">
            {isManager && <span className="who-badge" title={memberName(snap, i.memberId)}>{initials(memberName(snap, i.memberId))}</span>}
            {fullName(lead)}
          </span>
          <span className={`ag-when${b === 'overdue' ? ' late' : ''}`}>{i.dueAt ? chipLabel(i.dueAt, b) : 'No date'}</span>
          <span className="ag-note">{note}</span>
        </button>
        {open && (
          <div className="ag-actions">
            <div className="row">
              {snap.canSetDates && <DueEdit store={store} item={i} onDone={onUpdated} />}
              {snap.agendaReady && <ItemUpdateButton store={store} item={i} onUpdated={(m) => { setOpenRow(null); onUpdated(m) }} />}
              {!isManager && (
                <a className="btn small" href={navUrl(navApp, navTarget(lead))} target="_blank" rel="noreferrer">
                  <Icon name="nav" /> Navigate
                </a>
              )}
            </div>
            <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => onOpenLead(lead)}>
              Open lead card
            </button>
          </div>
        )}
      </li>
    )
  }

  const section = (key: string, label: string, list: Activity[], red = false, limit?: number) =>
    list.length > 0 && (
      <div key={key} className="ag-section">
        <div className={`ag-head${red ? ' red' : ''}`}>
          <span>{label}</span>
          <span className="num">{list.length}</span>
        </div>
        <ul className="list">{(limit ? list.slice(0, limit) : list).map(row)}</ul>
        {limit && list.length > limit && (
          <button className="link-btn more-btn" onClick={() => setAllToday(true)}>
            + {list.length - limit} more today
          </button>
        )}
      </div>
    )

  const group = (key: string, title: string, sub: string, list: Activity[]) =>
    list.length > 0 && (
      <div key={key} className={`fold${openGroups.has(key) ? ' open' : ''}`}>
        <button className="fold-head" onClick={() => toggleGroup(key)} aria-expanded={openGroups.has(key)}>
          <b>
            {title} · <span className="num">{list.length}</span>
          </b>
          <span className="fold-chev" aria-hidden="true">›</span>
          <small>{sub}</small>
        </button>
        {openGroups.has(key) && <ul className="list fold-body">{list.map(row)}</ul>}
      </div>
    )

  const countBy = (list: Activity[], keyOf: (i: Activity) => string) => {
    const c = new Map<string, number>()
    for (const i of list) c.set(keyOf(i), (c.get(keyOf(i)) ?? 0) + 1)
    return [...c].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')
  }
  const dayName = (i: Activity) =>
    bucketOf(i.dueAt) === 'tomorrow' ? 'Tomorrow' : new Date(i.dueAt!).toLocaleDateString(undefined, { weekday: 'short' })
  const nothing = !overdue.length && !today.length && !week.length && !later.length && !undated.length

  return (
    <section className="sheet full" aria-label="Agenda">
      <header className="sheet-head">
        <div className="grow">
          <h2>Agenda</h2>
          <div className="muted num" style={{ marginTop: 4 }}>
            {isManager ? `${who === 'all' ? 'Everyone' : memberName(snap, who)} · ${shown.length} open` : 'Your appointments and follow-ups'}
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body" style={{ gap: 10 }}>
        {!snap.canSetDates && (
          <div className="notice">
            {isManager
              ? 'Setting dates and updating statuses turns on after the one-time database update (004). Until then, everything shows as Undated.'
              : 'Setting dates and updating statuses turns on soon (your manager is running a quick update).'}
          </div>
        )}
        {isManager ? (
          <div className="pick-row">
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
            <select id="agenda-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Type">
              <option value="all">All types</option>
              <option value="appointment">Appointments</option>
              <option value="follow_up">Follow-ups</option>
            </select>
          </div>
        ) : (
          <div className="seg" style={{ gridTemplateColumns: '1fr 1fr 1fr' }} role="group" aria-label="Type">
            <button aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All</button>
            <button aria-pressed={kind === 'appointment'} onClick={() => setKind('appointment')}>Appts</button>
            <button aria-pressed={kind === 'follow_up'} onClick={() => setKind('follow_up')}>Follow-ups</button>
          </div>
        )}
        {error && <div className="err">Couldn't load the agenda: {error}</div>}
        {items === null && !error ? (
          <div className="muted">Loading…</div>
        ) : nothing ? (
          <div className="empty">
            <h3>Nothing open</h3>
            <div>Appointments and follow-ups show up here until they're updated to Sold, Booked or Not Interested.</div>
          </div>
        ) : (
          <>
            {section('overdue', 'Overdue', overdue, true)}
            {section('today', 'Today', today, false, isManager && !allToday ? TODAY_PREVIEW : undefined)}
            {isManager
              ? group('week', 'Later this week', countBy(week, dayName), week)
              : section('week', 'This week', week)}
            {group('later', 'Further out', countBy(later, (i) => new Date(i.dueAt!).toLocaleDateString(undefined, { month: 'short' })), later)}
            {group(
              'undated',
              'No date yet',
              isManager ? countBy(undated, (i) => memberName(snap, i.memberId)) : 'Tap to set dates so they land on the right day',
              undated,
            )}
          </>
        )}
      </div>
    </section>
  )
}

/** "Update status" opens the full update form in place of the row's buttons. */
function ItemUpdateButton({ store, item, onUpdated }: { store: Store; item: Activity; onUpdated(msg: string): void }) {
  const [open, setOpen] = useState(false)
  if (open) return <div style={{ flexBasis: '100%' }}><ItemUpdate store={store} item={item} onDone={onUpdated} /></div>
  return (
    <button className="btn small" onClick={() => setOpen(true)}>
      Update status
    </button>
  )
}
