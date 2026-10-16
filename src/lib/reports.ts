import type { Activity, Lead, LeadList, Member } from '../types'
import { STATUS } from './dispositions'

export type Period = 'today' | 'week' | 'lastWeek' | 'month' | 'lastMonth'

export const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
]

/** [start, end) for a period in the phone's local time. Weeks run Monday–Sunday. */
export function periodRange(p: Period, now = new Date()): { from: Date; to: Date; label: string } {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  const monday = addDays(day, -((day.getDay() + 6) % 7))
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  switch (p) {
    case 'today':
      return { from: day, to: addDays(day, 1), label: day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }
    case 'week':
      return { from: monday, to: addDays(monday, 7), label: `${fmt(monday)} – ${fmt(addDays(monday, 6))}` }
    case 'lastWeek': {
      const from = addDays(monday, -7)
      return { from, to: monday, label: `${fmt(from)} – ${fmt(addDays(monday, -1))}` }
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from, to: new Date(now.getFullYear(), now.getMonth() + 1, 1), label: from.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
    }
    case 'lastMonth': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return { from, to: new Date(now.getFullYear(), now.getMonth(), 1), label: from.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
    }
  }
}

export interface AgentRow {
  id: string
  name: string
  doors: number
  appts: number
  followUps: number
  notInterested: number
  noAnswer: number
  /** Appointments closed as Sold (from status updates). */
  sold: number
  /** Good outcomes when someone answers: appointments + follow-ups. */
  positive: number
  /** Bad outcome when someone answers: not interested. */
  negative: number
  /** Sort key for positive : negative (no-answers don't count either way). */
  ratio: number
}

/** "5 : 2" style, or a dash when nobody answered. */
export function ratioLabel(r: Pick<AgentRow, 'positive' | 'negative'>): string {
  return r.positive || r.negative ? `${r.positive} : ${r.negative}` : '–'
}

/**
 * Positives per negative, with zero negatives counted as one so a single lucky door
 * (1 : 0) doesn't outrank steady results (6 : 1). Nobody answered = bottom.
 */
function ratioKey(positive: number, negative: number): number {
  if (!positive && !negative) return -1
  return positive / Math.max(negative, 1)
}

export function agentRows(acts: Activity[], members: Member[]): AgentRow[] {
  const rows = new Map<string, AgentRow>()
  const row = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      r = { id, name: members.find((m) => m.id === id)?.name || 'Former teammate', doors: 0, appts: 0, followUps: 0, notInterested: 0, noAnswer: 0, sold: 0, positive: 0, negative: 0, ratio: -1 }
      rows.set(id, r)
    }
    return r
  }
  for (const m of members) row(m.id)
  // The +/- ratio only looks at answered doors, so status updates don't skew it.
  const doorPos = new Map<string, number>()
  const doorNeg = new Map<string, number>()
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1)
  for (const a of acts) {
    const r = row(a.memberId)
    const atDoor = a.channel !== 'update'
    if (atDoor) r.doors++
    if (a.outcome === 'appointment') r.appts++
    else if (a.outcome === 'follow_up') r.followUps++
    else if (a.outcome === 'not_interested') r.notInterested++
    else if (a.outcome === 'no_answer') r.noAnswer++
    else if (a.outcome === 'sold') r.sold++
    if (atDoor && (a.outcome === 'appointment' || a.outcome === 'follow_up')) bump(doorPos, a.memberId)
    if (atDoor && a.outcome === 'not_interested') bump(doorNeg, a.memberId)
  }
  for (const r of rows.values()) {
    r.positive = doorPos.get(r.id) ?? 0
    r.negative = doorNeg.get(r.id) ?? 0
    r.ratio = ratioKey(r.positive, r.negative)
  }
  return [...rows.values()]
}

export function channelLabel(a: Activity): string {
  return a.channel === 'update' ? 'Status update' : a.channel === 'phone' ? 'Phone call' : 'Door knock'
}

function dueText(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US')} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function csv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // Leading BOM so Excel reads names with accents correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

export function leaderboardCsv(rows: AgentRow[]): string {
  return csv([
    ['Agent', 'Doors knocked', 'Appointments', 'Follow-ups', 'Not interested', 'No answer/Not home', 'Sold', 'Positive at the door (Appts + F/U)', 'Negative at the door (Not interested)', '+/- ratio'],
    ...rows.map((r) => [r.name, r.doors, r.appts, r.followUps, r.notInterested, r.noAnswer, r.sold, r.positive, r.negative, r.positive || r.negative ? `${r.positive}:${r.negative}` : '']),
  ])
}

export function dispositionsCsv(acts: Activity[], members: Member[], leads: Map<string, Lead>, lists: LeadList[]): string {
  const name = (id: string) => members.find((m) => m.id === id)?.name || 'Former teammate'
  const listName = (id: string | undefined) => lists.find((l) => l.id === id)?.name ?? ''
  return csv([
    ['Date', 'Time', 'Agent', 'Type', 'Disposition', 'Appointment / follow-up date', 'Notes', 'First name', 'Last name', 'Address', 'City', 'ZIP', 'County', 'Lead list'],
    ...[...acts]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((a) => {
        const l = leads.get(a.leadId)
        const d = new Date(a.createdAt)
        // Removed lead: use the "First Last, Address, City" saved with the visit.
        const [who = '', addr = '', town = ''] = l ? [] : a.leadLabel.split(',').map((x) => x.trim())
        const [first, ...rest] = who.split(' ')
        return [
          d.toLocaleDateString('en-US'),
          d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          name(a.memberId),
          channelLabel(a),
          STATUS[a.outcome].label,
          a.dueAt ? dueText(a.dueAt) : '',
          a.notes,
          l ? l.firstName : first ?? '',
          l ? l.lastName : rest.join(' '),
          l ? l.address : addr,
          l ? l.city : town,
          l?.zip ?? '',
          l?.county ?? '',
          listName(l?.listId),
        ]
      }),
  ])
}

/**
 * Hands a file to the phone: the share sheet on iPhone/Android (Save to Files, Mail,
 * AirDrop…), or a normal download on a computer. Returns false if the person cancelled.
 */
export async function saveFile(filename: string, data: string | Blob): Promise<boolean> {
  const type = typeof data === 'string' ? 'text/csv' : data.type || 'application/octet-stream'
  const file = new File([data], filename, { type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] }) && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: filename })
      return true
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

export function fileStamp(from: Date, to: Date): string {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1)
  return iso(from) === iso(last) ? iso(from) : `${iso(from)}_to_${iso(last)}`
}
