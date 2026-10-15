import { useMemo, useState } from 'react'
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

export function LeadsPanel({ snap, leads, me, onClose, onOpenLead }: Props) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<LeadStatus | 'all' | 'nopin'>('all')
  const [sort, setSort] = useState<Sort>(me ? 'near' : 'recent')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = leads.filter(
      (l) =>
        (status === 'all' || (status === 'nopin' ? l.lat == null : l.status === status)) &&
        (!needle || `${l.firstName} ${l.lastName} ${l.address} ${l.city} ${l.zip}`.toLowerCase().includes(needle)),
    )
    const dist = (l: Lead) => (me && l.lat != null ? milesBetween(me, { lat: l.lat, lng: l.lng! }) : Infinity)
    if (sort === 'near') r = [...r].sort((a, b) => dist(a) - dist(b))
    else if (sort === 'recent') r = [...r].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
    else r = [...r].sort((a, b) => (turning65(a.dob)?.monthsAway ?? 99) - (turning65(b.dob)?.monthsAway ?? 99))
    return { list: r.slice(0, 200), total: r.length, dist }
  }, [leads, q, status, sort, me])

  const noPin = useMemo(() => leads.filter((l) => l.lat == null).length, [leads])
  const counts = useMemo(() => {
    const c: Partial<Record<LeadStatus, number>> = {}
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1
    return c
  }, [leads])

  return (
    <section className="sheet full" aria-label="Leads">
      <header className="sheet-head">
        <div className="grow">
          <h2>Leads</h2>
          <div className="muted num" style={{ marginTop: 4 }}>
            {rows.total} of {leads.length} shown
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body" style={{ gap: 12 }}>
        <input id="lead-search" type="search" placeholder="Search name, street, city or ZIP" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" style={{ position: 'static', padding: 0 }}>
          <button className="chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
            All
          </button>
          {noPin > 0 && (
            <button className="chip" aria-pressed={status === 'nopin'} onClick={() => setStatus('nopin')}>
              <span className="dot" style={{ background: 'transparent', border: '1.5px dashed var(--muted)' }} />
              No pin <span className="num muted">{noPin}</span>
            </button>
          )}
          {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
            <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              <span className="dot" style={{ background: STATUS[s].color }} />
              {STATUS[s].label} <span className="num muted">{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="seg" style={{ gridTemplateColumns: '1fr 1fr 1fr' }} role="group" aria-label="Sort">
          <button aria-pressed={sort === 'near'} onClick={() => setSort('near')} disabled={!me} title={me ? '' : 'Turn on location to sort by distance'}>
            Nearest
          </button>
          <button aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>
            Recent activity
          </button>
          <button aria-pressed={sort === 'turning'} onClick={() => setSort('turning')}>
            Turning 65
          </button>
        </div>
        <ul className="list">
          {rows.list.map((l) => {
            const d = rows.dist(l)
            return (
              <li key={l.id}>
                <button className="lead-row" onClick={() => onOpenLead(l)}>
                  <span className="dot" style={{ background: STATUS[l.status].color, width: 14, height: 14 }} />
                  <div>
                    <div className="name">{shortName(l)}</div>
                    <div className="sub">
                      {l.address}, {l.city}
                    </div>
                  </div>
                  <div className="right num">
                    {Number.isFinite(d) && <div>{d.toFixed(1)} mi</div>}
                    {l.lastActivityAt ? (
                      <div>
                        {memberName(snap, l.lastActivityBy)} · {timeAgo(l.lastActivityAt)}
                      </div>
                    ) : (
                      <div>{turning65(l.dob)?.label.replace(/ · .*/, '')}</div>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
        {rows.total > rows.list.length && <div className="muted">Showing the first 200. Search or filter to narrow it down.</div>}
        {rows.total === 0 && <div className="empty">No leads match.</div>}
      </div>
    </section>
  )
}
