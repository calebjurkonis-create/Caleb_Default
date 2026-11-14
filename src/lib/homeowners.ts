import readXlsxFile, { readSheetNames } from 'read-excel-file'
import type { Lead, NewLead } from '../types'
import { leadKey } from './importer'

/**
 * New-homeowner files: one tab per ZIP (plus a Summary tab), each row a recent home sale
 * with the buyer, address, sale date and price, homestead, LLC/Trust flag and a note.
 * Tabs without owner and address columns (like Summary) are skipped; Summary is read only
 * for which county each ZIP is in.
 */

export interface HomeownerFile {
  rows: NewLead[]
  tabs: { name: string; rows: number }[]
  /** Tabs that look like sales tabs but have no rows (e.g. a county site was down). */
  emptyTabs: string[]
}

type Cell = string | number | boolean | Date | null

const norm = (v: Cell) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const text = (v: Cell) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim())

const COLS = {
  owner: ['buyerowner', 'owner', 'buyer', 'ownername', 'buyername', 'grantee'],
  address: ['propertyaddress', 'address', 'siteaddress', 'situsaddress', 'street'],
  city: ['city', 'situscity'],
  zip: ['zip', 'zipcode', 'postal'],
  saleDate: ['saledate', 'date', 'solddate', 'recordingdate'],
  salePrice: ['saleprice', 'price', 'soldprice', 'amount'],
  propertyType: ['propertytype', 'type', 'usecode'],
  homestead: ['homesteadshown', 'homestead'],
  parcel: ['parcelid', 'parcel', 'pin', 'altkey'],
  flag: ['buyerflag', 'flag', 'ownertype'],
  note: ['notes', 'note', 'comments'],
} as const
type Col = keyof typeof COLS

function columns(header: Cell[]): Partial<Record<Col, number>> {
  const out: Partial<Record<Col, number>> = {}
  header.forEach((h, i) => {
    const n = norm(h)
    for (const [k, aliases] of Object.entries(COLS) as [Col, readonly string[]][]) {
      if (out[k] === undefined && aliases.includes(n)) out[k] = i
    }
  })
  return out
}

const ENTITY =
  /\b(llc|inc|corp|corporation|co|company|trust|trustee|trustees|ltd|lp|llp|holdings|properties|property|investments?|group|partners|homes|bank|association|assn|church|estate|ventures|capital|realty|management|mgmt|fund)\b/i
/** Surnames that start with a particle ("La Velle", "De Jesus", "Van Horn"). */
const PARTICLES = new Set(['la', 'le', 'de', 'del', 'della', 'di', 'da', 'do', 'dos', 'das', 'van', 'von', 'st', 'san', 'santa', 'mac', 'des', 'du', 'el'])

const tidy = (s: string) =>
  (s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : s).replace(/\bLlc\b/g, 'LLC')

/** "Last First M & Spouse" → first "First M & Spouse", last "Last". Companies and trusts keep their full name. */
export function splitOwner(raw: string, flagged: boolean): { firstName: string; lastName: string } {
  const name = tidy(raw.replace(/\s+/g, ' ').trim())
  if (!name) return { firstName: '', lastName: '' }
  if (flagged || ENTITY.test(name)) return { firstName: '', lastName: name }
  const parsed = name
    .split(/\s*;\s*/)
    .filter(Boolean)
    .map((p) => {
      const w = p.split(' ')
      const n = w.length > 2 && PARTICLES.has(w[0].toLowerCase()) ? 2 : 1
      return { last: w.slice(0, n).join(' '), first: w.slice(n).join(' ') }
    })
  if (parsed.every((p) => p.last.toLowerCase() === parsed[0].last.toLowerCase())) {
    return { firstName: parsed.map((p) => p.first).filter(Boolean).join(' & '), lastName: parsed[0].last }
  }
  // Different last names: "Ana & John Smith" style, filed under the first person's last name.
  const [head, ...rest] = parsed
  return { firstName: [head.first, ...rest.map((p) => `${p.first} ${p.last}`.trim())].filter(Boolean).join(' & '), lastName: head.last }
}

function toDate(v: Cell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = text(v)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

function toPrice(v: Cell): number | null {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function flagOf(v: Cell, owner: string): string | null {
  const s = text(v)
  if (/trust/i.test(s)) return 'Trust'
  if (/llc|corp|inc|company/i.test(s)) return 'LLC/Corp'
  if (s) return s
  if (/\btrust(ee)?s?\b/i.test(owner)) return 'Trust'
  if (/\b(llc|inc|corp)\b/i.test(owner)) return 'LLC/Corp'
  return null
}

/** Turns one tab's rows (header first) into leads; exported for tests. */
export function rowsToLeads(rows: Cell[][], tabName: string, countyByZip: Map<string, string>, assignTo: string | null): NewLead[] | null {
  const c = columns(rows[0] ?? [])
  if (c.owner === undefined || c.address === undefined) return null
  const get = (r: Cell[], k: Col) => (c[k] === undefined ? null : r[c[k]!] ?? null)
  const out: NewLead[] = []
  for (const r of rows.slice(1)) {
    const owner = text(get(r, 'owner'))
    const address = text(get(r, 'address'))
    if (!owner || !address) continue
    const flag = flagOf(get(r, 'flag'), owner)
    const zip = text(get(r, 'zip')).replace(/\D/g, '').slice(0, 5) || (/^\d{5}/.exec(tabName)?.[0] ?? '')
    out.push({
      prefix: '',
      ...splitOwner(owner, !!flag),
      address: tidy(address),
      city: tidy(text(get(r, 'city'))),
      state: 'FL',
      zip,
      county: countyByZip.get(zip) ?? '',
      phone: '',
      dob: '',
      lat: null,
      lng: null,
      pinApprox: false,
      assignedTo: assignTo,
      leadType: 'nho',
      saleDate: toDate(get(r, 'saleDate')),
      salePrice: toPrice(get(r, 'salePrice')),
      homestead: text(get(r, 'homestead')) || null,
      buyerFlag: flag,
      parcelId: text(get(r, 'parcel')) || null,
      propertyType: text(get(r, 'propertyType')) || null,
      sourceNote: text(get(r, 'note')) || null,
    })
  }
  return out
}

export async function readHomeowners(file: File, assignTo: string | null): Promise<HomeownerFile> {
  const names = await readSheetNames(file)
  const sheets: { name: string; rows: Cell[][] }[] = []
  for (const name of names) sheets.push({ name, rows: (await readXlsxFile(file, { sheet: name })) as Cell[][] })

  // ZIP → county from a Summary-style tab, when there is one.
  const countyByZip = new Map<string, string>()
  for (const s of sheets) {
    const h = (s.rows[0] ?? []).map(norm)
    const zi = h.indexOf('zip')
    const ci = h.indexOf('county')
    if (zi >= 0 && ci >= 0) for (const r of s.rows.slice(1)) if (r[zi] && r[ci]) countyByZip.set(text(r[zi]).slice(0, 5), text(r[ci]))
  }

  const rows: NewLead[] = []
  const tabs: HomeownerFile['tabs'] = []
  const emptyTabs: string[] = []
  for (const s of sheets) {
    const leads = rowsToLeads(s.rows, s.name, countyByZip, assignTo)
    if (leads === null) continue
    if (!leads.length) emptyTabs.push(s.name)
    else {
      tabs.push({ name: s.name, rows: leads.length })
      rows.push(...leads)
    }
  }
  return { rows, tabs, emptyTabs }
}

/** One new-homeowner lead per address (owner names change between monthly files). */
export const addressKey = (l: Pick<NewLead, 'address' | 'zip' | 'city'>) => leadKey({ ...l, firstName: '', lastName: '' })

export function splitHomeownerDuplicates(rows: NewLead[], existing: Lead[]): { fresh: NewLead[]; dupes: NewLead[] } {
  const seen = new Set(existing.filter((l) => l.leadType === 'nho').map(addressKey))
  const fresh: NewLead[] = []
  const dupes: NewLead[] = []
  for (const r of rows) {
    const k = addressKey(r)
    if (seen.has(k)) dupes.push(r)
    else {
      seen.add(k)
      fresh.push(r)
    }
  }
  return { fresh, dupes }
}
