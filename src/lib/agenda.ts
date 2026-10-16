import type { Activity, Lead } from '../types'
import { DATED } from './dispositions'

/** "Today 5:00 PM", "Tomorrow 10:30 AM", "Thu, Oct 22 · 9:00 AM". */
export function dueLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86400_000)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (diff === 0) return `Today ${time}`
  if (diff === 1) return `Tomorrow ${time}`
  if (diff === -1) return `Yesterday ${time}`
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`
}

export type Bucket = 'undated' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'

export const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'undated', label: 'Undated' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
]

export function bucketOf(iso: string | null, now = new Date()): Bucket {
  if (!iso) return 'undated'
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = new Date(iso).getTime()
  if (t < start) return 'overdue'
  if (t < start + 86400_000) return 'today'
  if (t < start + 2 * 86400_000) return 'tomorrow'
  if (t < start + 8 * 86400_000) return 'week'
  return 'later'
}

/** Items due today or earlier: the count shown on the Agenda tab. */
export function dueNowCount(items: Activity[], now = new Date()): number {
  return items.filter((i) => i.dueAt && ['overdue', 'today'].includes(bucketOf(i.dueAt, now))).length
}

/**
 * Each lead's current open follow-up or appointment: its newest one, not yet updated, and
 * only while the lead is still at that status. Covers ones logged before dates existed.
 */
export function currentItems(acts: Activity[], leads: Map<string, Lead>): Activity[] {
  const newest = new Map<string, Activity>()
  for (const a of acts) {
    if (!DATED.includes(a.outcome) || a.resolvedAt || !a.leadId) continue
    const seen = newest.get(a.leadId)
    if (!seen || a.createdAt > seen.createdAt) newest.set(a.leadId, a)
  }
  return [...newest.values()]
    .filter((a) => leads.get(a.leadId)?.status === a.outcome)
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
}

/** Value for <input type="datetime-local"> from an ISO time, in the phone's time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** ISO time from a datetime-local value (interpreted in the phone's time zone). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
