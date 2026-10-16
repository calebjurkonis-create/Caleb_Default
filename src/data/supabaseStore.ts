import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Activity, GatedZone, Lead, LeadList, LeadStatus, Member, Role } from '../types'
import type { Snapshot, Store } from './store'
import { DATED } from '../lib/dispositions'
import { currentItems } from '../lib/agenda'

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
  pinApprox: !!r.pin_approx,
  status: r.status as LeadStatus,
  attempts: r.attempts,
  lastActivityAt: r.last_activity_at,
  lastActivityBy: r.last_activity_by,
  assignedTo: r.assigned_to,
  claimedBy: r.claimed_by,
  claimedAt: r.claimed_at,
})

const toZone = (r: Row): GatedZone => ({
  id: r.id,
  name: r.name ?? '',
  points: Array.isArray(r.points) ? r.points : [],
  source: r.source === 'osm' ? 'osm' : 'drawn',
  osmId: r.osm_id ?? null,
  status: r.status === 'dismissed' ? 'dismissed' : 'active',
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
})
const toActivity = (r: Row): Activity => ({
  id: r.id,
  leadId: r.lead_id ?? '',
  leadLabel: r.lead_label ?? '',
  dueAt: r.due_at ?? null,
  resolvedAt: r.resolved_at ?? null,
  resolution: r.resolution ?? null,
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
  let snapshot: Snapshot = { ready: false, me: null, members: [], leads: [], activities: [], lists: [], error: null, agendaReady: false, zones: [], zonesReady: false }
  let leads = new Map<string, Lead>()
  let channel: ReturnType<SupabaseClient['channel']> | null = null
  let userId: string | null = null
  // Databases set up before street-level pins existed lack this column; work without it.
  let approxColumn = true
  const missingApproxColumn = (e: unknown) => /pin_approx/.test(String((e as { message?: string })?.message ?? e))

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

  // Gated areas (update 005). Before that update the table doesn't exist: no areas.
  async function loadZones(): Promise<GatedZone[]> {
    try {
      return (await selectAll(sb, 'gated_zones', (q) => q.order('created_at', { ascending: true }))).map(toZone)
    } catch {
      return []
    }
  }

  async function loadAll() {
    if (!userId) return
    try {
      const since = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString()
      const [members, leadRows, acts, lists, version, zones] = await Promise.all([
        selectAll(sb, 'profiles'),
        selectAll(sb, 'leads'),
        selectAll(sb, 'activities', (q) => q.gte('created_at', since).order('created_at', { ascending: false })),
        selectAll(sb, 'lead_lists', (q) => q.order('created_at', { ascending: false })),
        sb.rpc('knockroute_version').then((r) => (r.error ? 0 : Number(r.data))),
        loadZones(),
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
        agendaReady: version >= 4,
        canSetDates: version >= 5,
        zonesReady: version >= 6,
        zones,
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
        if (p.eventType === 'DELETE') {
          const id = (p.old as Row).id
          leads.delete(id)
          if (snapshot.activities.some((a) => a.leadId === id)) {
            emit({ activities: snapshot.activities.map((a) => (a.leadId === id ? { ...a, leadId: '' } : a)) })
          }
        }
        else leads.set((p.new as Row).id, toLead(p.new as Row))
        emitLeads()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities' }, (p) => {
        const a = toActivity(p.new as Row)
        if (!snapshot.activities.some((x) => x.id === a.id)) emit({ activities: [a, ...snapshot.activities] })
      })
      // Follow-ups/appointments being updated (booked, sold…) arrive as updates.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'activities' }, (p) => {
        const a = toActivity(p.new as Row)
        const has = snapshot.activities.some((x) => x.id === a.id)
        emit({ activities: has ? snapshot.activities.map((x) => (x.id === a.id ? a : x)) : [a, ...snapshot.activities], itemsVersion: (snapshot.itemsVersion ?? 0) + 1 })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gated_zones' }, async () => emit({ zones: await loadZones() }))
      .subscribe()
  }

  async function onSession(id: string | null, tempPassword = false) {
    userId = id
    emit({ mustChangePassword: !!id && tempPassword })
    if (!id) {
      channel?.unsubscribe()
      channel = null
      leads = new Map()
      emit({ ready: true, me: null, members: [], leads: [], activities: [], lists: [], zones: [] })
      return
    }
    await loadAll()
    subscribeLive()
  }

  const isTemp = (u: { user_metadata?: Record<string, unknown> } | undefined) => u?.user_metadata?.temp_password === true
  sb.auth.getSession().then(({ data }) => onSession(data.session?.user.id ?? null, isTemp(data.session?.user)))
  sb.auth.onAuthStateChange((_e, session) => {
    const id = session?.user.id ?? null
    if (id !== userId) onSession(id, isTemp(session?.user))
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
    async setOwnPassword(password) {
      const { error } = await sb.auth.updateUser({ password, data: { temp_password: false } })
      if (error) throw error
      emit({ mustChangePassword: false })
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
    async logActivity(leadId, outcome, notes, dueAt) {
      if (outcome !== 'no_answer' && !notes.trim()) throw new Error('Add a note before submitting')
      const row = check<Row>(
        await sb
          .from('activities')
          .insert({ lead_id: leadId, channel: 'door', outcome, notes, ...(dueAt && snapshot.agendaReady ? { due_at: dueAt } : {}) })
          .select()
          .single(),
      )
      // Show it right away; the live update confirms it for everyone else.
      const a = toActivity(row)
      const l = leads.get(leadId)
      if (l) {
        leads.set(leadId, { ...l, status: outcome, attempts: l.attempts + 1, lastActivityAt: a.createdAt, lastActivityBy: a.memberId })
      }
      emit({ activities: [a, ...snapshot.activities.filter((x) => x.id !== a.id)], leads: [...leads.values()] })
    },
    async openItems() {
      // Before update 004 there are no dates or updates yet, but follow-ups and appointments
      // already logged still show (as undated).
      const rows = await selectAll(sb, 'activities', (q) => {
        const base = q.in('outcome', DATED).not('lead_id', 'is', null)
        return snapshot.agendaReady ? base.is('resolved_at', null) : base
      })
      return currentItems(rows.map(toActivity), leads)
    },
    async addZone(z) {
      check(
        await sb.from('gated_zones').insert({
          name: z.name, points: z.points, source: z.source ?? 'drawn', osm_id: z.osmId ?? null, status: z.status ?? 'active',
        }),
      )
      emit({ zones: await loadZones() })
    },
    async deleteZone(id) {
      check(await sb.from('gated_zones').delete().eq('id', id))
      emit({ zones: snapshot.zones.filter((z) => z.id !== id) })
    },
    async setDue(itemId, dueAt) {
      check(await sb.rpc('set_due', { item: itemId, due: dueAt }))
      const has = snapshot.activities.some((a) => a.id === itemId)
      emit({
        activities: has ? snapshot.activities.map((a) => (a.id === itemId ? { ...a, dueAt } : a)) : snapshot.activities,
        itemsVersion: (snapshot.itemsVersion ?? 0) + 1,
      })
    },
    async resolveItem(itemId, result, notes, nextDueAt) {
      check(await sb.rpc('resolve_item', { item: itemId, result, note: notes, next_due: nextDueAt ?? null }))
      await loadAll()
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
        const insertBatch = async () =>
          check<Row[]>(
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
                  ...(approxColumn ? { pin_approx: l.pinApprox } : {}),
                  assigned_to: l.assignedTo,
                })),
              )
              .select(),
          )
        let inserted: Row[]
        try {
          inserted = await insertBatch()
        } catch (e) {
          if (!approxColumn || !missingApproxColumn(e)) throw e
          approxColumn = false
          inserted = await insertBatch()
        }
        for (const r of inserted) leads.set(r.id, toLead(r))
        emitLeads()
      }
    },
    async deleteLeads(ids) {
      for (let i = 0; i < ids.length; i += 150) {
        check(await sb.from('leads').delete().in('id', ids.slice(i, i + 150)))
      }
      const gone = new Set(ids)
      for (const id of ids) leads.delete(id)
      emit({
        leads: [...leads.values()],
        activities: snapshot.activities.map((a) => (gone.has(a.leadId) ? { ...a, leadId: '' } : a)),
      })
    },
    async getSetting(name) {
      const { data, error } = await sb.from('app_settings').select('value').eq('name', name).maybeSingle()
      return error ? '' : ((data?.value as string) ?? '')
    },
    async setSetting(name, value) {
      const { error } = await sb.from('app_settings').upsert({ name, value, updated_at: new Date().toISOString() })
      if (error) {
        throw new Error(
          /app_settings/.test(error.message)
            ? 'The database needs a one-time update first (supabase/updates/003). See the setup steps.'
            : error.message,
        )
      }
    },
    async canDeleteLeadsSafely() {
      // Added by the one-time update that makes removed leads keep their history.
      const { data, error } = await sb.rpc('knockroute_version')
      return !error && Number(data) >= 2
    },
    async updateLeads(changes) {
      for (const c of changes) {
        const row: Row = {}
        if (c.address !== undefined) row.address = c.address
        if (c.city !== undefined) row.city = c.city
        if (c.zip !== undefined) row.zip = c.zip
        if (c.lat !== undefined) row.lat = c.lat
        if (c.lng !== undefined) row.lng = c.lng
        if (c.pinApprox !== undefined && approxColumn) row.pin_approx = c.pinApprox
        try {
          check(await sb.from('leads').update(row).eq('id', c.id))
        } catch (e) {
          if (!('pin_approx' in row) || !missingApproxColumn(e)) throw e
          approxColumn = false
          delete row.pin_approx
          check(await sb.from('leads').update(row).eq('id', c.id))
        }
        const l = leads.get(c.id)
        if (l) {
          const { id: _id, ...patch } = c
          leads.set(c.id, { ...l, ...patch })
        }
      }
      emitLeads()
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
