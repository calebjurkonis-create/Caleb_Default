export type Role = 'agent' | 'manager'

export interface Member {
  id: string
  name: string
  role: Role
}

/** 'update' = a status change on an earlier follow-up/appointment (not a door knock). */
export type Channel = 'door' | 'phone' | 'update'

/** Mirrors the "Next disposition" list in OSCR. */
export type Outcome =
  | 'no_answer'
  | 'left_note'
  | 'appointment'
  | 'follow_up'
  | 'not_interested'
  | 'info_requested'
  | 'bad_info'
  /** Only reached by updating an appointment, never on a door knock. */
  | 'sold'

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
  /** True when the pin marks the street, not the exact house (new builds the map services don't know yet). */
  pinApprox: boolean
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
  /** Empty once the lead itself has been removed; leadLabel keeps who it was. */
  leadId: string
  /** "First Last, Address, City" captured when the visit was logged. */
  leadLabel: string
  memberId: string
  channel: Channel
  outcome: Outcome
  notes: string
  createdAt: string
  /** Follow-ups and appointments: when it's due. */
  dueAt: string | null
  /** Set once the follow-up/appointment has been updated (booked, sold, not interested…). */
  resolvedAt: string | null
  resolution: Outcome | null
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

/** A gated community marked on the map. Leads inside stay routable; it's a heads-up only. */
export interface GatedZone {
  id: string
  name: string
  /** [lat, lng] around the area. */
  points: [number, number][]
  /** Drawn by a manager, or confirmed from an OpenStreetMap suggestion. */
  source: 'drawn' | 'osm'
  osmId: string | null
  /** 'dismissed' = a suggestion a manager said isn't gated; never shown, only kept so it isn't suggested again. */
  status: 'active' | 'dismissed'
  createdBy: string | null
  createdAt: string
}

export type NewZone = Pick<GatedZone, 'name' | 'points'> & Partial<Pick<GatedZone, 'source' | 'osmId' | 'status'>>
