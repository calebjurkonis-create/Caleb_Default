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
      assignedTo: null,
    }))
    .filter((l) => l.address && (l.firstName || l.lastName))
}
