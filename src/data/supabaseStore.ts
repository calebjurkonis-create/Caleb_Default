import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Activity, Lead, LeadList, LeadStatus, Member, Role } from '../types'
import type { Snapshot, Store } from './store'

type Row = Record<string, any>

const toLead = (r: Row): Lead => ({
  id: r.id,
  listId: r.list_id,
  prefix: r.prefix,
  firstName: r.first_name,
  lastName: r.last_name,
  address: r.address,
  city: r.city,
  state: r.state,
  zip: r.zip,
  county: r.county,
  phone: r.phone,
  dob: r.dob,
  lat: r.lat,
  lng: r.lng,
  status: r.status as LeadStatus,
  attempts: r.attempts,
  lastActivityAt: r.last_activity_at,
  lastActivityBy: r.last_activity_by,
  assignedTo: r.assigned_to,
  claimedBy: r.claimed_by,
  claimedAt: r.claimed_at,
})

const toActivity = (r: Row): Activity => ({
  id: r.id,
  leadId: r.lead_id,
  memberId: r.member_id,
  channel: r.channel,
  outcome: r.outcome,
  notes: r.notes,
  createdAt: r.created_at,
})

const toMember = (r: Row): Member => ({ id: r.id, name: r.name, role: r.role as Role })
const toList = (r: Row): LeadList => ({ id: r.id, name: r.name, createdAt: r.created_at, createdBy: r.created_by })

const RECENT_DAYS = 14
const PAGE = 1000

async function selectAll(sb: SupabaseClient, table: string, build?: (q: any) => any): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select('*')
    if (build) q = build(q)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

/** Live mode: shared team data in Supabase, pushed to every phone as it changes. */
export function createSupabaseStore(url: string, anonKey: string): Store {
  const sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  const listeners = new Set<() => void>()
  let snapshot: Snapshot = { ready: false, me: null, members: [], leads: [], activities: [], lists: [], error: null }
  let leads = new Map<string, Lead>()
  let channel: ReturnType<SupabaseClient['channel']> | null = null
  let userId: string | null = null

  const emit = (patch: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((l) => l())
  }
  let leadsTimer: ReturnType<typeof setTimeout> | null = null
  const emitLeads = () => {
    if (leadsTimer) return
    leadsTimer = setTimeout(() => {
      leadsTimer = null
      emit({ leads: [...leads.values()] })
    }, 150)
  }
  const fail = (err: unknown) => emit({ ready: true, error: (err as Error)?.message ?? String(err) })

  async function loadAll() {
    if (!userId) return
    try {
      const since = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString()
      const [members, leadRows, acts, lists] = await Promise.all([
        selectAll(sb, 'profiles'),
        selectAll(sb, 'leads'),
        selectAll(sb, 'activities', (q) => q.gte('created_at', since).order('created_at', { ascending: false })),
        selectAll(sb, 'lead_lists', (q) => q.order('created_at', { ascending: false })),
      ])
      leads = new Map(leadRows.map((r) => [r.id, toLead(r)]))
      const memberList = members.map(toMember)
      emit({
        ready: true,
        error: null,
        me: memberList.find((m) => m.id === userId) ?? null,
        members: memberList,
        leads: [...leads.values()],
        activities: acts.map(toActivity),
        lists: lists.map(toList),
      })
    } catch (err) {
      fail(err)
    }
  }

  function subscribeLive() {
    channel?.unsubscribe()
    channel = sb
      .channel('team')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (p) => {
        if (p.eventType === 'DELETE') leads.delete((p.old as Row).id)
        else leads.set((p.new as Row).id, toLead(p.new as Row))
        emitLeads()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities' }, (p) => {
        const a = toActivity(p.new as Row)
        if (!snapshot.activities.some((x) => x.id === a.id)) emit({ activities: [a, ...snapshot.activities] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => loadAll())
      .subscribe()
  }

  async function onSession(id: string | null) {
    userId = id
    if (!id) {
      channel?.unsubscribe()
      channel = null
      leads = new Map()
      emit({ ready: true, me: null, members: [], leads: [], activities: [], lists: [] })
      return
    }
    await loadAll()
    subscribeLive()
  }

  sb.auth.getSession().then(({ data }) => onSession(data.session?.user.id ?? null))
  sb.auth.onAuthStateChange((_e, session) => {
    const id = session?.user.id ?? null
    if (id !== userId) onSession(id)
  })

  // Catch anything missed while the phone was asleep or a lead was reassigned away.
  // Live updates keep the map current. A full reload (several MB with a big list) only
  // runs after the app sat in the background a while, and as a slow safety net.
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (hiddenAt && Date.now() - hiddenAt > 3 * 60_000) loadAll()
  })
  setInterval(() => document.visibilityState === 'visible' && loadAll(), 30 * 60_000)

  const check = <T,>(r: { error: unknown; data?: T | null }) => {
    if (r.error) throw r.error
    return r.data as T
  }

  return {
    mode: 'live',
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    async signInWithPassword(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    async changePassword(password) {
      const { error } = await sb.auth.updateUser({ password })
      if (error) throw error
    },
    async signOut() {
      await sb.auth.signOut()
    },
    async history(leadId) {
      const rows = check<Row[]>(
        await sb.from('activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
      )
      return rows.map(toActivity)
    },
    async logActivity(leadId, outcome, notes) {
      if (!notes.trim()) throw new Error('Add a note before submitting')
      const row = check<Row>(
        await sb.from('activities').insert({ lead_id: leadId, channel: 'door', outcome, notes }).select().single(),
      )
      // Show it right away; the live update confirms it for everyone else.
      const a = toActivity(row)
      const l = leads.get(leadId)
      if (l) {
        leads.set(leadId, { ...l, status: outcome, attempts: l.attempts + 1, lastActivityAt: a.createdAt, lastActivityBy: a.memberId })
      }
      emit({ activities: [a, ...snapshot.activities.filter((x) => x.id !== a.id)], leads: [...leads.values()] })
    },
    async activitiesBetween(from, to) {
      const rows = await selectAll(sb, 'activities', (q) =>
        q.gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).order('created_at', { ascending: false }),
      )
      return rows.map(toActivity)
    },
    async claim(ids, on) {
      check(await sb.rpc('claim_leads', { lead_ids: ids, claim: on }))
      const at = new Date().toISOString()
      for (const id of ids) {
        const l = leads.get(id)
        if (l) leads.set(id, { ...l, claimedBy: on ? userId : null, claimedAt: on ? at : null })
      }
      emitLeads()
    },
    async assign(ids, memberId) {
      for (let i = 0; i < ids.length; i += 500) {
        check(await sb.from('leads').update({ assigned_to: memberId }).in('id', ids.slice(i, i + 500)))
      }
      for (const id of ids) {
        const l = leads.get(id)
        if (l) leads.set(id, { ...l, assignedTo: memberId })
      }
      emitLeads()
    },
    async importList(name, rows) {
      // Same list name = keep adding to that list (this is how an interrupted import resumes).
      let list = snapshot.lists.find((l) => l.name.trim().toLowerCase() === name.trim().toLowerCase())
      if (!list) {
        list = toList(check<Row>(await sb.from('lead_lists').insert({ name, created_by: userId }).select().single()))
        emit({ lists: [list, ...snapshot.lists] })
      }
      for (let i = 0; i < rows.length; i += 500) {
        const inserted = check<Row[]>(
          await sb
            .from('leads')
            .insert(
              rows.slice(i, i + 500).map((l) => ({
                list_id: list!.id,
                prefix: l.prefix,
                first_name: l.firstName,
                last_name: l.lastName,
                address: l.address,
                city: l.city,
                state: l.state,
                zip: l.zip,
                county: l.county,
                phone: l.phone,
                dob: l.dob,
                lat: l.lat,
                lng: l.lng,
                assigned_to: l.assignedTo,
              })),
            )
            .select(),
        )
        for (const r of inserted) leads.set(r.id, toLead(r))
        emitLeads()
      }
    },
    async deleteList(listId) {
      check(await sb.from('lead_lists').delete().eq('id', listId))
      await loadAll()
    },
    async renameMember(memberId, name) {
      check(await sb.from('profiles').update({ name }).eq('id', memberId))
      await loadAll()
    },
    async setRole(memberId, role) {
      check(await sb.from('profiles').update({ role }).eq('id', memberId))
      await loadAll()
    },
  }
}
