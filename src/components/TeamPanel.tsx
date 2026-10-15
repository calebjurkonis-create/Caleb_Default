import { useEffect, useMemo, useState } from 'react'
import { activityLeadName, memberName, type Snapshot, type Store } from '../data/store'
import { STATUS } from '../lib/dispositions'
import { activeClaim, clockTime, isToday, shortName, timeAgo } from '../lib/leads'
import { agentRows, dispositionsCsv, fileStamp, leaderboardCsv, periodRange, PERIODS, ratioLabel, saveFile, type AgentRow, type Period } from '../lib/reports'
import type { Activity, Lead } from '../types'
import { Icon } from './Icon'
import { geocodeAll, geocodeFallback, spreadStreetPin } from '../lib/geocode'

interface Props {
  store: Store
  snap: Snapshot
  onClose(): void
  onOpenLead(l: Lead): void
  onImport(): void
}

type SortKey = 'appts' | 'doors' | 'followUps' | 'notInterested' | 'ratio'

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: 'doors', label: 'DKs', title: 'Doors knocked' },
  { key: 'appts', label: 'Appt', title: 'Appointments' },
  { key: 'followUps', label: 'F/U', title: 'Follow-ups' },
  { key: 'notInterested', label: 'NI', title: 'Not interested' },
  { key: 'ratio', label: '+/−', title: 'Appointments + follow-ups against not interested' },
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
      if (found.length) {
        await store.updateLeads(
          found.map((r) => {
            const pos = r.approx ? spreadStreetPin(r.id, r.lat!, r.lng!) : { lat: r.lat!, lng: r.lng! }
            return { id: r.id, ...pos, pinApprox: !!r.approx }
          }),
        )
      }
      const onStreet = found.filter((r) => r.approx).length
      const left = missing.length - found.length
      setRetry({
        listId,
        busy: false,
        text:
          `Found ${found.length} of ${missing.length}` +
          (onStreet ? ` (${onStreet} pinned on their street).` : '.') +
          (left ? ` ${left} still need a fix: Leads tab → “No pin”.` : ''),
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
                        <button className={`sort${sortKey === c.key ? ' on' : ''}`} onClick={() => setSortKey(c.key)} aria-pressed={sortKey === c.key} title={c.title}>
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
                      <td>{r.notInterested}</td>
                      <td className="ratio">{ratioLabel(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="muted" style={{ fontSize: 13 }}>
            Tap a column to rank by it. DKs = doors knocked · F/U = follow-ups · NI = not interested · +/− = appointments + follow-ups : not interested (only doors that were answered).
          </div>
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
                          activityLeadName(a, undefined)
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

        {isManager && <DoorsOnRoutes store={store} snap={snap} />}

        {isManager && <RemoveByMonth store={store} snap={snap} />}

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Clear out everyone born in a given month once their 65th birthday has come and gone. */
function RemoveByMonth({ store, snap }: { store: Store; snap: Snapshot }) {
  const [month, setMonth] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const months = useMemo(() => {
    const c = new Map<string, number>()
    for (const l of snap.leads) {
      const ym = /^(\d{4})(\d{2})/.exec(l.dob)
      if (ym) c.set(`${ym[1]}${ym[2]}`, (c.get(`${ym[1]}${ym[2]}`) ?? 0) + 1)
    }
    return [...c.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [snap.leads])

  const label = (ym: string) => {
    const y = Number(ym.slice(0, 4))
    const m = Number(ym.slice(4, 6)) - 1
    return `Born ${MONTHS[m]} ${y} (turn 65 ${MONTHS[m]} ${y + 65})`
  }
  const ids = month ? snap.leads.filter((l) => l.dob.startsWith(month)).map((l) => l.id) : []
  const worked = month ? snap.leads.filter((l) => l.dob.startsWith(month) && l.status !== 'new').length : 0

  async function remove() {
    setBusy(true)
    setMsg(null)
    try {
      if (!(await store.canDeleteLeadsSafely())) {
        setMsg('One-time database update needed first, so removing leads keeps your team’s door-knock history. Run supabase/updates/001 in Supabase (see the setup guide), then try again.')
        return
      }
      await store.deleteLeads(ids)
      setMsg(`Removed ${ids.length.toLocaleString()} leads. Their door-knock history is still in the reports.`)
      setMonth('')
    } catch (e) {
      setMsg(`Couldn't remove them: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!months.length) return null
  return (
    <div className="section">
      <h3 style={{ fontSize: 20 }}>Remove a birth month</h3>
      <div className="muted" style={{ fontSize: 14 }}>
        Clears everyone born in that month from every list and map, once their window has passed. Knocks already logged stay in the leaderboard and exports.
      </div>
      <select id="remove-month" value={month} onChange={(e) => { setMonth(e.target.value); setConfirming(false); setMsg(null) }}>
        <option value="">Choose a month…</option>
        {months.map(([ym, n]) => (
          <option key={ym} value={ym}>
            {label(ym)} · {n.toLocaleString()} leads
          </option>
        ))}
      </select>
      {month &&
        (confirming ? (
          <div className="card">
            <b>
              Remove {ids.length.toLocaleString()} leads born {label(month).replace('Born ', '').replace(/ \(.*/, '')}?
            </b>
            <div className="muted" style={{ fontSize: 14 }}>
              {worked.toLocaleString()} of them have been worked. This can't be undone; re-importing the list would bring them back as new.
            </div>
            <div className="row">
              <button className="btn danger" disabled={busy} onClick={remove}>
                {busy ? 'Removing…' : `Remove ${ids.length.toLocaleString()} leads`}
              </button>
              <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Keep them</button>
            </div>
          </div>
        ) : (
          <button className="btn danger" onClick={() => setConfirming(true)}>
            Remove {ids.length.toLocaleString()} leads…
          </button>
        ))}
      {msg && <div className="muted">{msg}</div>}
    </div>
  )
}

/** Managers: see whose route holds which doors, and free them up (e.g. a release that never went through). */
function DoorsOnRoutes({ store, snap }: { store: Store; snap: Snapshot }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const byPerson = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const l of snap.leads) {
      const who = activeClaim(l)
      if (who) m.set(who, [...(m.get(who) ?? []), l.id])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [snap.leads])

  async function release(who: string, ids: string[]) {
    setBusy(true)
    setMsg(null)
    try {
      await store.claim(ids, false)
      setMsg(`Released ${ids.length} door${ids.length === 1 ? '' : 's'} from ${memberName(snap, who)}'s route.`)
    } catch (e) {
      setMsg(`Couldn't release them: ${(e as Error).message}. Check your signal and try again.`)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <div className="section">
      <h3 style={{ fontSize: 20 }}>Doors on routes right now</h3>
      {byPerson.length === 0 ? (
        <div className="muted">Nobody has doors on a route right now.</div>
      ) : (
        <ul className="list">
          {byPerson.map(([who, ids]) => (
            <li key={who} className="switch" style={{ flexWrap: 'wrap' }}>
              <span>
                <b>{memberName(snap, who)}</b> <span className="muted num">· {ids.length} door{ids.length === 1 ? '' : 's'}</span>
              </span>
              {confirm === who ? (
                <span className="row" style={{ gap: 6 }}>
                  <button className="btn small danger" disabled={busy} onClick={() => release(who, ids)}>
                    {busy ? 'Releasing…' : `Release ${ids.length}`}
                  </button>
                  <button className="btn small" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
                </span>
              ) : (
                <button className="btn small" onClick={() => setConfirm(who)}>Release all…</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="muted" style={{ fontSize: 13 }}>
        Doors also free up on their own 12 hours after a route is planned. Releasing doesn't change anyone's dispositions.
      </div>
      {msg && <div className="muted" style={{ fontSize: 14 }}>{msg}</div>}
    </div>
  )
}
