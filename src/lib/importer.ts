import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file'
import type { NewLead } from '../types'

export type Field = 'prefix' | 'firstName' | 'lastName' | 'address' | 'city' | 'state' | 'zip' | 'county' | 'phone' | 'dob'

export const FIELDS: { key: Field; label: string; required?: boolean; aliases: string[] }[] = [
  { key: 'prefix', label: 'Prefix', aliases: ['prefix', 'title', 'salutation'] },
  { key: 'firstName', label: 'First name', required: true, aliases: ['firstname', 'first', 'fname', 'first name'] },
  { key: 'lastName', label: 'Last name', required: true, aliases: ['lastname', 'last', 'lname', 'last name'] },
  { key: 'address', label: 'Street address', required: true, aliases: ['address', 'street', 'address1', 'addr'] },
  { key: 'city', label: 'City', required: true, aliases: ['city', 'town'] },
  { key: 'state', label: 'State', aliases: ['state', 'st'] },
  { key: 'zip', label: 'ZIP', aliases: ['zip', 'zipcode', 'zip code', 'postal', 'postalcode'] },
  { key: 'county', label: 'County', aliases: ['county'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'phone number', 'telephone', 'tel', 'cell'] },
  { key: 'dob', label: 'Birth month (DOB)', aliases: ['dob', 'birthdate', 'birth date', 'date of birth', 'birthday'] },
]

export type Mapping = Partial<Record<Field, number>>

export interface Sheet {
  headers: string[]
  rows: string[][]
}

function cell(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) {
    return `${v.getFullYear()}${String(v.getMonth() + 1).padStart(2, '0')}${String(v.getDate()).padStart(2, '0')}`
  }
  return String(v).trim()
}

export async function readSheet(file: File): Promise<Sheet> {
  let raw: unknown[][]
  if (/\.(csv|txt)$/i.test(file.name)) {
    const text = await file.text()
    raw = Papa.parse<string[]>(text, { skipEmptyLines: true }).data
  } else {
    raw = await readXlsxFile(file)
  }
  const [head = [], ...body] = raw
  return {
    headers: head.map(cell),
    rows: body.map((r) => r.map(cell)).filter((r) => r.some(Boolean)),
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+ ]/g, '').trim()

/** Matches the county-list headers (FIRSTNAME, LASTNAME, ADDRESS, …) automatically. */
export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {}
  const taken = new Set<number>()
  for (const f of FIELDS) {
    const idx = headers.findIndex((h, i) => !taken.has(i) && f.aliases.includes(norm(h)))
    if (idx >= 0) {
      mapping[f.key] = idx
      taken.add(idx)
    }
  }
  return mapping
}

export function missingRequired(mapping: Mapping): string[] {
  return FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.label)
}

export function toLeads(sheet: Sheet, mapping: Mapping): NewLead[] {
  const get = (row: string[], f: Field) => (mapping[f] === undefined ? '' : row[mapping[f]!] ?? '')
  return sheet.rows
    .map((row) => ({
      prefix: get(row, 'prefix'),
      firstName: get(row, 'firstName'),
      lastName: get(row, 'lastName'),
      address: get(row, 'address'),
      city: get(row, 'city'),
      state: get(row, 'state') || 'FL',
      zip: get(row, 'zip').slice(0, 5).padStart(get(row, 'zip') ? 5 : 0, '0'),
      county: get(row, 'county'),
      phone: get(row, 'phone'),
      dob: get(row, 'dob').replace(/\D/g, '').slice(0, 6),
      lat: null,
      lng: null,
      pinApprox: false,
      assignedTo: null,
    }))
    .filter((l) => l.address && (l.firstName || l.lastName))
}

const ABBR: Record<string, string> = {
  street: 'st', drive: 'dr', avenue: 'ave', av: 'ave', road: 'rd', lane: 'ln', court: 'ct', circle: 'cir',
  boulevard: 'blvd', place: 'pl', terrace: 'ter', parkway: 'pkwy', highway: 'hwy', trail: 'trl', point: 'pt',
  north: 'n', south: 's', east: 'e', west: 'w', apartment: 'apt', unit: 'apt', suite: 'apt',
}

/**
 * Identifies one person at one address, ignoring case, punctuation and spelled-out
 * street words ("Drive" vs "Dr"). Spouses at the same house stay separate leads.
 */
export function leadKey(l: Pick<NewLead, 'firstName' | 'lastName' | 'address' | 'zip' | 'city'>): string {
  const words = l.address
    .toLowerCase()
    .replace(/#/g, ' apt ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBR[w] ?? w)
  const place = l.zip.slice(0, 5) || l.city.toLowerCase().trim()
  const name = `${l.firstName} ${l.lastName}`.toLowerCase().replace(/[^a-z]/g, '')
  return `${words.join(' ')}|${place}|${name}`
}

/** Splits rows into new leads and ones already in the app (or repeated within the file). */
export function splitDuplicates<T extends NewLead>(rows: T[], existing: Iterable<Parameters<typeof leadKey>[0]>): { fresh: T[]; dupes: T[] } {
  const seen = new Set<string>()
  for (const l of existing) seen.add(leadKey(l))
  const fresh: T[] = []
  const dupes: T[] = []
  for (const r of rows) {
    const k = leadKey(r)
    if (seen.has(k)) dupes.push(r)
    else {
      seen.add(k)
      fresh.push(r)
    }
  }
  return { fresh, dupes }
}
