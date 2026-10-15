import { useEffect, useMemo, useState } from 'react'
import { memberName, type Snapshot, type Store } from '../data/store'
import { STATUS } from '../lib/dispositions'
import { clockTime, isToday, shortName, timeAgo } from '../lib/leads'
import { agentRows, dispositionsCsv, fileStamp, leaderboardCsv, periodRange, PERIODS, saveFile, type AgentRow, type Period } from '../lib/reports'
import type { Activity, Lead } from '../types'
import { Icon } from './Icon'
import { geocodeAll, geocodeFallback } from '../lib/geocode'

interface Props {
  store: Store
  snap: Snapshot
  onClose(): void
  onOpenLead(l: Lead): void
  onImport(): void
}

type SortKey = 'appts' | 'doors' | 'followUps' | 'rate'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'doors', label: 'Doors' },
  { key: 'appts', label: 'Appts' },
  { key: 'followUps', label: 'F/U' },
  { key: 'rate', label: 'Appt %' },
]

export function TeamPanel({ store, snap, onClose, onOpenLead, onImport }: Props) {
  const isManager = snap.me?.role === 'manager'
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('today')
  const [sortKey, setSortKey] = useState<SortKey>('appts')
  const [fetched, setFetched] = useState<{ period: Period; acts: Activity[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [retry, setRetry] = useState<{ listId: string; text: string; busy: boolean } | null>(null)

  async function retryList(listId: string) {
    const missing = snap.leads.filter((l) => l.listId === listId && l.lat == null)
    if (!missing.length || retry?.busy) return
    const input = missing.map((l) => ({ id: l.id, street: l.address, city: l.city, state: l.state, zip: l.zip }))
    try {
      setRetry({ listId, busy: true, text: `Looking up ${missing.length} again…` })
      const first = await geocodeAll(input, () => {})
      const found = first.filter((r) => r.lat != null)
      const still = input.filter((i) => !found.some((f) => f.id === i.id))
      const second = await geocodeFallback(still, (d, t) => setRetry({ listId, busy: true, text: `Second try: ${d} of ${t}…` }))
      found.push(...second.filter((r) => r.lat != null))
      if (found.length) await store.updateLeads(found.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng })))
      const left = missing.length - found.length
      setRetry({
        listId,
        busy: false,
        text: `Found ${found.length} of ${missing.length}.` + (left ? ` ${left} still need a fix: Leads tab → “No pin”.` : ''),
      })
    } catch (e) {
      setRetry({ listId, busy: false, text: `Couldn't finish: ${(e as Error).message}` })
    }
  }
  const leadById = useMemo(() => new Map(snap.leads.map((l) => [l.id, l])), [snap.leads])
  const range = useMemo(() => periodRange(period), [period])

  // Today comes straight from the live feed; longer periods are fetched, and refreshed when someone logs a visit.
  const latestId = snap.activities[0]?.id
  useEffect(() => {
    if (period === 'today') return
    let live = true
    setLoadError(null)
    store
      .activitiesBetween(range.from, range.to)
      .then((acts) => live && setFetched({ period, acts }))
      .catch((e) => live && setLoadError((e as Error).message))
    return () => {
      live = false
    }
  }, [store, period, range, latestId])

  const acts = useMemo(() => {
    if (period === 'today') return snap.activities.filter((a) => isToday(a.createdAt))
    return fetched?.period === period ? fetched.acts : null
  }, [period, snap.activities, fetched])

  const rows = useMemo(() => {
    if (!acts) return []
    const r = agentRows(acts, snap.members)
    const val = (x: AgentRow) => x[sortKey]
    return r.sort((a, b) => val(b) - val(a) || b.appts - a.appts || b.doors - a.doors || a.name.localeCompare(b.name))
  }, [acts, snap.members, sortKey])

  const totals = rows.reduce((t, r) => ({ doors: t.doors + r.doors, appts: t.appts + r.appts, followUps: t.followUps + r.followUps }), { doors: 0, appts: 0, followUps: 0 })

  async function exportCsv(kind: 'board' | 'all') {
    if (!acts) return
    setExportMsg(null)
    const stamp = fileStamp(range.from, range.to)
    const ok =
      kind === 'board'
        ? await saveFile(`knockroute-leaderboard-${stamp}.csv`, leaderboardCsv(rows))
        : await saveFile(`knockroute-dispositions-${stamp}.csv`, dispositionsCsv(acts, snap.members, leadById, snap.lists))
    if (ok) setExportMsg('Spreadsheet ready. It opens in Excel, Numbers or Google Sheets.')
  }

  const listCounts = useMemo(() => {
    const c = new Map<string, { total: number; worked: number; assigned: number; noPin: number }>()
    for (const l of snap.leads) {
      const r = c.get(l.listId) ?? { total: 0, worked: 0, assigned: 0, noPin: 0 }
      r.total++
      if (l.lat == null) r.noPin++
      if (l.status !== 'new') r.worked++
      if (l.assignedTo) r.assigned++
      c.set(l.listId, r)
    }
    return c
  }, [snap.leads])

  return (
    <section className="sheet full" aria-label="Team">
      <header className="sheet-head">
        <div className="grow">
          <h2>Team</h2>
          <div className="muted" style={{ marginTop: 4 }}>{range.label}</div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body">
        <div className="chips" style={{ position: 'static', padding: 0 }} role="group" aria-label="Time period">
          {PERIODS.map((p) => (
            <button key={p.key} className="chip" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="stats">
          <div className="stat"><b>{acts ? totals.doors : '–'}</b><span>Doors knocked</span></div>
          <div className="stat"><b>{acts ? totals.appts : '–'}</b><span>Appointments</span></div>
          <div className="stat"><b>{acts ? totals.followUps : '–'}</b><span>Follow-ups</span></div>
        </div>

        <div className="section">
          <h3 style={{ fontSize: 20 }}>Leaderboard</h3>
          {loadError ? (
            <div className="err">Couldn't load this period: {loadError}</div>
          ) : !acts ? (
            <div className="muted">Loading…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="board">
                <thead>
                  <tr>
                    <th>Agent</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key}>
                        <button className={`sort${sortKey === c.key ? ' on' : ''}`} onClick={() => setSortKey(c.key)} aria-pressed={sortKey === c.key}>
                          {c.label}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={`${r.id === snap.me?.id ? 'me' : ''}${r.doors === 0 ? ' idle' : ''}`}>
                      <td><span className="rank">{r.doors ? i + 1 : ''}</span>{r.id === snap.me?.id ? 'You' : r.name}</td>
                      <td>{r.doors}</td>
                      <td>{r.appts}</td>
                      <td>{r.followUps}</td>
                      <td>{r.doors ? `${Math.round(r.rate * 100)}%` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="muted" style={{ fontSize: 13 }}>Tap a column to rank by it. F/U = follow-ups.</div>
          {isManager && acts && (
            <div className="row">
              <button className="btn small" onClick={() => exportCsv('board')} disabled={!acts.length}>
                <Icon name="download" /> Export leaderboard
              </button>
              <button className="btn small" onClick={() => exportCsv('all')} disabled={!acts.length}>
                <Icon name="download" /> Export every disposition
              </button>
            </div>
          )}
          {exportMsg && <div className="muted" style={{ fontSize: 14 }}>{exportMsg}</div>}
        </div>

        <div className="section">
          <h3 style={{ fontSize: 20 }}>Live activity</h3>
          {snap.activities.length === 0 ? (
            <div className="muted">Dispositions from the whole team show up here as they happen.</div>
          ) : (
            <ul className="feed">
              {snap.activities.slice(0, 40).map((a) => {
                const lead = leadById.get(a.leadId)
                return (
                  <li key={a.id}>
                    <span className="dot" style={{ background: STATUS[a.outcome].color }} />
                    <div>
                      <div>
                        <b>{memberName(snap, a.memberId)}</b> knocked{' '}
                        {lead ? (
                          <button className="link" onClick={() => onOpenLead(lead)}>{shortName(lead)}</button>
                        ) : (
                          'a lead'
                        )}{' '}
                        · {STATUS[a.outcome].label}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {isToday(a.createdAt) ? clockTime(a.createdAt) : timeAgo(a.createdAt)}
                        {lead && ` · ${lead.city}`}
                      </div>
                      {a.notes && <div style={{ fontSize: 14 }}>“{a.notes}”</div>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {isManager && (
          <div className="section">
            <h3 style={{ fontSize: 20 }}>Lead lists</h3>
            <button className="btn route block" onClick={onImport}>
              <Icon name="upload" /> Import a spreadsheet
            </button>
            {snap.lists.map((list) => {
              const c = listCounts.get(list.id) ?? { total: 0, worked: 0, assigned: 0, noPin: 0 }
              return (
                <div key={list.id} className="card">
                  <div style={{ fontWeight: 600 }}>{list.name}</div>
                  <div className="muted num" style={{ fontSize: 14 }}>
                    {c.total} leads · {c.worked} worked · {c.assigned} assigned to someone · added {timeAgo(list.createdAt)}
                  </div>
                  {c.noPin > 0 && (
                    <div className="row">
                      <button className="btn small" disabled={retry?.busy} onClick={() => retryList(list.id)}>
                        Find {c.noPin} without a pin
                      </button>
                    </div>
                  )}
                  {retry?.listId === list.id && <div className="muted" style={{ fontSize: 14 }}>{retry.text}</div>}
                  {confirmDelete === list.id ? (
                    <div className="row">
                      <button className="btn small danger" onClick={() => { store.deleteList(list.id); setConfirmDelete(null) }}>
                        Delete list and its history
                      </button>
                      <button className="btn small" onClick={() => setConfirmDelete(null)}>Keep it</button>
                    </div>
                  ) : (
                    <div className="row">
                      <button className="btn small" onClick={() => setConfirmDelete(list.id)}>Delete…</button>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="notice">
              To give leads to one agent: on the map, tap <b>Draw</b>, circle the area, then tap <b>Assign</b>. Assigned leads disappear from everyone else's map. Assign back to “Shared pool” to open them up again.
            </div>
          </div>
        )}

        {isManager && store.setRole && (
          <div className="section">
            <h3 style={{ fontSize: 20 }}>Team members</h3>
            <div className="muted" style={{ fontSize: 14 }}>
              Fix a name by typing over it. To add or remove someone, see “Adding and removing people” in the setup guide.
            </div>
            <ul className="list">
              {snap.members.map((m) => (
                <li key={m.id} className="switch">
                  <input
                    id={`name-${m.id}`}
                    type="text"
                    defaultValue={m.name}
                    aria-label="Name"
                    style={{ flex: 1, minWidth: 0 }}
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name && name !== m.name) store.renameMember!(m.id, name)
                    }}
                  />
                  <select
                    id={`role-${m.id}`}
                    value={m.role}
                    style={{ width: 'auto' }}
                    disabled={m.id === snap.me?.id}
                    onChange={(e) => store.setRole!(m.id, e.target.value as 'agent' | 'manager')}
                  >
                    <option value="agent">Agent</option>
                    <option value="manager">Manager</option>
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
