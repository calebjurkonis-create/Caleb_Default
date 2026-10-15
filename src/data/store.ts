import { useSyncExternalStore } from 'react'
import type { Activity, Lead, LeadList, Member, NewLead, Outcome, Role } from '../types'

export interface Snapshot {
  ready: boolean
  me: Member | null
  members: Member[]
  leads: Lead[]
  /** Recent team activity (last couple of weeks) for the feed and stats. */
  activities: Activity[]
  lists: LeadList[]
  error: string | null
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
  signOut(): Promise<void>

  history(leadId: string): Promise<Activity[]>
  /** Logs a door knock. Notes are required. */
  logActivity(leadId: string, outcome: Outcome, notes: string): Promise<void>
  /** Every disposition the viewer can see between two times, newest first (for reports). */
  activitiesBetween(from: Date, to: Date): Promise<Activity[]>
  claim(leadIds: string[], on: boolean): Promise<void>
  assign(leadIds: string[], memberId: string | null): Promise<void>
  importList(name: string, leads: NewLead[]): Promise<void>
  deleteList(listId: string): Promise<void>
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

export function memberName(s: Snapshot, id: string | null | undefined): string {
  if (!id) return ''
  if (id === s.me?.id) return 'You'
  return s.members.find((m) => m.id === id)?.name || 'Teammate'
}
