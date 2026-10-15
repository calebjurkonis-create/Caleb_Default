export type Role = 'agent' | 'manager'

export interface Member {
  id: string
  name: string
  role: Role
}

export type Channel = 'door' | 'phone'

/** Mirrors the "Next disposition" list in OSCR. */
export type Outcome =
  | 'no_answer'
  | 'left_note'
  | 'appointment'
  | 'follow_up'
  | 'not_interested'
  | 'info_requested'
  | 'bad_info'

export type LeadStatus = 'new' | Outcome

export interface Lead {
  id: string
  listId: string
  prefix: string
  firstName: string
  lastName: string
  address: string
  city: string
  state: string
  zip: string
  county: string
  phone: string
  /** Birth month as YYYYMM, the format the county lists use. */
  dob: string
  lat: number | null
  lng: number | null
  status: LeadStatus
  attempts: number
  lastActivityAt: string | null
  lastActivityBy: string | null
  /** null = shared pool, visible to everyone. Otherwise only this agent (and managers) see it. */
  assignedTo: string | null
  /** Set when someone puts the lead on today's route, so others don't plan the same door. */
  claimedBy: string | null
  claimedAt: string | null
}

export interface Activity {
  id: string
  leadId: string
  memberId: string
  channel: Channel
  outcome: Outcome
  notes: string
  createdAt: string
}

export interface LeadList {
  id: string
  name: string
  createdAt: string
  createdBy: string
}

export type NewLead = Omit<
  Lead,
  'id' | 'listId' | 'status' | 'attempts' | 'lastActivityAt' | 'lastActivityBy' | 'claimedBy' | 'claimedAt'
>
