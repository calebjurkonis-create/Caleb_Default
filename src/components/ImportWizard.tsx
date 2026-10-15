import { useState } from 'react'
import type { Snapshot, Store } from '../data/store'
import { geocodeAll } from '../lib/geocode'
import { FIELDS, guessMapping, missingRequired, readSheet, toLeads, type Mapping, type Sheet } from '../lib/importer'
import type { NewLead } from '../types'
import { Icon } from './Icon'

type Step = 'file' | 'columns' | 'locating' | 'review'

export function ImportWizard({ store, snap, onClose, onDone }: { store: Store; snap: Snapshot; onClose(): void; onDone(msg: string): void }) {
  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState('')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [progress, setProgress] = useState(0)
  const [leads, setLeads] = useState<NewLead[]>([])
  const [listName, setListName] = useState('')
  const [assignTo, setAssignTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const s = await readSheet(file)
      if (!s.rows.length) throw new Error('That file has no rows under the header.')
      setSheet(s)
      setMapping(guessMapping(s.headers))
      setFileName(file.name)
      setListName(file.name.replace(/\.(xlsx|csv|txt)$/i, '').replace(/[_-]+/g, ' '))
      setStep('columns')
    } catch (e) {
      setError(`Couldn't read that file: ${(e as Error).message}. Use an .xlsx or .csv export with column names in the first row.`)
    }
  }

  async function locate() {
    if (!sheet) return
    const rows = toLeads(sheet, mapping)
    setStep('locating')
    setProgress(0)
    setError(null)
    try {
      const results = await geocodeAll(
        rows.map((l, i) => ({ id: String(i), street: l.address, city: l.city, state: l.state, zip: l.zip })),
        (done, total) => setProgress(done / total),
      )
      const byId = new Map(results.map((r) => [r.id, r]))
      setLeads(rows.map((l, i) => ({ ...l, lat: byId.get(String(i))?.lat ?? null, lng: byId.get(String(i))?.lng ?? null })))
      setStep('review')
    } catch (e) {
      setError((e as Error).message)
      setStep('columns')
    }
  }

  async function save() {
    setSaving(true)
    try {
      await store.importList(listName.trim() || fileName, leads.map((l) => ({ ...l, assignedTo: assignTo || null })))
      onDone(`Imported ${leads.length} leads`)
    } catch (e) {
      setError(`Couldn't save: ${(e as Error).message}`)
      setSaving(false)
    }
  }

  const missing = missingRequired(mapping)
  const found = leads.filter((l) => l.lat != null).length
  const notFound = leads.filter((l) => l.lat == null)

  return (
    <section className="sheet full" aria-label="Import leads">
      <header className="sheet-head">
        <div className="grow">
          <h2>Import leads</h2>
          <div className="muted" style={{ marginTop: 4 }}>
            {step === 'file' && 'Step 1 of 3 · Choose the file'}
            {step === 'columns' && `Step 2 of 3 · Check the columns in ${fileName}`}
            {step === 'locating' && 'Step 3 of 3 · Finding addresses on the map'}
            {step === 'review' && 'Step 3 of 3 · Review and save'}
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Cancel import">
          <Icon name="close" />
        </button>
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
              Same files you load into inRoute work as-is. Columns named FIRSTNAME, LASTNAME, ADDRESS, CITY, STATE, ZIP, DOB, COUNTY, PREFIX and PHONE are matched automatically.
            </div>
          </>
        )}

        {step === 'columns' && sheet && (
          <>
            <div className="muted num">{sheet.rows.length} rows found. Match each field to a column:</div>
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
            {missing.length > 0 && <div className="err">Still needed: {missing.join(', ')}</div>}
            <button className="btn primary block" disabled={missing.length > 0} onClick={locate}>
              Find these addresses on the map <Icon name="arrow" />
            </button>
          </>
        )}

        {step === 'locating' && (
          <div className="section">
            <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="muted">Looking up each address with the U.S. Census Bureau. About a minute per few hundred rows.</div>
          </div>
        )}

        {step === 'review' && (
          <>
            <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="stat"><b className="num">{found}</b><span>On the map</span></div>
              <div className="stat"><b className="num">{notFound.length}</b><span>Address not found</span></div>
            </div>
            {notFound.length > 0 && (
              <details>
                <summary>Addresses that weren't found ({notFound.length})</summary>
                <ul style={{ fontSize: 14 }}>
                  {notFound.slice(0, 50).map((l, i) => (
                    <li key={i}>{l.address}, {l.city} {l.zip}</li>
                  ))}
                </ul>
                <div className="muted" style={{ fontSize: 14 }}>These still import. They show in the Leads list, just not on the map.</div>
              </details>
            )}
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
            <button className="btn primary block" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : `Add ${leads.length} leads for the team`}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
