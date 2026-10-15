import type { Activity, Lead, LeadList, Member, Outcome } from '../types'

/** Everyone on the office board, plus Christian and Nico. Demo only. */
const TEAM = [
  'Moose', 'Albert', 'Caleb', 'Johnny', 'Tina', 'Jad', 'Dari', 'Jesuel', 'Arban', 'Lauryn', 'Bati',
  'Justin', 'Haleigh', 'Luis', 'JA', 'Lis', 'John', 'Leo', 'Richard', 'Christian', 'Nico',
]
const MANAGERS = new Set(['Caleb', 'Albert', 'Moose', 'Arban', 'Tina'])
// Keeps ids from the first demo build so existing sample history still points at the right person.
const LEGACY_IDS: Record<string, string> = { Jesuel: 'm-jessuel', Arban: 'm-arham' }

export const SAMPLE_MEMBERS: Member[] = TEAM.map((name) => ({
  id: LEGACY_IDS[name] ?? `m-${name.toLowerCase()}`,
  name,
  role: MANAGERS.has(name) ? 'manager' : 'agent',
}))

// Small seeded PRNG so the sample map looks the same on every phone.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const FIRST_F = ['Linda', 'Patricia', 'Barbara', 'Susan', 'Karen', 'Donna', 'Sandra', 'Carol', 'Debra', 'Sharon',
  'Brenda', 'Pamela', 'Cynthia', 'Deborah', 'Teresa', 'Gloria', 'Maria', 'Carmen', 'Diane', 'Janet', 'Rosa', 'Denise']
const FIRST_M = ['Robert', 'James', 'Michael', 'David', 'William', 'Richard', 'Thomas', 'Charles', 'Joseph', 'Gary',
  'Kenneth', 'Steven', 'Ronald', 'Larry', 'Dennis', 'Jose', 'Luis', 'Raymond', 'Gregory', 'Frank', 'Wayne']
const LAST = ['Alvarez', 'Bennett', 'Carter', 'Delgado', 'Ellison', 'Foster', 'Garcia', 'Harmon', 'Ingram', 'Jensen',
  'Keller', 'Lawson', 'Medina', 'Nolan', 'Ortiz', 'Prescott', 'Quinn', 'Rivera', 'Sandoval', 'Thornton', 'Underwood',
  'Vasquez', 'Whitaker', 'Young', 'Zamora', 'Brooks', 'Castillo', 'Dunn', 'Fleming', 'Gibson', 'Holt', 'Marsh']
const STREETS = ['Heron Bay Dr', 'Cypress Hollow Ln', 'Palmetto Ridge Ct', 'Osprey Pointe Way', 'Live Oak Loop',
  'Sandhill Crane Rd', 'Magnolia Bend Dr', 'Lakeshore Vista Ct', 'Citrus Grove Ln', 'Sawgrass Run',
  'Pine Needle Pl', 'Bay Harbor Cir', 'Moss Creek Dr', 'Willow Glen Way', 'Kingfisher Ct']

const AREAS = [
  { city: 'Celebration', zip: '34747', county: 'Osceola', lat: 28.3195, lng: -81.5405, n: 30 },
  { city: 'Kissimmee', zip: '34744', county: 'Osceola', lat: 28.3005, lng: -81.3830, n: 30 },
  { city: 'Orlando', zip: '32837', county: 'Orange', lat: 28.3640, lng: -81.4235, n: 30 },
  { city: 'Orlando', zip: '32804', county: 'Orange', lat: 28.5690, lng: -81.3950, n: 25 },
  { city: 'Winter Garden', zip: '34787', county: 'Orange', lat: 28.5520, lng: -81.5880, n: 25 },
  { city: 'Clermont', zip: '34711', county: 'Lake', lat: 28.5400, lng: -81.7600, n: 25 },
]

const OUTCOME_MIX: Outcome[] = ['no_answer', 'no_answer', 'no_answer', 'no_answer', 'follow_up', 'follow_up',
  'appointment', 'not_interested', 'not_interested', 'bad_info']

export function buildSample(now = new Date()): { leads: Lead[]; activities: Activity[]; lists: LeadList[] } {
  const r = rng(65)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const list: LeadList = {
    id: 'list-sample',
    name: 'Sample leads (not real people)',
    createdAt: new Date(now.getTime() - 5 * 86400_000).toISOString(),
    createdBy: SAMPLE_MEMBERS[0].id,
  }
  const leads: Lead[] = []
  const activities: Activity[] = []
  let n = 0
  for (const area of AREAS) {
    const street = [pick(STREETS), pick(STREETS), pick(STREETS)]
    for (let i = 0; i < area.n; i++) {
      n++
      // Born Nov 1961 – Apr 1962, so they turn 65 over the next six months.
      const born = new Date(1961, 10 + Math.floor(r() * 6), 1)
      const female = r() < 0.55
      const lead: Lead = {
        id: `lead-${n}`,
        listId: list.id,
        prefix: female ? pick(['Ms', 'Mrs']) : 'Mr',
        firstName: female ? pick(FIRST_F) : pick(FIRST_M),
        lastName: pick(LAST),
        address: `${100 + Math.floor(r() * 9800)} ${pick(street)}`,
        city: area.city,
        state: 'FL',
        zip: area.zip,
        county: area.county,
        phone: r() < 0.4 ? `407555${String(Math.floor(r() * 10000)).padStart(4, '0')}` : '',
        dob: `${born.getFullYear()}${String(born.getMonth() + 1).padStart(2, '0')}`,
        lat: area.lat + (r() - 0.5) * 0.03,
        lng: area.lng + (r() - 0.5) * 0.035,
        status: 'new',
        attempts: 0,
        lastActivityAt: null,
        lastActivityBy: null,
        pinApprox: false,
        assignedTo: null,
        claimedBy: null,
        claimedAt: null,
      }
      // About a third of the sample leads already have history.
      if (r() < 0.35) {
        const tries = 1 + Math.floor(r() * 2)
        for (let t = 0; t < tries; t++) {
          const at = new Date(now.getTime() - Math.floor(r() * 4 * 86400_000) - 3600_000)
          const member = pick(SAMPLE_MEMBERS.slice(0, 12))
          const outcome = pick(OUTCOME_MIX)
          activities.push({
            id: `act-${n}-${t}`,
            leadId: lead.id,
            leadLabel: `${lead.firstName} ${lead.lastName}, ${lead.address}, ${lead.city}`,
            memberId: member.id,
            channel: 'door',
            outcome,
            notes: sampleNote(outcome, r),
            createdAt: at.toISOString(),
          })
        }
      }
      leads.push(lead)
    }
  }
  activities.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const a of activities) {
    const l = leads.find((x) => x.id === a.leadId)!
    l.status = a.outcome
    l.attempts++
    l.lastActivityAt = a.createdAt
    l.lastActivityBy = a.memberId
  }
  return { leads, activities: activities.reverse(), lists: [list] }
}

const NOTES: Partial<Record<Outcome, string[]>> = {
  no_answer: ['Car in driveway, no answer', 'Gated, try weekend', 'Dog barking, nobody came', 'Left door hanger'],
  left_note: ['Left door hanger with card', 'Left VM, call back after 5', 'Note left in door'],
  follow_up: ['Spouse home, husband back Thursday', 'Busy cooking, come back after 6', 'Wants us to swing by next week'],
  appointment: ['Set for Tue 10am at kitchen table', 'Appt Sat 11am, bring Med Supp quotes'],
  not_interested: ['Has coverage through former employer', 'Not interested, polite'],
  info_requested: ['Wants info mailed first', 'Asked for brochure on Part D'],
  bad_info: ['Moved, new owners', 'House vacant / for sale'],
}

export function sampleNote(o: Outcome, r: () => number = Math.random): string {
  const opts = NOTES[o] ?? ['']
  return opts[Math.floor(r() * opts.length)]
}
