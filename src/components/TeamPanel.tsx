import { useEffect, useMemo, useState } from 'react'
import { memberName, type Snapshot, type Store } from '../data/store'
import { activeClaim, isToday, timeAgo } from '../lib/leads'
import { agentRows, dispositionsCsv, fileStamp, leaderboardCsv, periodRange, PERIODS, ratioLabel, saveFile, type AgentRow, type Period } from '../lib/reports'
import type { Activity, GatedZone } from '../types'
import { Icon } from './Icon'
import { geocodeAll, geocodeFallback, spreadStreetPin } from '../lib/geocode'
import { buildBackup, lastBackupAt, markBackedUp } from '../lib/backup'
import { insidePolygon } from '../lib/route'
import { monthName, monthWindow, scheduleSummary, turning65Index } from '../lib/schedule'

interface Props {
  store: Store
  snap: Snapshot
  onClose(): void
  onImport(): void
  onDrawZone(): void
  onFindGated(): void
  onShowZone(z: GatedZone): void
  scheduleOn: boolean
  onSchedule(on: boolean): Promise<void>
}

type SortKey = 'appts' | 'doors' | 'followUps' | 'notInterested' | 'sold' | 'ratio'

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: 'doors', label: 'DKs', title: 'Doors knocked' },
  { key: 'appts', label: 'Appt', title: 'Appointments' },
  { key: 'followUps', label: 'F/U', title: 'Follow-ups' },
  { key: 'notInterested', label: 'NI', title: 'Not interested' },
  { key: 'sold', label: 'Sold', title: 'Appointments updated to Sold' },
  { key: 'ratio', label: '+/−', title: 'Appointments + follow-ups against not interested' },
]

export function TeamPanel({ store, snap, onClose, onImport, onDrawZone, onFindGated, onShowZone, scheduleOn, onSchedule }: Props) {
  const isManager = snap.me?.role === 'manager'
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('month')
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

  const myId = snap.me?.id
  const active = rows.filter((r) => r.doors || r.sold)
  const idle = rows.filter((r) => !r.doors && !r.sold)
  const myIndex = active.findIndex((r) => r.id === myId)
  const meRow = rows.find((r) => r.id === myId)
  const top = active.slice(0, 5)
  const [showAll, setShowAll] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [pane, setPane] = useState<'board' | 'manage'>('board')
  const [exportOpen, setExportOpen] = useState(false)
  const SORT_WORD: Record<SortKey, string> = { appts: 'appts', doors: 'doors', followUps: 'follow-ups', notInterested: 'NI', sold: 'sales', ratio: 'points' }
  const gap =
    myIndex > 0 && meRow
      ? (() => {
          const ahead = active[myIndex - 1]
          const d = sortKey === 'ratio' ? 0 : (ahead[sortKey] as number) - (meRow[sortKey] as number)
          return d > 0 ? `${d} ${SORT_WORD[sortKey]} behind #${myIndex}` : `Tied with #${myIndex}`
        })()
      : myIndex === 0
        ? 'Leading the team'
        : 'No doors yet this period'

  const periodPick = (
    <select id="team-period" className="pill-select" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Time period">
      {PERIODS.map((p) => (
        <option key={p.key} value={p.key}>{p.label}</option>
      ))}
    </select>
  )
  const legend = (
    <div className="muted" style={{ fontSize: 13 }}>
      Tap a column to rank by it. DKs = doors knocked · F/U = follow-ups · NI = not interested · Sold = appointments updated to Sold · +/− = appointments + follow-ups : not interested (only doors that were answered). Appt, F/U and NI include status updates on earlier leads.
    </div>
  )
  const fullTable = (list: AgentRow[], rankFrom = 0) => (
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
          {list.map((r, i) => (
            <tr key={r.id} className={`${r.id === myId ? 'me' : ''}${r.doors === 0 && r.sold === 0 ? ' idle' : ''}`}>
              <td><span className="rank">{r.doors || r.sold ? rankFrom + i + 1 : ''}</span>{r.id === myId ? 'You' : r.name}</td>
              <td>{r.doors}</td>
              <td>{r.appts}</td>
              <td>{r.followUps}</td>
              <td>{r.notInterested}</td>
              <td>{r.sold}</td>
              <td className="ratio">{ratioLabel(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const topTable = (
    <table className="board">
      <thead>
        <tr><th>Top 5</th><th>Doors</th><th>Appts</th><th>F/U</th><th>Sold</th></tr>
      </thead>
      <tbody>
        {top.map((r, i) => (
          <tr key={r.id} className={r.id === myId ? 'me' : ''}>
            <td><span className="rank">{i + 1}</span>{r.id === myId ? 'You' : r.name}</td>
            <td>{r.doors}</td><td>{r.appts}</td><td>{r.followUps}</td><td>{r.sold}</td>
          </tr>
        ))}
        {meRow && myIndex >= 5 && (
          <tr className="me gap-above">
            <td><span className="rank">{myIndex + 1}</span>You</td>
            <td>{meRow.doors}</td><td>{meRow.appts}</td><td>{meRow.followUps}</td><td>{meRow.sold}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
  const boardBody = loadError ? (
    <div className="err">Couldn't load this period: {loadError}</div>
  ) : !acts ? (
    <div className="muted">Loading…</div>
  ) : null

  const zonesActive = snap.zones.filter((z) => z.status === 'active').length
  const claimed = snap.leads.filter((l) => activeClaim(l))
  const routesOut = new Set(claimed.map((l) => activeClaim(l))).size
  const w = monthWindow(new Date())
  const backedUp = lastBackupAt()
  const manage: { key: string; title: string; sub: string; body: React.ReactNode }[] = [
    { key: 'lists', title: 'Lead lists', sub: `${snap.lists.length} list${snap.lists.length === 1 ? '' : 's'} · ${snap.leads.length.toLocaleString()} leads`, body: (
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
    ) },
    { key: 'zones', title: 'Gated areas', sub: `${zonesActive} area${zonesActive === 1 ? '' : 's'}`, body: <GatedAreas store={store} snap={snap} onDraw={onDrawZone} onFind={onFindGated} onShow={onShowZone} /> },
    { key: 'routes', title: 'Doors on routes now', sub: claimed.length ? `${claimed.length} doors on ${routesOut} route${routesOut === 1 ? '' : 's'}` : 'Nobody out right now', body: <DoorsOnRoutes store={store} snap={snap} /> },
    { key: 'schedule', title: 'Birth-month schedule', sub: scheduleOn ? `On · showing ${monthName(w.first).replace(/ \d+$/, '')} – ${monthName(w.last)}` : 'Off · every month showing', body: <BirthSchedule snap={snap} on={scheduleOn} onChange={onSchedule} /> },
    { key: 'remove', title: 'Remove leads', sub: 'By birth month or by county', body: (<><RemoveByMonth store={store} snap={snap} /><RemoveByCounty store={store} snap={snap} /></>) },
    { key: 'backup', title: 'Backup', sub: backedUp ? `Last saved ${timeAgo(backedUp.toISOString())}` : 'Never saved on this phone', body: <Backup store={store} snap={snap} /> },
    ...(store.setRole ? [{ key: 'members', title: 'Team members', sub: `${snap.members.length} people`, body: (
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
    ) }] : []),
  ]
  const [openTools, setOpenTools] = useState<Set<string>>(new Set())
  const toggleTool = (k: string) =>
    setOpenTools((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const ownCount = snap.leads.filter((l) => l.leadType === 'personal' && l.assignedTo === myId).length

  return (
    <section className="sheet full" aria-label="Team">
      <header className="sheet-head">
        <div className="grow">
          <h2>Team</h2>
          <div className="muted num" style={{ marginTop: 4 }}>
            {isManager ? `${snap.members.length} people · ${snap.leads.length.toLocaleString()} leads` : 'How you and the team are doing'}
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="sheet-body" style={{ gap: 12 }}>
        {!isManager ? (
          <>
            <div className="pick-line">
              {periodPick}
              <button className="link-btn" onClick={() => setShowKey(!showKey)}>What do these mean?</button>
            </div>
            {showKey && legend}
            {boardBody ?? (
              <>
                <div className="you-card">
                  <div className="you-top">
                    <b>You{myIndex >= 0 ? ` · #${myIndex + 1} of ${rows.length}` : ''}</b>
                    <small>{gap}</small>
                  </div>
                  <div className="you-stats num">
                    <div><b>{meRow?.doors ?? 0}</b><span>Doors</span></div>
                    <div><b>{meRow?.appts ?? 0}</b><span>Appts</span></div>
                    <div><b>{meRow?.followUps ?? 0}</b><span>Follow-ups</span></div>
                    <div><b>{meRow ? ratioLabel(meRow) : '–'}</b><span>+ / −</span></div>
                  </div>
                </div>
                {showAll ? fullTable(rows) : topTable}
                <button className="link-btn more-btn" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show top 5' : `See all ${rows.length}`}
                </button>
              </>
            )}
            {snap.ownLeadsReady && (
              <div className="tool-row">
                <div>
                  <b>Your own leads</b>
                  <small>{ownCount ? `${ownCount} on the map · ` : ''}only you and managers see them</small>
                </div>
                <button className="btn small route" onClick={onImport}>
                  <Icon name="plus" /> Add
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="seg" role="group" aria-label="Team view">
              <button aria-pressed={pane === 'board'} onClick={() => setPane('board')}>Leaderboard</button>
              <button aria-pressed={pane === 'manage'} onClick={() => setPane('manage')}>Manage</button>
            </div>
            {pane === 'board' ? (
              <>
                <div className="pick-line">
                  {periodPick}
                  <button className="btn small" onClick={() => setExportOpen(!exportOpen)} disabled={!acts?.length} aria-expanded={exportOpen}>
                    <Icon name="download" /> Export
                  </button>
                </div>
                {exportOpen && acts && (
                  <div className="row">
                    <button className="btn small" onClick={() => exportCsv('board')}>Leaderboard</button>
                    <button className="btn small" onClick={() => exportCsv('all')}>Every disposition</button>
                  </div>
                )}
                {exportMsg && <div className="muted" style={{ fontSize: 14 }}>{exportMsg}</div>}
                {boardBody ?? (
                  <>
                    {fullTable(active)}
                    {idle.length > 0 && (
                      <div className={`fold${openTools.has('idle') ? ' open' : ''}`}>
                        <button className="fold-head" onClick={() => toggleTool('idle')} aria-expanded={openTools.has('idle')}>
                          <b>No doors yet · <span className="num">{idle.length}</span></b>
                          <span className="fold-chev" aria-hidden="true">›</span>
                          <small>{idle.map((r) => r.name).slice(0, 6).join(', ')}{idle.length > 6 ? '…' : ''}</small>
                        </button>
                        {openTools.has('idle') && <div className="fold-inner">{fullTable(idle, active.length)}</div>}
                      </div>
                    )}
                    <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowKey(!showKey)}>What do these mean?</button>
                    {showKey && legend}
                  </>
                )}
              </>
            ) : (
              manage.map((t) => (
                <div key={t.key} className={`fold tool-fold t-${t.key}${openTools.has(t.key) ? ' open' : ''}`}>
                  <button className="fold-head" onClick={() => toggleTool(t.key)} aria-expanded={openTools.has(t.key)}>
                    <b>{t.title}</b>
                    <span className="fold-chev" aria-hidden="true">›</span>
                    <small>{t.sub}</small>
                  </button>
                  {openTools.has(t.key) && <div className="fold-inner">{t.body}</div>}
                </div>
              ))
            )}
          </>
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

  // Turning-65 leads only: new homeowners and agents' own leads aren't on the birth-month schedule.
  const t65 = useMemo(() => snap.leads.filter((l) => (l.leadType ?? 't65') === 't65'), [snap.leads])
  const months = useMemo(() => {
    const c = new Map<string, number>()
    for (const l of t65) {
      const ym = /^(\d{4})(\d{2})/.exec(l.dob)
      if (ym) c.set(`${ym[1]}${ym[2]}`, (c.get(`${ym[1]}${ym[2]}`) ?? 0) + 1)
    }
    return [...c.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [t65])

  const label = (ym: string) => {
    const y = Number(ym.slice(0, 4))
    const m = Number(ym.slice(4, 6)) - 1
    return `Born ${MONTHS[m]} ${y} (turn 65 ${MONTHS[m]} ${y + 65})`
  }
  const ids = month ? t65.filter((l) => l.dob.startsWith(month)).map((l) => l.id) : []
  const worked = month ? t65.filter((l) => l.dob.startsWith(month) && l.status !== 'new').length : 0

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

/** Managers: download everything (leads, every disposition, lists, team) as one Excel file. */
function Backup({ store, snap }: { store: Store; snap: Snapshot }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [last, setLast] = useState(lastBackupAt)
  const days = last ? Math.floor((Date.now() - last.getTime()) / 86400_000) : null

  async function run() {
    setBusy(true)
    setMsg('Gathering everything…')
    try {
      const { blob, filename, counts } = await buildBackup(store, snap)
      const ok = await saveFile(filename, blob)
      if (ok) {
        markBackedUp()
        setLast(new Date())
        setMsg(`Saved ${filename}: ${counts.leads.toLocaleString()} leads and ${counts.acts.toLocaleString()} dispositions. Keep it in Google Drive, iCloud or email it to yourself.`)
      } else setMsg(null)
    } catch (e) {
      setMsg(`Couldn't make the backup: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section">
      <h3 style={{ fontSize: 20 }}>Backup</h3>
      <div className="muted" style={{ fontSize: 14 }}>
        One Excel file with every lead, every disposition and note, the lead lists and the team. It only reads; nothing changes.
      </div>
      {(days == null || days >= 7) && (
        <div className="notice">{days == null ? 'No backup saved from this phone yet.' : `Last backup was ${days} days ago.`} Once a week is a good habit.</div>
      )}
      <button className="btn block" disabled={busy} onClick={run}>
        <Icon name="download" /> {busy ? 'Making the backup…' : 'Download a backup'}
      </button>
      {days != null && days < 7 && (
        <div className="muted" style={{ fontSize: 13 }}>Last backup from this phone: {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}.</div>
      )}
      {msg && <div className="muted" style={{ fontSize: 14 }}>{msg}</div>}
    </div>
  )
}

/** Managers: mark gated communities (drawn, or confirmed from OpenStreetMap). Everyone sees them. */
function GatedAreas({ store, snap, onDraw, onFind, onShow }: { store: Store; snap: Snapshot; onDraw(): void; onFind(): void; onShow(z: GatedZone): void }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const zones = snap.zones.filter((z) => z.status === 'active')
  const leadsIn = (z: GatedZone) => {
    const poly = z.points.map(([lat, lng]) => ({ lat, lng }))
    return snap.leads.filter((l) => l.lat != null && l.lng != null && insidePolygon({ lat: l.lat, lng: l.lng }, poly)).length
  }

  return (
    <div className="section">
      <h3 style={{ fontSize: 20 }}>Gated areas</h3>
      {!snap.zonesReady ? (
        <div className="notice">Turns on after the one-time database update (005).</div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 14 }}>
            Outlined on everyone's map. Leads inside stay routable; agents just get a heads-up. Tap a name to change it; the outline stays the same.
          </div>
          <div className="row">
            <button className="btn small" onClick={onDraw}><Icon name="lasso" /> Draw a gated area</button>
            <button className="btn small" onClick={onFind}><Icon name="search" /> Find on the map view</button>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            “Find” checks OpenStreetMap (the map data behind road routing) for gated or private neighborhoods in the part of the map on screen. You confirm each one before anyone sees it.
          </div>
          {zones.length > 0 && (
            <ul className="list">
              {zones.map((z) => (
                <li key={z.id} className="zone-row">
                  <div>
                    <input
                      id={`zone-name-${z.id}`}
                      type="text"
                      defaultValue={z.name}
                      placeholder="Gated community"
                      aria-label="Gated area name"
                      onBlur={async (e) => {
                        const name = e.target.value.trim()
                        if (name === z.name) return
                        try {
                          await store.renameZone(z.id, name)
                          setMsg(null)
                        } catch (err) {
                          setMsg(`Couldn't rename it: ${(err as Error).message}`)
                          e.target.value = z.name
                        }
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <div className="muted num" style={{ fontSize: 13, marginTop: 2 }}>{leadsIn(z) === 1 ? '1 lead' : `${leadsIn(z)} leads`}{z.source === 'osm' ? ' · from OpenStreetMap' : ''}</div>
                  </div>
                  {confirm === z.id ? (
                    <span className="row" style={{ gap: 6 }}>
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          setConfirm(null)
                          try {
                            await store.deleteZone(z.id)
                          } catch (e) {
                            setMsg(`Couldn't remove it: ${(e as Error).message}`)
                          }
                        }}
                      >
                        Remove
                      </button>
                      <button className="btn small" onClick={() => setConfirm(null)}>Keep</button>
                    </span>
                  ) : (
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn small" onClick={() => onShow(z)}>Show</button>
                      <button className="btn small" onClick={() => setConfirm(z.id)}>Remove…</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {msg && <div className="err">{msg}</div>}
        </>
      )}
    </div>
  )
}

/** Managers: the automatic birth-month schedule (what's showing, what changes next, on/off). */
function BirthSchedule({ snap, on, onChange }: { snap: Snapshot; on: boolean; onChange(on: boolean): Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const sum = scheduleSummary()
  const w = monthWindow()
  // Uploaded months by turning-65 month, so it's clear what's waiting and what's missing.
  const months = useMemo(() => {
    const c = new Map<number, number>()
    for (const l of snap.leads) {
      const t = turning65Index(l)
      if (t != null) c.set(t, (c.get(t) ?? 0) + 1)
    }
    return [...c.entries()].sort((a, b) => a[0] - b[0])
  }, [snap.leads])
  const missingNext = !months.some(([t]) => t === w.last + 1)

  return (
    <div className="section">
      <h3 style={{ fontSize: 20 }}>Birth-month schedule</h3>
      <div className="muted" style={{ fontSize: 14 }}>
        Automatic: on the 15th the month 6 out appears; on the 1st the month now 2 out comes off. Nothing is deleted, and leads with an open appointment or follow-up stay on.
      </div>
      {on ? (
        <div className="card" style={{ gap: 6 }}>
          <div><b>Showing:</b> turning 65 {sum.showing}</div>
          {sum.next.map((n) => (
            <div key={n.when} className="muted" style={{ fontSize: 14 }}>{n.when}: {n.what}</div>
          ))}
          {missingNext && (
            <div className="notice">No {monthName(w.last + 1)} leads uploaded yet. Upload them any time before then; they'll appear on schedule.</div>
          )}
        </div>
      ) : (
        <div className="notice">Off: every uploaded birth month shows on the map.</div>
      )}
      <ul className="list">
        {months.map(([t, n]) => (
          <li key={t} className="switch">
            <span>{monthName(t)}</span>
            <span className="muted num" style={{ fontSize: 14 }}>
              {n.toLocaleString()} leads · {!on || (t >= w.first && t <= w.last) ? 'on the map' : t < w.first ? 'off (passed)' : 'waiting'}
            </span>
          </li>
        ))}
      </ul>
      <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setMsg(null)
          try {
            await onChange(!on)
          } catch (e) {
            setMsg(`Couldn't change it: ${(e as Error).message}`)
          } finally {
            setBusy(false)
          }
        }}
      >
        {on ? 'Turn schedule off (show every month)' : 'Turn schedule back on'}
      </button>
      {msg && <div className="err">{msg}</div>}
    </div>
  )
}

/** Managers: drop whole counties from KnockRoute (every birth month, including ones waiting their turn). */
function RemoveByCounty({ store, snap }: { store: Store; snap: Snapshot }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const counties = useMemo(() => {
    const c = new Map<string, number>()
    for (const l of snap.leads) {
      if ((l.leadType ?? 't65') !== 't65') continue // county removal is for the turning-65 territory
      const k = l.county.trim()
      if (k) c.set(k, (c.get(k) ?? 0) + 1)
    }
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [snap.leads])
  const inPicked = (l: (typeof snap.leads)[number]) => (l.leadType ?? 't65') === 't65' && picked.has(l.county.trim())
  const ids = snap.leads.filter(inPicked).map((l) => l.id)
  const worked = snap.leads.filter((l) => inPicked(l) && l.status !== 'new').length
  const names = [...picked].sort().join(', ')

  async function remove() {
    setBusy(true)
    setMsg(null)
    try {
      if (!(await store.canDeleteLeadsSafely())) {
        setMsg('One-time database update needed first so removing leads keeps their history (supabase/updates/001).')
        return
      }
      await store.deleteLeads(ids)
      setMsg(`Removed ${ids.length.toLocaleString()} leads from ${names}. Their door-knock history is still in the reports.`)
      setPicked(new Set())
    } catch (e) {
      setMsg(`Couldn't remove them: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!counties.length) return null
  return (
    <div className="section">
      <h3 style={{ fontSize: 20 }}>Remove a county</h3>
      <div className="muted" style={{ fontSize: 14 }}>
        Tap the counties you're dropping. Removes every birth month for them, including months waiting for their date. Knocks already logged stay in the leaderboard and exports.
      </div>
      <div className="chips" style={{ position: 'static', padding: 0, flexWrap: 'wrap' }} role="group" aria-label="Counties">
        {counties.map(([name, n]) => (
          <button
            key={name}
            className="chip"
            aria-pressed={picked.has(name)}
            onClick={() => {
              const next = new Set(picked)
              if (next.has(name)) next.delete(name)
              else next.add(name)
              setPicked(next)
              setConfirming(false)
              setMsg(null)
            }}
          >
            {name} <span className="num muted">{n.toLocaleString()}</span>
          </button>
        ))}
      </div>
      {picked.size > 0 &&
        (confirming ? (
          <div className="card">
            <b>Remove {ids.length.toLocaleString()} leads from {names}?</b>
            <div className="muted" style={{ fontSize: 14 }}>
              {worked.toLocaleString()} of them have been worked. This can't be undone; re-importing would bring them back as new.
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
            Remove {ids.length.toLocaleString()} leads ({picked.size} {picked.size === 1 ? 'county' : 'counties'})…
          </button>
        ))}
      {msg && <div className="muted">{msg}</div>}
    </div>
  )
}
