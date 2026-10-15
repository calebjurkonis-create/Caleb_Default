import type { LeadStatus, Outcome } from '../types'

interface StatusInfo {
  label: string
  /** CSS custom property holding the pin color. */
  color: string
  /** Finished leads drop out of route planning by default. */
  closed: boolean
}

export const STATUS: Record<LeadStatus, StatusInfo> = {
  new: { label: 'Not worked', color: 'var(--st-new)', closed: false },
  no_answer: { label: 'No Answer/Not Home', color: 'var(--st-noanswer)', closed: false },
  left_note: { label: 'Left VM/Note', color: 'var(--st-note)', closed: false },
  follow_up: { label: 'Follow-Up', color: 'var(--st-follow)', closed: false },
  info_requested: { label: 'Info Requested', color: 'var(--st-info)', closed: false },
  appointment: { label: 'Appointment', color: 'var(--st-appt)', closed: true },
  not_interested: { label: 'Not Interested', color: 'var(--st-notint)', closed: true },
  bad_info: { label: 'Bad Info', color: 'var(--st-bad)', closed: true },
}

/** Same order as the OSCR dropdown. */
export const OUTCOMES: Outcome[] = [
  'no_answer',
  'left_note',
  'appointment',
  'follow_up',
  'not_interested',
  'info_requested',
  'bad_info',
]

export const STATUS_ORDER: LeadStatus[] = ['new', ...OUTCOMES]

/** Resolves a status color token to a concrete color (Leaflet canvas markers need real values). */
export function statusColor(status: LeadStatus): string {
  const token = STATUS[status].color.slice(4, -1)
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#888'
}
