import type { Lead } from '../types'

/**
 * The office's birth-month schedule, run by the app itself:
 *  - On the 15th of each month, the birth month 6 months out appears (Oct 15 → April).
 *  - On the 1st of each month, the birth month now 2 months out disappears (Nov 1 → January).
 * Leads are never deleted by this (history stays); they're just off the map, lists and routes.
 * Leads with an open appointment or follow-up stay visible so nobody loses their agenda.
 * Months are the month each person turns 65 (birth month + 65 years).
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const index = (y: number, m: number) => y * 12 + (m - 1)
const fromIndex = (i: number) => ({ y: Math.floor(i / 12), m: (i % 12) + 1 })
export const monthName = (i: number) => {
  const { y, m } = fromIndex(i)
  return `${MONTHS[m - 1]} ${y}`
}

/** The month a lead turns 65, as a month index, or null without a usable birth month. */
export function turning65Index(l: Pick<Lead, 'dob'>): number | null {
  const m = /^(\d{4})(\d{2})/.exec(l.dob ?? '')
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return index(Number(m[1]) + 65, month)
}

/** First and last turning-65 months shown on this date. */
export function monthWindow(now = new Date()): { first: number; last: number } {
  const cur = index(now.getFullYear(), now.getMonth() + 1)
  return { first: cur + 3, last: cur + (now.getDate() >= 15 ? 6 : 5) }
}

const KEEP_STATUSES = new Set(['appointment', 'follow_up'])

export function inWindow(l: Lead, w: { first: number; last: number }): boolean {
  const t = turning65Index(l)
  if (t == null) return true
  if (KEEP_STATUSES.has(l.status)) return true
  return t >= w.first && t <= w.last
}

/** Plain-words summary for managers: what's showing and the next two changes. */
export function scheduleSummary(now = new Date()): { showing: string; next: { when: string; what: string }[] } {
  const w = monthWindow(now)
  const y = now.getFullYear()
  const mo = now.getMonth() // 0-based
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const next: { date: Date; what: string }[] = []
  // Next 15th: the month after `last` appears.
  const fifteenth = now.getDate() < 15 ? new Date(y, mo, 15) : new Date(y, mo + 1, 15)
  next.push({ date: fifteenth, what: `${monthName(w.last + 1)} birthdays appear` })
  // Next 1st: `first` disappears.
  next.push({ date: new Date(y, mo + 1, 1), what: `${monthName(w.first)} birthdays come off` })
  next.sort((a, b) => a.date.getTime() - b.date.getTime())
  return {
    showing: `${monthName(w.first)} – ${monthName(w.last)}`,
    next: next.map((n) => ({ when: fmt(n.date), what: n.what })),
  }
}
