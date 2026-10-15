import type { Lead } from '../types'

export function fullName(l: Pick<Lead, 'prefix' | 'firstName' | 'lastName'>): string {
  return [l.prefix, l.firstName, l.lastName].filter(Boolean).join(' ')
}

export function shortName(l: Pick<Lead, 'firstName' | 'lastName'>): string {
  return [l.firstName, l.lastName].filter(Boolean).join(' ')
}

export function streetLine(l: Pick<Lead, 'address'>): string {
  return l.address
}

export function cityLine(l: Pick<Lead, 'city' | 'state' | 'zip'>): string {
  return [l.city, [l.state, l.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Turns 65 in Feb 2027 · 4 mo" from a YYYYMM birth month. */
export function turning65(dob: string, now = new Date()): { label: string; monthsAway: number } | null {
  const m = /^(\d{4})(\d{2})/.exec(dob.replace(/\D/g, ''))
  if (!m) return null
  const year = Number(m[1]) + 65
  const month = Number(m[2]) - 1
  if (month < 0 || month > 11) return null
  const monthsAway = (year - now.getFullYear()) * 12 + (month - now.getMonth())
  const when = `${MONTHS[month]} ${year}`
  if (monthsAway < 0) return { label: `Turned 65 ${when}`, monthsAway }
  if (monthsAway === 0) return { label: `Turns 65 this month`, monthsAway }
  return { label: `Turns 65 ${when} · ${monthsAway} mo`, monthsAway }
}

export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const CLAIM_HOURS = 12

/** A route claim lasts the working day; after that the lead is free again. */
export function activeClaim(l: Lead, now = Date.now()): string | null {
  if (!l.claimedBy || !l.claimedAt) return null
  return now - new Date(l.claimedAt).getTime() < CLAIM_HOURS * 3600_000 ? l.claimedBy : null
}

export function isToday(iso: string, now = new Date()): boolean {
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}
