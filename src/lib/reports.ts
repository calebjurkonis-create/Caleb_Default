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
  /** Appointments per door knocked, 0–1. */
  rate: number
}

export function agentRows(acts: Activity[], members: Member[]): AgentRow[] {
  const rows = new Map<string, AgentRow>()
  const row = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      r = { id, name: members.find((m) => m.id === id)?.name || 'Former teammate', doors: 0, appts: 0, followUps: 0, notInterested: 0, noAnswer: 0, rate: 0 }
      rows.set(id, r)
    }
    return r
  }
  for (const m of members) row(m.id)
  for (const a of acts) {
    const r = row(a.memberId)
    r.doors++
    if (a.outcome === 'appointment') r.appts++
    else if (a.outcome === 'follow_up') r.followUps++
    else if (a.outcome === 'not_interested') r.notInterested++
    else if (a.outcome === 'no_answer') r.noAnswer++
  }
  for (const r of rows.values()) r.rate = r.doors ? r.appts / r.doors : 0
  return [...rows.values()]
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
    ['Agent', 'Doors knocked', 'Appointments', 'Follow-ups', 'Not interested', 'No answer/Not home', 'Appointment rate'],
    ...rows.map((r) => [r.name, r.doors, r.appts, r.followUps, r.notInterested, r.noAnswer, r.doors ? `${(r.rate * 100).toFixed(1)}%` : '']),
  ])
}

export function dispositionsCsv(acts: Activity[], members: Member[], leads: Map<string, Lead>, lists: LeadList[]): string {
  const name = (id: string) => members.find((m) => m.id === id)?.name || 'Former teammate'
  const listName = (id: string | undefined) => lists.find((l) => l.id === id)?.name ?? ''
  return csv([
    ['Date', 'Time', 'Agent', 'Disposition', 'Notes', 'First name', 'Last name', 'Address', 'City', 'ZIP', 'County', 'Lead list'],
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
          STATUS[a.outcome].label,
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
export async function saveFile(filename: string, text: string): Promise<boolean> {
  const file = new File([text], filename, { type: 'text/csv' })
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
