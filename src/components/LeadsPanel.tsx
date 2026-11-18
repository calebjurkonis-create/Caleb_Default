import { useEffect, useMemo, useState } from 'react'
import { memberName, type Snapshot } from '../data/store'
import { STATUS, STATUS_ORDER } from '../lib/dispositions'
import { shortName, timeAgo, turning65 } from '../lib/leads'
import { milesBetween, type Point } from '../lib/route'
import type { Lead, LeadStatus } from '../types'
import { Icon } from './Icon'

interface Props {
  snap: Snapshot
  leads: Lead[]
  me: Point | null
  onClose(): void
  onOpenLead(l: Lead): void
}

type Sort = 'near' | 'recent' | 'turning'
type Kind = 'all' | 'nho' | 'own' | 'nopin'

const PAGE = 30
const SORT_LABEL: Record<Sort, string> = { near: 'nearest first', recent: 'recent activity first', turning: 'turning 65 soonest' }

/** Leads tab: compact rows, every filter behind one Filters button, 30 rows at a time. */
export function LeadsPanel({ snap, leads, me, onClose, onOpenLead }: Props) {
  const isManager = snap.me?.role === 'manager'
  const defaultSort: Sort = me ? 'near' : 'recent'
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<LeadStatus | 'all'>('all')
  const [kind, setKind] = useState<Kind>('all')
  const [who, setWho] = useState<string>('any') // managers: 'any' | 'pool' | member id
  const [sort, setSort] = useState<Sort>(defaultSort)
  const [shown, setShown] = useState(PAGE)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const matches = (l: Lead, s: LeadStatus | 'all', k: Kind, w: string) =>
    (s === 'all' || l.status === s) &&
    (k === 'all' || (k === 'nopin' ? l.lat == null : k === 'nho' ? l.leadType === 'nho' : l.leadType === 'personal')) &&
    (w === 'any' || (w === 'pool' ? l.assignedTo == null : l.assignedTo === w))

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = leads.filter(
      (l) => matches(l, status, kind, who) && (!needle || `${l.firstName} ${l.lastName} ${l.address} ${l.city} ${l.zip}`.toLowerCase().includes(needle)),
    )
    const dist = (l: Lead) => (me && l.lat != null ? milesBetween(me, { lat: l.lat, lng: l.lng! }) : Infinity)
    if (sort === 'near') r = [...r].sort((a, b) => dist(a) - dist(b))
    else if (sort === 'recent') r = [...r].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
    else r = [...r].sort((a, b) => (turning65(a.dob)?.monthsAway ?? 99) - (turning65(b.dob)?.monthsAway ?? 99))
    return { all: r, dist }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, q, status, kind, who, sort, me])

  // A new search or filter starts back at the top 30.
  useEffect(() => setShown(PAGE), [q, status, kind, who, sort])

  const notWorked = useMemo(() => leads.filter((l) => l.status === 'new').length, [leads])
  const counts = useMemo(() => {
    const c: Partial<Record<LeadStatus, number>> = {}
    for (const l of leads) if (matches(l, 'all', kind, who)) c[l.status] = (c[l.status] ?? 0) + 1
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, kind, who])
  const kinds = useMemo(
    () => ({
      nho: leads.filter((l) => l.leadType === 'nho').length,
      own: leads.filter((l) => l.leadType === 'personal').length,
      nopin: leads.filter((l) => l.lat == null).length,
    }),
    [leads],
  )
  const active = (status !== 'all' ? 1 : 0) + (kind !== 'all' ? 1 : 0) + (who !== 'any' ? 1 : 0) + (sort !== defaultSort ? 1 : 0)
  const summary = [
    status !== 'all' ? STATUS[status].label : kind === 'all' && who === 'any' ? 'All statuses' : '',
    kind === 'nho' ? 'New homeowners' : kind === 'own' ? 'Own leads' : kind === 'nopin' ? 'No pin' : '',
    who === 'pool' ? 'Shared pool' : who !== 'any' ? `Assigned to ${memberName(snap, who)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const clear = () => {
    setStatus('all')
    setKind('all')
    setWho('any')
    setSort(defaultSort)
  }

  const list = rows.all.slice(0, shown)
  const right = (l: Lead) => {
    const d = rows.dist(l)
    if (sort === 'recent' && l.lastActivityAt) return `${memberName(snap, l.lastActivityBy)} · ${timeAgo(l.lastActivityAt)}`
    if (sort === 'turning') return turning65(l.dob)?.label.replace(/ · .*/, '') ?? ''
    if (Number.isFinite(d)) return `${d.toFixed(1)} mi`
    return l.lastActivityAt ? timeAgo(l.lastActivityAt) : ''
  }

  return (
    <section className="sheet full" aria-label="Leads">
      <header className="sheet-head">
        <div className="grow">
          <h2>Leads</h2>
          <div className="muted num" style={{ marginTop: 4 }}>
            {leads.length.toLocaleString()} leads · {notWorked.toLocaleString()} not worked
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body" style={{ gap: 8 }}>
        <div className="search-row">
          <input id="lead-search" type="search" placeholder="Search name, street, city or ZIP" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn filter-btn" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
            Filters {active > 0 && <span className="count-badge num">{active}</span>}
          </button>
        </div>
        <div className="filter-line">
          <span className="num">
            {summary} · {SORT_LABEL[sort]} · {rows.all.length.toLocaleString()}
          </span>
          {active > 0 && (
            <button className="link-btn" onClick={clear}>
              Clear
            </button>
          )}
        </div>
        <ul className="list compact">
          {list.map((l) => (
            <li key={l.id}>
              <button className="lead-row" onClick={() => onOpenLead(l)}>
                <span className="dot" style={{ background: STATUS[l.status].color }} />
                <div>
                  <div className="name">{shortName(l)}</div>
                  <div className="sub">
                    {l.address}, {l.city}
                  </div>
                </div>
                <div className="right num">{right(l)}</div>
              </button>
            </li>
          ))}
        </ul>
        {rows.all.length > shown && (
          <button className="link-btn more-btn" onClick={() => setShown(shown + PAGE)}>
            Show {Math.min(PAGE, rows.all.length - shown)} more
          </button>
        )}
        {rows.all.length === 0 && <div className="empty">No leads match.</div>}
      </div>

      {filtersOpen && (
        <div className="filter-scrim" onClick={() => setFiltersOpen(false)}>
          <div className="filter-sheet" role="dialog" aria-label="Filters" onClick={(e) => e.stopPropagation()}>
            <div className="filter-head">
              <h3>Filters</h3>
              <button className="btn small" onClick={() => setFiltersOpen(false)}>
                Done
              </button>
            </div>
            <div className="filter-label">Status</div>
            <div className="wrap-chips">
              <button className="chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
                All
              </button>
              {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
                  <span className="dot" style={{ background: STATUS[s].color }} />
                  {STATUS[s].label} <span className="num muted">{counts[s]}</span>
                </button>
              ))}
            </div>
            <div className="filter-label">Sort</div>
            <div className="wrap-chips">
              <button className="chip" aria-pressed={sort === 'near'} disabled={!me} onClick={() => setSort('near')} title={me ? '' : 'Turn on location to sort by distance'}>
                Nearest
              </button>
              <button className="chip" aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>
                Recent activity
              </button>
              <button className="chip" aria-pressed={sort === 'turning'} onClick={() => setSort('turning')}>
                Turning 65 soonest
              </button>
            </div>
            {(kinds.nho > 0 || kinds.own > 0 || kinds.nopin > 0) && (
              <>
                <div className="filter-label">Kind</div>
                <div className="wrap-chips">
                  <button className="chip" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
                    Every lead
                  </button>
                  {kinds.nho > 0 && (
                    <button className="chip" aria-pressed={kind === 'nho'} onClick={() => setKind('nho')}>
                      <span className="dot nho-dot" /> New homeowners <span className="num muted">{kinds.nho}</span>
                    </button>
                  )}
                  {kinds.own > 0 && (
                    <button className="chip" aria-pressed={kind === 'own'} onClick={() => setKind('own')}>
                      <span className="dot own-dot" /> Own leads <span className="num muted">{kinds.own}</span>
                    </button>
                  )}
                  {kinds.nopin > 0 && (
                    <button className="chip" aria-pressed={kind === 'nopin'} onClick={() => setKind('nopin')}>
                      No pin <span className="num muted">{kinds.nopin}</span>
                    </button>
                  )}
                </div>
              </>
            )}
            {isManager && (
              <label className="field">
                Assigned to
                <select id="leads-assigned" value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="any">Anyone</option>
                  <option value="pool">Shared pool</option>
                  {snap.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn primary block" onClick={() => setFiltersOpen(false)}>
              Show {rows.all.length.toLocaleString()} lead{rows.all.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
