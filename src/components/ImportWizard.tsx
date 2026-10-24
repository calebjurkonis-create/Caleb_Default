import { useEffect, useRef, useState } from 'react'
import type { Snapshot, Store } from '../data/store'
import { geocodeAll } from '../lib/geocode'
import { placeNearNeighbors, zipCenters, type KnownPin } from '../lib/placement'
import { FIELDS, guessMapping, missingRequired, readSheet, splitDuplicates, toLeads, type Mapping, type Sheet } from '../lib/importer'
import type { NewLead } from '../types'
import { Icon } from './Icon'

type Step = 'file' | 'setup' | 'running' | 'done'

/** Addresses are looked up and saved this many at a time, so progress is never lost. */
const CHUNK = 250
const RETRY_WAIT = [3000, 8000, 20000]

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Progress {
  total: number
  saved: number
  onMap: number
  /** Of those on the map, how many are pinned on their street rather than the house. */
  street: number
  notFound: NewLead[]
}

export function ImportWizard({ store, snap, onClose, onDone }: { store: Store; snap: Snapshot; onClose(): void; onDone(msg: string): void }) {
  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState('')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [listName, setListName] = useState('')
  const [assignTo, setAssignTo] = useState('')
  const [dupes, setDupes] = useState<NewLead[]>([])
  const [progress, setProgress] = useState<Progress>({ total: 0, saved: 0, onMap: 0, street: 0, notFound: [] })
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  const cancel = useRef(false)
  const wakeLock = useRef<{ release(): Promise<void> } | null>(null)

  // Keep the screen on while importing; iPhones re-allow it when the app comes back to the front.
  async function holdScreen() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
      wakeLock.current = (await wl?.request('screen')) ?? null
    } catch {
      /* not supported: the tip on screen covers it */
    }
  }
  function releaseScreen() {
    wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
  }
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible' && step === 'running') holdScreen()
    }
    document.addEventListener('visibilitychange', again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      releaseScreen()
    }
  }, [step])

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const s = await readSheet(file)
      if (!s.rows.length) throw new Error('That file has no rows under the header.')
      setSheet(s)
      setMapping(guessMapping(s.headers))
      setFileName(file.name)
      setListName(file.name.replace(/\.(xlsx|csv|txt)$/i, '').replace(/[_]+/g, ' ').trim())
      setStep('setup')
    } catch (e) {
      setError(`Couldn't read that file: ${(e as Error).message}. Use an .xlsx or .csv export with column names in the first row.`)
    }
  }

  async function run() {
    if (!sheet) return
    const { fresh, dupes: skipped } = splitDuplicates(toLeads(sheet, mapping), snap.leads)
    setDupes(skipped)
    setError(null)
    if (!fresh.length) {
      setError(
        skipped.length
          ? `All ${skipped.length} leads in this file are already in KnockRoute. Nothing new to add.`
          : 'No rows with a name and street address were found.',
      )
      return
    }
    cancel.current = false
    setStopped(false)
    setStep('running')
    await holdScreen()
    const p: Progress = { total: fresh.length, saved: 0, onMap: 0, street: 0, notFound: [] }
    setProgress({ ...p })
    // Exact pins already on the map (plus each batch as it's found) place the misses near their neighbors.
    const known: KnownPin[] = snap.leads
      .filter((l) => l.lat != null && l.lng != null && !l.pinApprox)
      .map((l) => ({ address: l.address, zip: l.zip, lat: l.lat!, lng: l.lng! }))

    for (let i = 0; i < fresh.length; i += CHUNK) {
      if (cancel.current) break
      const chunk = fresh.slice(i, i + CHUNK)
      let saved = false
      for (let attempt = 0; !saved; attempt++) {
        try {
          setStatus(`Finding addresses ${i + 1}–${i + chunk.length}…`)
          const found = await geocodeAll(
            chunk.map((l, j) => ({ id: String(j), street: l.address, city: l.city, state: l.state, zip: l.zip })),
            () => {},
          )
          const byId = new Map(found.map((r) => [r.id, r]))
          for (const [j, l] of chunk.entries()) {
            const r = byId.get(String(j))
            if (r?.lat != null && r.lng != null) known.push({ address: l.address, zip: l.zip, lat: r.lat, lng: r.lng })
          }
          // Whatever the lookup missed still goes on the map: next to its neighbors, or at its ZIP code.
          const missed = chunk.map((l, j) => ({ id: String(j), address: l.address, zip: l.zip, city: l.city })).filter((t) => byId.get(t.id)?.lat == null)
          const { placed, unplaced } = placeNearNeighbors(missed, known)
          if (unplaced.length) {
            setStatus(`Placing ${unplaced.length} address${unplaced.length === 1 ? '' : 'es'} by ZIP code…`)
            for (const [id, pos] of await zipCenters(unplaced, chunk[0]?.state || 'FL')) placed.set(id, pos)
          }
          const located = chunk.map((l, j) => {
            const r = byId.get(String(j))
            const exact = r?.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null
            const pos = exact ?? placed.get(String(j)) ?? null
            return { ...l, lat: pos?.lat ?? null, lng: pos?.lng ?? null, pinApprox: !!pos && !exact, assignedTo: assignTo || null }
          })
          setStatus(`Saving ${i + 1}–${i + chunk.length}…`)
          await store.importList(listName.trim() || fileName, located)
          p.saved += located.length
          p.onMap += located.filter((l) => l.lat != null).length
          p.street += located.filter((l) => l.pinApprox).length
          p.notFound.push(...located.filter((l) => l.lat == null))
          setProgress({ ...p, notFound: [...p.notFound] })
          saved = true
        } catch (e) {
          if (attempt >= RETRY_WAIT.length || cancel.current) {
            releaseScreen()
            setError(
              `Stopped after saving ${p.saved.toLocaleString()} of ${p.total.toLocaleString()} leads: ${(e as Error).message}. ` +
                'Nothing saved is lost. Choose the same file again and it picks up where it stopped.',
            )
            setStopped(true)
            setStep('done')
            return
          }
          setStatus(`Connection hiccup, trying again in ${RETRY_WAIT[attempt] / 1000} seconds…`)
          await wait(RETRY_WAIT[attempt])
        }
      }
    }
    releaseScreen()
    if (cancel.current) setStopped(true)
    setStep('done')
  }

  const missing = missingRequired(mapping)
  const pct = progress.total ? Math.round((progress.saved / progress.total) * 100) : 0

  return (
    <section className="sheet full" aria-label="Import leads">
      <header className="sheet-head">
        <div className="grow">
          <h2>Import leads</h2>
          <div className="muted" style={{ marginTop: 4 }}>
            {step === 'file' && 'Step 1 of 3 · Choose the file'}
            {step === 'setup' && `Step 2 of 3 · Check ${fileName}`}
            {step === 'running' && 'Step 3 of 3 · Adding leads to the map'}
            {step === 'done' && (stopped ? 'Import paused' : 'Import finished')}
          </div>
        </div>
        {step !== 'running' && (
          <button className="close" onClick={() => (step === 'done' && !stopped ? onDone(`Imported ${progress.saved.toLocaleString()} leads`) : onClose())} aria-label="Close">
            <Icon name="close" />
          </button>
        )}
      </header>
      <div className="sheet-body">
        {error && <div className="err">{error}</div>}

        {step === 'file' && (
          <>
            <label className="btn route block" style={{ cursor: 'pointer' }}>
              <Icon name="upload" /> Choose .xlsx or .csv
              <input type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            <div className="notice">
              Columns named FIRSTNAME, LASTNAME, ADDRESS, CITY, STATE, ZIP, DOB, COUNTY, PREFIX and PHONE are matched automatically. Any size works; leads already in KnockRoute are skipped.
            </div>
          </>
        )}

        {step === 'setup' && sheet && (
          <>
            <div className="muted num">{sheet.rows.length.toLocaleString()} rows found.</div>
            <details open={missing.length > 0}>
              <summary>{missing.length ? 'Match the columns' : 'Columns matched automatically (tap to check)'}</summary>
              <table className="mapping">
                <tbody>
                  {FIELDS.map((f) => (
                    <tr key={f.key}>
                      <td>
                        {f.label}
                        {f.required && ' *'}
                      </td>
                      <td>
                        <select
                          id={`map-${f.key}`}
                          value={mapping[f.key] ?? ''}
                          onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                        >
                          <option value="">(not in this file)</option>
                          {sheet.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h || `Column ${i + 1}`} — e.g. {sheet.rows[0]?.[i] || '—'}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {missing.length > 0 && <div className="err">Still needed: {missing.join(', ')}</div>}
            <label className="field">
              List name
              <input id="list-name" type="text" value={listName} onChange={(e) => setListName(e.target.value)} />
            </label>
            <label className="field">
              Who works these leads
              <select id="list-assign" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Shared pool (everyone)</option>
                {snap.members.map((m) => (
                  <option key={m.id} value={m.id}>Only {m.name}</option>
                ))}
              </select>
            </label>
            {sheet.rows.length > 1000 && (
              <div className="notice">
                Big list: this takes a while. Keep KnockRoute open on screen until it finishes. If it gets interrupted, everything saved so far stays, and choosing the same file again picks up where it stopped.
              </div>
            )}
            <button className="btn primary block" disabled={missing.length > 0 || !listName.trim()} onClick={run}>
              Add to the map <Icon name="arrow" />
            </button>
          </>
        )}

        {(step === 'running' || step === 'done') && (
          <div className="section">
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            <div className="num" style={{ fontWeight: 600 }}>
              {progress.saved.toLocaleString()} of {progress.total.toLocaleString()} saved ({pct}%)
            </div>
            {step === 'running' && <div className="muted">{status}</div>}
            <div className="stats">
              <div className="stat"><b className="num">{progress.onMap.toLocaleString()}</b><span>On the map</span></div>
              <div className="stat"><b className="num">{progress.notFound.length.toLocaleString()}</b><span>Address not found</span></div>
              <div className="stat"><b className="num">{dupes.length.toLocaleString()}</b><span>Already in app, skipped</span></div>
            </div>
            {step === 'running' && (
              <>
                <div className="notice">Keep this screen open. Leads appear on the map as each batch saves.</div>
                <button className="btn" onClick={() => { cancel.current = true; setStatus('Stopping after this batch…') }}>
                  Pause import
                </button>
              </>
            )}
            {progress.street > 0 && (
              <div className="muted" style={{ fontSize: 14 }}>
                {progress.street.toLocaleString()} of those on the map have an approximate pin, placed next to their neighbors (usually new builds the address service doesn't list yet). They show as dashed pins; Navigate still goes to the exact address.
              </div>
            )}
            {step === 'done' && progress.notFound.length > 0 && (
              <details>
                <summary>Addresses that weren't found ({progress.notFound.length})</summary>
                <ul style={{ fontSize: 14 }}>
                  {progress.notFound.slice(0, 100).map((l, i) => (
                    <li key={i}>{l.address}, {l.city} {l.zip}</li>
                  ))}
                </ul>
                <div className="muted" style={{ fontSize: 14 }}>These are saved and show in the Leads list, just not on the map.</div>
              </details>
            )}
            {step === 'done' && stopped && (
              <label className="btn route block" style={{ cursor: 'pointer' }}>
                <Icon name="upload" /> Choose the same file to continue
                <input type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => { setStep('file'); pick(e.target.files?.[0]) }} />
              </label>
            )}
            {step === 'done' && !stopped && (
              <button className="btn primary block" onClick={() => onDone(`Imported ${progress.saved.toLocaleString()} leads`)}>
                See them on the map
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
