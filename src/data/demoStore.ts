import type { Activity, Lead, LeadList, Member, Role } from '../types'
import { STATUS } from '../lib/dispositions'
import { activeClaim } from '../lib/leads'
import { buildSample, sampleNote, SAMPLE_MEMBERS } from './sample'
import type { Snapshot, Store } from './store'

const KEY = 'knockroute-demo-v3'
const SIM_KEY = 'knockroute-demo-sim'

interface Saved {
  meId: string | null
  role: Role
  members: Member[]
  leads: Lead[]
  activities: Activity[]
  lists: LeadList[]
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...(JSON.parse(raw) as Saved), members: SAMPLE_MEMBERS }
  } catch {
    /* storage unavailable: fall through to fresh sample */
  }
  return { meId: null, role: 'agent', members: SAMPLE_MEMBERS, ...buildSample() }
}

const uid = () => Math.random().toString(36).slice(2, 10)

/**
 * Demo mode: sample data kept in this browser. Other tabs on the same device stay
 * in sync, and simulated teammates log a disposition now and then so you can see
 * the live map update.
 */
export function createDemoStore(): Store {
  let data = load()
  let snapshot: Snapshot
  const listeners = new Set<() => void>()
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(KEY) : null

  const build = (): Snapshot => {
    const me = data.members.find((m) => m.id === data.meId)
    return {
      ready: true,
      me: me ? { ...me, role: data.role } : null,
      members: data.members,
      leads: data.leads,
      activities: data.activities,
      lists: data.lists,
      error: null,
    }
  }
  snapshot = build()

  const commit = (broadcast = true) => {
    snapshot = build()
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      /* private mode: keep going in memory */
    }
    if (broadcast) channel?.postMessage('changed')
    listeners.forEach((l) => l())
  }

  channel?.addEventListener('message', () => {
    const fresh = load()
    data = { ...fresh, meId: data.meId, role: data.role }
    commit(false)
  })

  const labelFor = (leadId: string) => {
    const l = data.leads.find((x) => x.id === leadId)
    return l ? `${l.firstName} ${l.lastName}, ${l.address}, ${l.city}` : ''
  }
  const record = (a: Activity) => {
    data.activities = [a, ...data.activities]
    data.leads = data.leads.map((l) =>
      l.id === a.leadId
        ? { ...l, status: a.outcome, attempts: l.attempts + 1, lastActivityAt: a.createdAt, lastActivityBy: a.memberId }
        : l,
    )
  }

  // Simulated teammates.
  let simOn = (() => {
    try {
      return localStorage.getItem(SIM_KEY) !== 'off'
    } catch {
      return true
    }
  })()
  const tick = () => {
    if (simOn && data.meId && document.visibilityState === 'visible') {
      const open = data.leads.filter(
        (l) => !STATUS[l.status].closed && l.lat != null && (!activeClaim(l) || activeClaim(l) !== data.meId),
      )
      const others = data.members.filter((m) => m.id !== data.meId)
      if (open.length && others.length) {
        const lead = open[Math.floor(Math.random() * open.length)]
        const who = others[Math.floor(Math.random() * Math.min(others.length, 10))]
        const outcomes = ['no_answer', 'no_answer', 'no_answer', 'follow_up', 'appointment', 'not_interested'] as const
        const outcome = outcomes[Math.floor(Math.random() * outcomes.length)]
        record({
          id: uid(),
          leadId: lead.id,
          leadLabel: labelFor(lead.id),
          memberId: who.id,
          channel: 'door',
          outcome,
          notes: sampleNote(outcome),
          createdAt: new Date().toISOString(),
        })
        commit()
      }
    }
    setTimeout(tick, 35_000 + Math.random() * 40_000)
  }
  setTimeout(tick, 20_000)

  return {
    mode: 'demo',
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    signInAs(memberId, role) {
      data.meId = memberId
      data.role = role
      commit(false)
    },
    async signOut() {
      data.meId = null
      commit(false)
    },
    async history(leadId) {
      return data.activities.filter((a) => a.leadId === leadId)
    },
    async logActivity(leadId, outcome, notes) {
      if (!data.meId) return
      if (outcome !== 'no_answer' && !notes.trim()) throw new Error('Add a note before submitting')
      record({ id: uid(), leadId, leadLabel: labelFor(leadId), memberId: data.meId, channel: 'door', outcome, notes, createdAt: new Date().toISOString() })
      commit()
    },
    async activitiesBetween(from, to) {
      const a = from.toISOString()
      const b = to.toISOString()
      return data.activities.filter((x) => x.createdAt >= a && x.createdAt < b)
    },
    async claim(ids, on) {
      const set = new Set(ids)
      const at = new Date().toISOString()
      data.leads = data.leads.map((l) =>
        set.has(l.id) ? { ...l, claimedBy: on ? data.meId : null, claimedAt: on ? at : null } : l,
      )
      commit()
    },
    async assign(ids, memberId) {
      const set = new Set(ids)
      data.leads = data.leads.map((l) => (set.has(l.id) ? { ...l, assignedTo: memberId } : l))
      commit()
    },
    async importList(name, leads) {
      let list = data.lists.find((l) => l.name.trim().toLowerCase() === name.trim().toLowerCase())
      if (!list) {
        list = { id: `list-${uid()}`, name, createdAt: new Date().toISOString(), createdBy: data.meId ?? '' }
        data.lists = [list, ...data.lists]
      }
      const listId = list.id
      data.leads = [
        ...data.leads,
        ...leads.map((l) => ({
          ...l,
          id: `lead-${uid()}`,
          listId,
          status: 'new' as const,
          attempts: 0,
          lastActivityAt: null,
          lastActivityBy: null,
          claimedBy: null,
          claimedAt: null,
        })),
      ]
      commit()
    },
    async deleteLeads(ids) {
      const gone = new Set(ids)
      data.leads = data.leads.filter((l) => !gone.has(l.id))
      data.activities = data.activities.map((a) => (gone.has(a.leadId) ? { ...a, leadId: '' } : a))
      commit()
    },
    async getSetting(name) {
      try {
        return localStorage.getItem(`knockroute-demo-setting-${name}`) ?? ''
      } catch {
        return ''
      }
    },
    async setSetting(name, value) {
      try {
        localStorage.setItem(`knockroute-demo-setting-${name}`, value)
      } catch {
        /* ignore */
      }
    },
    async canDeleteLeadsSafely() {
      return true
    },
    async updateLeads(changes) {
      const byId = new Map(changes.map((c) => [c.id, c]))
      data.leads = data.leads.map((l) => {
        const c = byId.get(l.id)
        if (!c) return l
        const { id: _id, ...patch } = c
        return { ...l, ...patch }
      })
      commit()
    },
    async deleteList(listId) {
      const gone = new Set(data.leads.filter((l) => l.listId === listId).map((l) => l.id))
      data.lists = data.lists.filter((l) => l.id !== listId)
      data.leads = data.leads.filter((l) => !gone.has(l.id))
      data.activities = data.activities.filter((a) => !gone.has(a.leadId))
      commit()
    },
    resetDemo() {
      const { meId, role } = data
      data = { meId, role, members: SAMPLE_MEMBERS, ...buildSample() }
      commit()
    },
    simulateTeam: {
      get: () => simOn,
      set(on) {
        simOn = on
        try {
          localStorage.setItem(SIM_KEY, on ? 'on' : 'off')
        } catch {
          /* ignore */
        }
        listeners.forEach((l) => l())
      },
    },
  }
}
