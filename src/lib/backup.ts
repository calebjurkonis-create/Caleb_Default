import type { Snapshot, Store } from '../data/store'
import type { Activity, Lead } from '../types'
import { STATUS } from './dispositions'
import { channelLabel } from './reports'

/** When this phone last saved a backup (per office login, kept on the phone). */
const LAST_KEY = 'knockroute-last-backup'

export function lastBackupAt(): Date | null {
  try {
    const v = localStorage.getItem(LAST_KEY)
    return v ? new Date(v) : null
  } catch {
    return null
  }
}

export function markBackedUp() {
  try {
    localStorage.setItem(LAST_KEY, new Date().toISOString())
  } catch {
    /* ignore */
  }
}

type Cell = { value?: string | number | Date; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: 'bold' } | null
type Sheet = Cell[][]

const text = (v: string | null | undefined): Cell => (v ? { value: v, type: String } : null)
const num = (v: number | null | undefined): Cell => (v == null ? null : { value: v, type: Number })
// Excel has no time zones: shift so the sheet shows the phone's local clock time, not UTC.
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
const when = (iso: string | null | undefined): Cell => (iso ? { value: local(new Date(iso)), type: Date, format: 'mm/dd/yyyy h:mm AM/PM' } : null)
const head = (labels: string[]): Cell[] => labels.map((l) => ({ value: l, type: String, fontWeight: 'bold' }))

/**
 * Everything the office has, as one Excel file with a tab each for leads, every
 * disposition ever logged, lead lists and the team. Reads only; changes nothing.
 */
export async function buildBackup(store: Store, snap: Snapshot): Promise<{ blob: Blob; filename: string; counts: { leads: number; acts: number } }> {
  const acts: Activity[] = await store.activitiesBetween(new Date(0), new Date(Date.now() + 365 * 86400_000))
  const name = (id: string | null | undefined) => (id ? snap.members.find((m) => m.id === id)?.name || 'Former teammate' : '')
  const listName = new Map(snap.lists.map((l) => [l.id, l.name]))
  const leadById = new Map(snap.leads.map((l) => [l.id, l]))

  const leads: Sheet = [
    head(['List', 'Prefix', 'First name', 'Last name', 'Address', 'City', 'State', 'ZIP', 'County', 'Phone', 'DOB (YYYYMM)', 'Status', 'Attempts', 'Last worked', 'Last worked by', 'Assigned to', 'Latitude', 'Longitude', 'Pin on street only', 'Lead ID']),
    ...snap.leads.map((l: Lead) => [
      text(listName.get(l.listId)),
      text(l.prefix),
      text(l.firstName),
      text(l.lastName),
      text(l.address),
      text(l.city),
      text(l.state),
      text(l.zip),
      text(l.county),
      text(l.phone),
      text(l.dob),
      text(STATUS[l.status].label),
      num(l.attempts),
      when(l.lastActivityAt),
      text(name(l.lastActivityBy)),
      text(l.assignedTo ? name(l.assignedTo) : 'Shared pool'),
      num(l.lat),
      num(l.lng),
      text(l.pinApprox ? 'Yes' : ''),
      text(l.id),
    ]),
  ]

  const dispositions: Sheet = [
    head(['When', 'Agent', 'Type', 'Disposition', 'Appointment / follow-up date', 'Updated to', 'Notes', 'Lead', 'Address', 'City', 'List', 'Lead ID']),
    ...[...acts]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((a) => {
        const l = leadById.get(a.leadId)
        return [
          when(a.createdAt),
          text(name(a.memberId)),
          text(channelLabel(a)),
          text(STATUS[a.outcome].label),
          when(a.dueAt),
          text(a.resolution ? STATUS[a.resolution].label : ''),
          text(a.notes),
          text(l ? `${l.firstName} ${l.lastName}`.trim() : a.leadLabel),
          text(l?.address),
          text(l?.city),
          text(l ? listName.get(l.listId) : ''),
          text(a.leadId),
        ]
      }),
  ]

  const lists: Sheet = [
    head(['List', 'Leads', 'Added', 'Added by']),
    ...snap.lists.map((list) => [
      text(list.name),
      num(snap.leads.filter((l) => l.listId === list.id).length),
      when(list.createdAt),
      text(name(list.createdBy)),
    ]),
  ]

  const team: Sheet = [head(['Name', 'Role']), ...snap.members.map((m) => [text(m.name), text(m.role === 'manager' ? 'Manager' : 'Agent')])]

  const { default: writeXlsxFile } = await import('write-excel-file')
  const blob = await writeXlsxFile([leads, dispositions, lists, team] as never, {
    sheets: ['Leads', 'Dispositions', 'Lists', 'Team'],
    stickyRowsCount: 1,
  })
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { blob, filename: `knockroute-backup-${stamp}.xlsx`, counts: { leads: snap.leads.length, acts: acts.length } }
}
