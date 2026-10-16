import type { Activity, GatedZone, Lead, LeadList, Member, Role } from '../types'
import { DATED, STATUS } from '../lib/dispositions'
import { currentItems } from '../lib/agenda'
import { activeClaim } from '../lib/leads'
import { buildSample, sampleNote, SAMPLE_MEMBERS } from './sample'
import type { Snapshot, Store } from './store'

const SIM_KEY = 'knockroute-demo-sim'

interface Saved {
  meId: string | null
  role: Role
  members: Member[]
  leads: Lead[]
  activities: Activity[]
  lists: LeadList[]
  zones?: GatedZone[]
}

const uid = () => Math.random().toString(36).slice(2, 10)

export interface DemoOptions {
  /**
   * A guest trial (the /demo link): signed in as this person as a manager, starting
   * empty (no sample leads, no simulated teammates), saved under its own key.
   */
  guestName?: string
}

/**
 * Demo mode: data kept in this browser only. The team demo has sample leads and
 * simulated teammates; the guest demo starts empty for someone to try with their own list.
 */
export function createDemoStore(opts: DemoOptions = {}): Store {
  const guest = opts.guestName
  const KEY = guest ? 'knockroute-guest-v1' : 'knockroute-demo-v4'
  const MEMBERS: Member[] = guest ? [{ id: 'm-guest', name: guest, role: 'manager' }] : SAMPLE_MEMBERS
  const fresh = (): Saved =>
    guest
      ? { meId: 'm-guest', role: 'manager', members: MEMBERS, leads: [], activities: [], lists: [] }
      : { meId: null, role: 'agent', members: MEMBERS, ...buildSample() }
  const load = (): Saved => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return { ...(JSON.parse(raw) as Saved), members: MEMBERS }
    } catch {
      /* storage unavailable: start fresh */
    }
    return fresh()
  }

  let data = load()
  let snapshot: Snapshot
  let itemsVersion = 0
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
      zones: data.zones ?? [],
      zonesReady: true,
      agendaReady: true,
      canSetDates: true,
      itemsVersion,
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
        ? { ...l, status: a.outcome, attempts: l.attempts + (a.channel === 'update' ? 0 : 1), lastActivityAt: a.createdAt, lastActivityBy: a.memberId }
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
          dueAt: outcome === 'follow_up' || outcome === 'appointment' ? new Date(Date.now() + (1 + Math.floor(Math.random() * 5)) * 86400_000).toISOString() : null,
          resolvedAt: null,
          resolution: null,
          createdAt: new Date().toISOString(),
        })
        commit()
      }
    }
    setTimeout(tick, 35_000 + Math.random() * 40_000)
  }
  if (!guest) setTimeout(tick, 20_000)

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
    async logActivity(leadId, outcome, notes, dueAt) {
      if (!data.meId) return
      if (outcome !== 'no_answer' && !notes.trim()) throw new Error('Add a note before submitting')
      // A new knock on this door closes any earlier open item for it.
      const now = new Date().toISOString()
      data.activities = data.activities.map((a) =>
        a.leadId === leadId && DATED.includes(a.outcome) && !a.resolvedAt ? { ...a, resolvedAt: now, resolution: outcome } : a,
      )
      record({
        id: uid(), leadId, leadLabel: labelFor(leadId), memberId: data.meId, channel: 'door', outcome, notes, createdAt: now,
        dueAt: dueAt ?? null, resolvedAt: null, resolution: null,
      })
      commit()
    },
    async openItems() {
      return currentItems(data.activities, new Map(data.leads.map((l) => [l.id, l])))
    },
    async addZone(z) {
      if (data.role !== 'manager') throw new Error('Only managers can mark gated areas.')
      if (z.osmId && (data.zones ?? []).some((x) => x.osmId === z.osmId)) return
      const zone: GatedZone = {
        id: uid(), name: z.name, points: z.points, source: z.source ?? 'drawn', osmId: z.osmId ?? null,
        status: z.status ?? 'active', createdBy: data.meId, createdAt: new Date().toISOString(),
      }
      data.zones = [...(data.zones ?? []), zone]
      commit()
    },
    async renameZone(id, name) {
      if (data.role !== 'manager') throw new Error('Only managers can rename gated areas.')
      data.zones = (data.zones ?? []).map((z) => (z.id === id ? { ...z, name } : z))
      commit()
    },
    async deleteZone(id) {
      if (data.role !== 'manager') throw new Error('Only managers can remove gated areas.')
      data.zones = (data.zones ?? []).filter((z) => z.id !== id)
      commit()
    },
    async setDue(itemId, dueAt) {
      const item = data.activities.find((a) => a.id === itemId)
      if (!item || item.resolvedAt || !data.meId) throw new Error('That follow-up or appointment was already updated.')
      if (item.memberId !== data.meId && data.role !== 'manager') throw new Error('Only the agent who set it, or a manager, can change its date.')
      data.activities = data.activities.map((a) => (a.id === itemId ? { ...a, dueAt } : a))
      itemsVersion++
      commit()
    },
    async resolveItem(itemId, result, notes, nextDueAt) {
      const item = data.activities.find((a) => a.id === itemId)
      if (!item || !data.meId) throw new Error('That item no longer exists.')
      if (item.memberId !== data.meId && data.role !== 'manager') throw new Error('Only the agent who set it, or a manager, can update it.')
      const now = new Date().toISOString()
      data.activities = data.activities.map((a) => (a.id === itemId ? { ...a, resolvedAt: now, resolution: result } : a))
      record({
        id: uid(), leadId: item.leadId, leadLabel: item.leadLabel, memberId: data.meId, channel: 'update', outcome: result,
        notes, createdAt: now, dueAt: nextDueAt ?? null, resolvedAt: null, resolution: null,
      })
      itemsVersion++
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
      data = { ...fresh(), meId: meId ?? fresh().meId, role }
      commit()
    },
    simulateTeam: guest ? undefined : {
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
