import { useMemo, useState } from 'react'
import { memberName, type Snapshot, type Store } from '../data/store'
import { STATUS } from '../lib/dispositions'
import { clockTime, isToday, shortName, timeAgo } from '../lib/leads'
import type { Lead } from '../types'
import { Icon } from './Icon'

interface Props {
  store: Store
  snap: Snapshot
  onClose(): void
  onOpenLead(l: Lead): void
  onImport(): void
}

export function TeamPanel({ store, snap, onClose, onOpenLead, onImport }: Props) {
  const isManager = snap.me?.role === 'manager'
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const leadById = useMemo(() => new Map(snap.leads.map((l) => [l.id, l])), [snap.leads])

  const today = useMemo(() => snap.activities.filter((a) => isToday(a.createdAt)), [snap.activities])
  const board = useMemo(() => {
    const rows = new Map<string, { id: string; doors: number; calls: number; appts: number }>()
    for (const a of today) {
      const r = rows.get(a.memberId) ?? { id: a.memberId, doors: 0, calls: 0, appts: 0 }
      if (a.channel === 'door') r.doors++
      else r.calls++
      if (a.outcome === 'appointment') r.appts++
      rows.set(a.memberId, r)
    }
    return [...rows.values()].sort((a, b) => b.appts - a.appts || b.doors + b.calls - (a.doors + a.calls))
  }, [today])

  const totals = board.reduce((t, r) => ({ doors: t.doors + r.doors, calls: t.calls + r.calls, appts: t.appts + r.appts }), { doors: 0, calls: 0, appts: 0 })
  const listCounts = useMemo(() => {
    const c = new Map<string, { total: number; worked: number; assigned: number }>()
    for (const l of snap.leads) {
      const r = c.get(l.listId) ?? { total: 0, worked: 0, assigned: 0 }
      r.total++
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
          <h2>Team today</h2>
          <div className="muted" style={{ marginTop: 4 }}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body">
        <div className="stats">
          <div className="stat"><b>{totals.doors}</b><span>Doors knocked</span></div>
          <div className="stat"><b>{totals.calls}</b><span>Calls</span></div>
          <div className="stat"><b>{totals.appts}</b><span>Appointments</span></div>
        </div>

        <div className="section">
          <h3 style={{ fontSize: 20 }}>Board</h3>
          {board.length === 0 ? (
            <div className="muted">No dispositions logged yet today.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="board">
                <thead>
                  <tr><th>Agent</th><th>Doors</th><th>Calls</th><th>Appts</th></tr>
                </thead>
                <tbody>
                  {board.map((r, i) => (
                    <tr key={r.id} className={r.id === snap.me?.id ? 'me' : ''}>
                      <td><span className="rank">{i + 1}</span>{memberName(snap, r.id)}</td>
                      <td>{r.doors}</td>
                      <td>{r.calls}</td>
                      <td>{r.appts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                        <b>{memberName(snap, a.memberId)}</b> {a.channel === 'door' ? 'knocked' : 'called'}{' '}
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
              const c = listCounts.get(list.id) ?? { total: 0, worked: 0, assigned: 0 }
              return (
                <div key={list.id} className="card">
                  <div style={{ fontWeight: 600 }}>{list.name}</div>
                  <div className="muted num" style={{ fontSize: 14 }}>
                    {c.total} leads · {c.worked} worked · {c.assigned} assigned to someone · added {timeAgo(list.createdAt)}
                  </div>
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
