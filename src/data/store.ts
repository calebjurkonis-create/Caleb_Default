import { useSyncExternalStore } from 'react'
import type { Activity, Lead, LeadList, Member, NewLead, Outcome, Role } from '../types'

export interface LeadFix {
  id: string
  address?: string
  city?: string
  zip?: string
  lat?: number | null
  lng?: number | null
  pinApprox?: boolean
}

export interface Snapshot {
  ready: boolean
  me: Member | null
  members: Member[]
  leads: Lead[]
  /** Recent team activity (last couple of weeks) for the feed and stats. */
  activities: Activity[]
  lists: LeadList[]
  error: string | null
  /** Signed in with a temporary password a manager set up; must pick their own first. */
  mustChangePassword?: boolean
  /** Follow-up/appointment dates and status updates are available (database update 004 applied). */
  agendaReady: boolean
  /** Bumped when a follow-up/appointment is updated, so open agenda lists refresh. */
  itemsVersion?: number
}

export interface Store {
  mode: 'demo' | 'live'
  getSnapshot(): Snapshot
  subscribe(listener: () => void): () => void

  /** Demo: pick a teammate. */
  signInAs?(memberId: string, role: Role): void
  /** Live: email + password set up by a manager. */
  signInWithPassword?(email: string, password: string): Promise<void>
  changePassword?(password: string): Promise<void>
  /** Replaces the temporary password from the setup script. */
  setOwnPassword?(password: string): Promise<void>
  signOut(): Promise<void>

  history(leadId: string): Promise<Activity[]>
  /** Logs a door knock. Notes are required except for No Answer/Not Home. */
  logActivity(leadId: string, outcome: Outcome, notes: string, dueAt?: string | null): Promise<void>
  /** Open follow-ups and appointments the viewer can see, soonest first. */
  openItems(): Promise<Activity[]>
  /**
   * Updates an open follow-up/appointment (e.g. Booked, Sold, Not Interested). Logs the
   * update as its own entry, so the lead's status and history move forward.
   */
  resolveItem(itemId: string, result: Outcome, notes: string, nextDueAt?: string | null): Promise<void>
  /** Every disposition the viewer can see between two times, newest first (for reports). */
  activitiesBetween(from: Date, to: Date): Promise<Activity[]>
  claim(leadIds: string[], on: boolean): Promise<void>
  assign(leadIds: string[], memberId: string | null): Promise<void>
  /** Adds leads to the list with this name, creating it if needed. */
  importList(name: string, leads: NewLead[]): Promise<void>
  deleteList(listId: string): Promise<void>
  /** Managers: remove leads everywhere. Their door-knock history stays in reports. */
  deleteLeads(ids: string[]): Promise<void>
  /** False when the database still deletes history along with leads (needs the one-time update). */
  canDeleteLeadsSafely(): Promise<boolean>
  /** Shared app settings (e.g. the road-routing key). Empty string when not set or not available. */
  getSetting(name: string): Promise<string>
  /** Managers only. */
  setSetting(name: string, value: string): Promise<void>
  /** Managers: fix addresses and/or map locations. */
  updateLeads(changes: LeadFix[]): Promise<void>
  setRole?(memberId: string, role: Role): Promise<void>
  renameMember?(memberId: string, name: string): Promise<void>

  /** Demo only. */
  resetDemo?(): void
  simulateTeam?: { get(): boolean; set(on: boolean): void }
}

export function useSnapshot(store: Store): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/** Agents see the shared pool plus leads assigned to them; managers see everything. */
export function visibleLeads(s: Snapshot): Lead[] {
  if (!s.me) return []
  if (s.me.role === 'manager') return s.leads
  return s.leads.filter((l) => l.assignedTo === null || l.assignedTo === s.me!.id)
}

/** Usernames like "calebjurkonis" sign in as this hidden address; real emails work too. */
export const USERNAME_DOMAIN = 'knockroute.example.com'

export function loginEmail(input: string): string {
  const v = input.trim().toLowerCase()
  return v.includes('@') ? v : `${v.replace(/[^a-z0-9._-]/g, '')}@${USERNAME_DOMAIN}`
}

/** Name of the lead an activity was about, even if the lead was removed since. */
export function activityLeadName(a: Activity, lead: Lead | undefined): string {
  if (lead) return [lead.firstName, lead.lastName].filter(Boolean).join(' ')
  return a.leadLabel.split(',')[0]?.trim() || 'a removed lead'
}

export function memberName(s: Snapshot, id: string | null | undefined): string {
  if (!id) return ''
  if (id === s.me?.id) return 'You'
  return s.members.find((m) => m.id === id)?.name || 'Teammate'
}
