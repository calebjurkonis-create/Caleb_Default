#!/usr/bin/env node
/**
 * KnockRoute → Therisma one-time copy.
 *
 * Reads the KnockRoute export file made by extract.sql. It never connects to
 * KnockRoute, so KnockRoute can't be changed by it.
 *
 * Three modes, safest first:
 *
 *   1. Dry run (default). Writes nothing anywhere. Prints counts and every
 *      problem it finds (roster gaps, people who left, values with no mapping).
 *        node copy.mjs --bundle kr-bundle.json --roster roster.csv
 *
 *   2. Write the SQL to a file for review. Still touches no database.
 *        node copy.mjs --bundle kr-bundle.json --roster roster.csv \
 *          --org <therisma-org-uuid> --emit-sql therisma-copy.sql
 *
 *   3. Run it against Therisma, all in one transaction (all or nothing).
 *      Only after the pilot office has signed up and Caleb has said go.
 *        THERISMA_DATABASE_URL=... node copy.mjs --bundle kr-bundle.json \
 *          --roster roster.csv --org <uuid> --apply --caleb-said-go
 *
 * Every Therisma table and column comes from field-map.json, which is a guess
 * until checked against Therisma's schema. Modes 2 and 3 refuse to run until
 * field-map.json says "confirmed": true.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KNOCKROUTE_PROJECT = 'wybrhduekutlgsahbrqj'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** KnockRoute fields that hold a person; each becomes that person's Therisma user id. */
const PEOPLE_FIELDS = new Set(['created_by', 'owner_id', 'assigned_to', 'last_activity_by', 'member_id', 'claimed_by'])
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---------------------------------------------------------------- arguments
const args = parseArgs(process.argv.slice(2))
if (args.help || !args.bundle) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
  process.exit(args.help ? 0 : 1)
}
const mode = args.apply ? 'apply' : args['emit-sql'] ? 'emit' : 'dry-run'
const map = JSON.parse(fs.readFileSync(args.map ?? path.join(HERE, 'field-map.json'), 'utf8'))
const bundle = JSON.parse(fs.readFileSync(args.bundle, 'utf8'))

// Scope (scope.json): only these leads are copied, with their visits; lists left empty are dropped.
const scope = JSON.parse(fs.readFileSync(args.scope ?? path.join(HERE, 'scope.json'), 'utf8'))
const left = { leads: 0, visits: 0, open: 0, lists: 0 }
{
  const inScope = (x) =>
    (!scope.lead_types || scope.lead_types.includes(x.lead_type)) &&
    (!scope.birth_months || x.lead_type !== 't65' || scope.birth_months.includes(x.dob))
  const all = { leads: bundle.leads ?? [], acts: bundle.activities ?? [], lists: bundle.lists ?? [] }
  bundle.leads = all.leads.filter(inScope)
  const keep = new Set(bundle.leads.map((x) => x.id))
  bundle.activities = all.acts.filter((a) => keep.has(a.lead_id))
  const usedLists = new Set(bundle.leads.map((x) => x.list_id))
  bundle.lists = all.lists.filter((l) => usedLists.has(l.id))
  left.leads = all.leads.length - bundle.leads.length
  left.visits = all.acts.length - bundle.activities.length
  left.open = all.acts.filter((a) => !keep.has(a.lead_id) && (a.outcome === 'appointment' || a.outcome === 'follow_up') && !a.resolved_at).length
  left.lists = all.lists.length - bundle.lists.length
}
const roster = args.roster ? readRoster(args.roster) : null
const placeholderEmail = (args['former-email'] ?? map.people.former_people.placeholder_email ?? '').trim()

const problems = [] // block modes 2 and 3
const notes = [] // worth knowing, don't block
const block = (m) => problems.push(m)
const note = (m) => notes.push(m)

if (bundle.source !== 'knockroute') block('The --bundle file is not a KnockRoute export (made by extract.sql).')

// ---------------------------------------------------------------- people
const people = bundle.people ?? []
const personById = new Map(people.map((p) => [p.id, p]))
const used = usageByPerson()
/** KnockRoute person id → roster row, or 'former' (on no roster row). */
const personTarget = new Map()

if (!roster) {
  block('No --roster given, so nobody can be matched to a Therisma account yet.')
} else {
  checkRoster(roster)
  for (const p of people) {
    const r = roster.rows.find(
      (r) => (r.knockroute_name ?? '').split('|').some((n) => eq(n, p.name)) || (!r.knockroute_name && eq(r.name, p.name)) || (p.email && eq(r.email, p.email)),
    )
    personTarget.set(p.id, r ?? 'former')
  }
  const former = people.filter((p) => personTarget.get(p.id) === 'former')
  const formerWithWork = former.filter((p) => used.get(p.id)?.total)
  if (formerWithWork.length && !placeholderEmail)
    block(
      `${formerWithWork.length} people not on the roster have KnockRoute history (${formerWithWork.map((p) => p.name).join(', ')}). ` +
        'Add them to the roster, or give a placeholder account email (--former-email) to credit their visits to.',
    )
  if (placeholderEmail && !roster.rows.some((r) => eq(r.email, placeholderEmail)))
    note(`The placeholder account ${placeholderEmail} isn't on the roster; it must still be invited to the Therisma org before the copy runs.`)
}

// ---------------------------------------------------------------- lists
const t65ByMonth = map.lists.t65_lists === 'by_month'
const lists = []
const listIdFor = new Map() // lead id → list id
for (const l of bundle.lists ?? []) {
  const hasT65 = (bundle.leads ?? []).some((x) => x.list_id === l.id && x.lead_type === 't65')
  if (t65ByMonth && hasT65) continue // replaced by month lists below
  lists.push({ ...l })
}
if (t65ByMonth) {
  const months = new Map()
  for (const x of bundle.leads ?? []) {
    if (x.lead_type !== 't65') continue
    const ym = /^\d{6}$/.test(x.dob ?? '') ? x.dob : 'unknown'
    if (!months.has(ym)) {
      const name =
        ym === 'unknown' ? 'Turning 65 – birth month unknown' : `Turning 65 – ${MONTHS[+ym.slice(4) - 1]} ${+ym.slice(0, 4) + 65}`
      const owner = bundle.lists.find((l) => l.id === x.list_id)
      months.set(ym, { id: stableId(`t65-month-${ym}`), name, created_by: owner?.created_by ?? null, created_at: owner?.created_at ?? null, owner_id: null })
    }
    listIdFor.set(x.id, months.get(ym).id)
  }
  lists.push(...months.values())
}

// ---------------------------------------------------------------- leads
const leads = (bundle.leads ?? []).map((x) => ({ ...x, list_id: listIdFor.get(x.id) ?? x.list_id, dob: dob(x.dob) }))

// ---------------------------------------------------------------- dispositions & open items
const R = map.results ?? {}
const reshaped = { soldSplit: [], dateFilled: [] } // KnockRoute visits that didn't fit Therisma's results one-to-one
const activities = []
for (const a0 of bundle.activities ?? []) {
  const who = personTarget.get(a0.member_id)
  // Credited to someone else (a person who left, or a second KnockRoute name on a roster row): keep the original name in the note.
  const kept = who && who !== 'former' && eq((who.knockroute_name || who.name).split('|')[0], personById.get(a0.member_id)?.name)
  const prefix = !kept ? map.people.former_people.note_prefix.replace('{name}', personById.get(a0.member_id)?.name ?? 'unknown') : ''
  const a = { ...a0, notes: prefix ? prefix + (a0.notes ?? '') : a0.notes, deal_cents: null }
  // Sold is only ever a status update on an earlier appointment. A sale logged at the door becomes
  // an appointment at that moment (closed as sold) plus a Sold update one second later.
  if ((R.update_only ?? []).includes(a.outcome) && a.channel !== R.update_channel && R.sold_at_door === 'split') {
    reshaped.soldSplit.push(a0.id)
    activities.push({ ...a, outcome: 'appointment', due_at: a.created_at, resolved_at: a.created_at, resolution: a.outcome })
    const t = new Date(new Date(a.created_at).getTime() + 1000).toISOString()
    activities.push({ ...a, id: stableId(`sold-update:${a0.id}`), channel: R.update_channel, created_at: t, due_at: null, resolved_at: null, resolution: null, notes: null })
    continue
  }
  // Appointments and follow-ups need a date: give a dateless one the visit's own time.
  if ((R.needs_date ?? []).includes(a.outcome) && !a.due_at && R.missing_date === 'visit_time') {
    reshaped.dateFilled.push(a0.id)
    a.due_at = a.created_at
  }
  activities.push(a)
}
const openItems = activities.filter((a) => (a.outcome === 'appointment' || a.outcome === 'follow_up') && !a.resolved_at)

// ---------------------------------------------------------------- gated areas
const zones = (bundle.gated_zones ?? []).map((g) => ({ ...g, points: shape(g.points, map.gated_areas.shape_format) }))

// ---------------------------------------------------------------- value checks
checkValues('lead_type', leads.map((x) => x.lead_type))
checkValues('status', leads.map((x) => x.status))
checkValues('outcome', activities.map((a) => a.outcome))
checkValues('outcome', activities.map((a) => a.resolution).filter(Boolean))
checkValues('channel', activities.map((a) => a.channel))
if (R.built_in) {
  const bad = [...new Set(activities.flatMap((a) => [a.outcome, a.resolution]).filter((v) => v && !R.built_in.includes(map.values.outcome[v])))]
  if (bad.length) block(`results: ${bad.join(', ')} don't map to one of Therisma's built-in results.`)
  const doorSold = activities.filter((a) => (R.update_only ?? []).includes(a.outcome) && a.channel !== R.update_channel).length
  if (doorSold) block(`results: ${doorSold} Sold visits are not status updates.`)
}
checkValues('zone_status', zones.map((z) => z.status))
if (!map.confirmed) block('field-map.json is not confirmed against Therisma’s schema yet ("confirmed": false).')
args.org ??= scope.therisma_org_id
if (mode !== 'dry-run' && !UUID.test(args.org ?? '')) block('--org must be the Therisma org id (a uuid).')

// ---------------------------------------------------------------- report
printReport()

if (mode === 'dry-run') {
  console.log('\nDry run only: nothing was written anywhere.')
  process.exit(0)
}
if (problems.length) {
  console.error(`\nStopped: ${problems.length} thing(s) above must be fixed first. Nothing was written.`)
  process.exit(2)
}

const sql = buildSql(args.org)
if (mode === 'emit') {
  fs.writeFileSync(args['emit-sql'], sql)
  console.log(`\nWrote ${args['emit-sql']} (${(sql.length / 1e6).toFixed(1)} MB). No database was touched.`)
  process.exit(0)
}

// mode === 'apply'
if (!args['caleb-said-go']) {
  console.error('\nStopped: --apply also needs --caleb-said-go. Only run this after the pilot office signs up and Caleb says go.')
  process.exit(2)
}
const url = process.env.THERISMA_DATABASE_URL
if (!url) {
  console.error('\nStopped: set THERISMA_DATABASE_URL to Therisma’s database connection string.')
  process.exit(2)
}
if (url.includes(KNOCKROUTE_PROJECT)) {
  console.error('\nStopped: THERISMA_DATABASE_URL points at KnockRoute’s database. This script never writes to KnockRoute.')
  process.exit(2)
}
const { default: pg } = await import('pg').catch(() => {
  console.error('\nStopped: run `npm install pg` in this folder first.')
  process.exit(2)
})
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query(sql) // begins and commits itself; any error rolls everything back
  console.log('\nDone: everything was copied in one transaction.')
} catch (e) {
  console.error('\nFailed, and nothing was kept (the whole copy rolled back):', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}

// ================================================================ helpers

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const k = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[k] = true
    else out[k] = argv[++i]
  }
  return out
}

function eq(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

/** Same input → same uuid, so a second run lines up with the first. */
function stableId(key) {
  const h = crypto.createHash('sha1').update(`knockroute→therisma:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function readCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') row.push(cell), (cell = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell), rows.push(row), (row = []), (cell = '')
    } else cell += c
  }
  if (cell || row.length) row.push(cell), rows.push(row)
  return rows.filter((r) => r.some((c) => c.trim()))
}

function readRoster(file) {
  const [head, ...body] = readCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
  const cols = head.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'))
  const rows = body.map((r, i) => {
    const o = { line: i + 2 }
    cols.forEach((c, j) => (o[c] = (r[j] ?? '').trim()))
    o.role = o.role.toLowerCase()
    return o
  })
  return { cols, rows }
}

function checkRoster({ cols, rows }) {
  for (const c of ['name', 'email', 'role', 'reports_to']) if (!cols.includes(c)) block(`roster: missing the "${c}" column.`)
  const owners = rows.filter((r) => r.role === 'owner')
  if (owners.length === 0) block('roster: nobody is an owner.')
  const seen = new Map()
  for (const r of rows) {
    const at = `roster line ${r.line} (${r.name || 'no name'})`
    if (!r.name) block(`${at}: name is empty.`)
    if (!r.email) block(`${at}: email is empty.`)
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) block(`${at}: "${r.email}" isn't an email address.`)
    else if (/@knockroute\.example\.com$/i.test(r.email)) block(`${at}: ${r.email} is a KnockRoute stand-in address; Therisma needs the person's real email.`)
    if (r.email && seen.has(r.email.toLowerCase())) block(`${at}: same email as line ${seen.get(r.email.toLowerCase())}.`)
    seen.set(r.email.toLowerCase(), r.line)
    if (!['owner', 'manager', 'agent'].includes(r.role)) block(`${at}: role must be owner, manager or agent (got "${r.role}").`)
    if (r.role !== 'owner' && !r.reports_to) block(`${at}: reports_to is empty (only owners can report to nobody).`)
    if (r.reports_to) {
      const boss = rows.find((b) => eq(b.name, r.reports_to) || eq(b.email, r.reports_to))
      if (!boss) block(`${at}: reports_to "${r.reports_to}" isn't anyone on the roster.`)
      else if (boss === r) block(`${at}: reports to themself.`)
      else if (boss.role === 'agent') block(`${at}: reports to ${boss.name}, who is an agent.`)
    }
  }
  // Loops (A reports to B reports to A).
  for (const r of rows) {
    const chain = new Set()
    let cur = r
    while (cur && cur.reports_to && !chain.has(cur)) {
      chain.add(cur)
      cur = rows.find((b) => eq(b.name, cur.reports_to) || eq(b.email, cur.reports_to))
    }
    if (cur && chain.has(cur)) {
      block(`roster: ${r.name}'s reports-to chain goes in a circle.`)
      break
    }
  }
}

function usageByPerson() {
  const m = new Map()
  const bump = (id, k) => {
    if (!id) return
    const u = m.get(id) ?? { visits: 0, open: 0, assigned: 0, lists: 0, zones: 0, total: 0 }
    u[k]++
    u.total++
    m.set(id, u)
  }
  for (const a of bundle.activities ?? []) {
    bump(a.member_id, 'visits')
    if ((a.outcome === 'appointment' || a.outcome === 'follow_up') && !a.resolved_at) bump(a.member_id, 'open')
  }
  for (const x of bundle.leads ?? []) bump(x.assigned_to, 'assigned')
  for (const l of bundle.lists ?? []) bump(l.owner_id, 'lists')
  return m
}

function dob(v) {
  if (!v || !/^\d{6}$/.test(v)) return v || null
  const f = map.leads.dob_format
  if (f === 'yyyy-mm') return `${v.slice(0, 4)}-${v.slice(4)}`
  if (f === 'date') return `${v.slice(0, 4)}-${v.slice(4)}-01`
  return v
}

/** KnockRoute keeps [[lat,lng],…] with the ring left open. */
function shape(points, format) {
  if (format === 'latlng') return points
  const ring = points.map(([lat, lng]) => [lng, lat])
  const [a, b] = [ring[0], ring[ring.length - 1]]
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([...a])
  if (format === 'geojson') return { type: 'Polygon', coordinates: [ring] }
  if (format === 'wkt') return `SRID=4326;POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(', ')}))`
  block(`field-map: gated_areas.shape_format "${format}" isn't one of latlng, geojson, wkt.`)
  return points
}

function checkValues(kind, values) {
  const m = map.values[kind] ?? {}
  const missing = [...new Set(values.filter((v) => v != null && !(v in m)))]
  if (missing.length) block(`field-map: values.${kind} has no Therisma value for ${missing.map((v) => `"${v}"`).join(', ')}.`)
}

// ---------------------------------------------------------------- SQL

function lit(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

/** Turns KnockRoute rows into one INSERT per 500 rows, following the field map. */
function inserts(section, rows, valueKinds = {}) {
  const cols = Object.entries(section.columns).filter(([, to]) => to)
  if (!cols.length || !rows.length) return ''
  const target = cols.map(([, to]) => to)
  const cell = (row, from) => {
    if (from === 'org_id') return ':ORG'
    let v = row[from]
    if (valueKinds[from] && v != null) v = map.values[valueKinds[from]][v]
    if (from === 'id' && !map.keep_knockroute_ids) v = stableId(`${section.table}:${v}`)
    if ((from === 'list_id' || from === 'lead_id') && !map.keep_knockroute_ids && v) v = stableId(`${from === 'list_id' ? map.lists.table : map.leads.table}:${v}`)
    if (PEOPLE_FIELDS.has(from)) return v ? `pg_temp.kr_user(${lit(v)})` : 'null'
    return lit(v)
  }
  const out = []
  for (let i = 0; i < rows.length; i += 500) {
    const values = rows.slice(i, i + 500).map((r) => `(${cols.map(([from]) => cell(r, from)).join(', ')})`)
    out.push(
      `insert into ${section.table} (${target.join(', ')}) values\n${values.join(',\n')}${map.on_conflict_do_nothing ? '\non conflict do nothing' : ''};`,
    )
  }
  return out.join('\n\n')
}

function buildSql(org) {
  const orgLit = lit(org)
  const peopleRows = people.map((p) => {
    const t = personTarget.get(p.id)
    const email = t === 'former' ? placeholderEmail : t.email
    return `(${lit(p.id)}::uuid, ${lit(p.name)}, ${lit(email || null)})`
  })
  const lookup = map.people.lookup_sql.replaceAll(':org', `${orgLit}::uuid`).replaceAll(':email', 'p.email')
  const parts = [
    `-- KnockRoute → Therisma copy, made ${new Date().toISOString()} from an export taken ${bundle.exported_at}.`,
    `-- Target org: ${org}. One transaction: if any statement fails, nothing is kept.`,
    'begin;',
    '',
    `do $$ begin if not exists (${map.org.check_sql.replaceAll(':org', `${orgLit}::uuid`)}) then raise exception 'Therisma org ${org} was not found.'; end if; end $$;`,
    '',
    '-- KnockRoute person → Therisma user, looked up by email inside this org.',
    'create temp table kr_people (kr_id uuid primary key, name text, email text, therisma_id uuid) on commit drop;',
    `insert into kr_people (kr_id, name, email) values\n${peopleRows.join(',\n')};`,
    `update kr_people p set therisma_id = (${lookup}) where p.email is not null;`,
    `do $$ declare missing text; begin
  select string_agg(name || ' <' || coalesce(email, 'no email') || '>', ', ') into missing from kr_people where therisma_id is null and email is not null;
  if missing is not null then raise exception 'Not in the Therisma org yet (invite them first): %', missing; end if;
end $$;`,
    'create function pg_temp.kr_user(uuid) returns uuid language sql stable as $f$ select therisma_id from kr_people where kr_id = $1 $f$;',
    '',
    `-- Lists (${lists.length})`,
    inserts(map.lists, lists),
    '',
    `-- Leads (${leads.length})`,
    inserts(map.leads, leads, { lead_type: 'lead_type', status: 'status' }),
    '',
    `-- Visits / dispositions (${activities.length})`,
    inserts(map.dispositions, activities, { outcome: 'outcome', resolution: 'outcome', channel: 'channel' }),
    '',
  ]
  if (map.open_items.mode === 'separate_table')
    parts.push(`-- Open appointments and follow-ups (${openItems.length})`, inserts(map.open_items, openItems, { outcome: 'outcome' }), '')
  parts.push(`-- Gated areas (${zones.length})`, inserts(map.gated_areas, zones, { status: 'zone_status' }), '', 'commit;', '')
  return parts.join('\n').replaceAll(':ORG', `${orgLit}::uuid`)
}

// ---------------------------------------------------------------- report

function printReport() {
  const count = (arr, key) => arr.reduce((m, x) => m.set(x[key] ?? '(none)', (m.get(x[key] ?? '(none)') ?? 0) + 1), new Map())
  const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString()}`).join(' · ')
  const line = (s = '') => console.log(s)

  line(`KnockRoute → Therisma (${mode}) · org ${args.org ?? scope.therisma_org_id ?? 'not set'}${scope.therisma_org_name ? ` (${scope.therisma_org_name})` : ''}`)
  line(`Export taken ${bundle.exported_at}, KnockRoute database version ${bundle.schema_version}`)
  line(
    `Scope: ${scope.lead_types?.join(', ') ?? 'all'} leads${scope.birth_months ? `, birth months ${scope.birth_months.join(', ')}` : ''}. ` +
      `Left behind: ${left.leads.toLocaleString()} leads, ${left.visits.toLocaleString()} visits (${left.open} open items), ${left.lists} lists.`,
  )
  line()
  line(`Lists ${lists.length}${t65ByMonth ? ' (Turning 65 regrouped by birth month)' : ''}`)
  line(`Leads ${leads.length.toLocaleString()}: ${fmt(count(leads, 'lead_type'))}`)
  for (const [type] of count(leads, 'lead_type')) line(`  ${type}: ${fmt(count(leads.filter((x) => x.lead_type === type), 'status'))}`)
  line(`Visits ${activities.length.toLocaleString()}: ${fmt(count(activities, 'outcome'))}`)
  line(`  by channel: ${fmt(count(activities, 'channel'))}`)
  const doors = activities.filter((a) => (R.door_channels ?? ['door', 'phone']).includes(a.channel))
  const tally = (o) => activities.filter((a) => a.outcome === o).length
  line(`  doors (DKs): ${doors.length.toLocaleString()} · updates: ${(activities.length - doors.length).toLocaleString()}`)
  line(`  Appt ${tally('appointment')} · F/U ${tally('follow_up')} · NI ${tally('not_interested')} · Sold ${tally('sold')} (doors and updates together)`)
  line(`  contacts: ${activities.filter((a) => ['appointment', 'follow_up', 'not_interested'].includes(a.outcome) && doors.includes(a)).length.toLocaleString()} at the door`)
  line(`  reshaped to fit Therisma: ${reshaped.soldSplit.length} door sales split into appointment + Sold update, ${reshaped.dateFilled.length} undated appointments/follow-ups given the visit time as their date`)
  line(`  deal amounts: none (KnockRoute never recorded them)`)
  line(`Open appointments and follow-ups ${openItems.length}: ${fmt(count(openItems, 'outcome'))}; ${openItems.filter((a) => !a.due_at).length} with no date`)
  line(`Gated areas ${zones.length} (shape written as ${map.gated_areas.shape_format})`)
  line(`People in KnockRoute ${people.length}: ${fmt(count(people, 'role'))}`)

  if (roster) {
    line()
    line(`Roster ${roster.rows.length}: ${fmt(count(roster.rows, 'role'))}`)
    const former = people.filter((p) => personTarget.get(p.id) === 'former')
    const withWork = former.filter((p) => used.get(p.id)?.total)
    if (former.length) line(`Not on the roster (treated as left): ${former.length}, of whom ${withWork.length} have history`)
    for (const p of withWork) {
      const u = used.get(p.id)
      line(`  ${p.name}: ${u.visits} visits, ${u.open} open items, ${u.assigned} assigned leads, ${u.lists} own lists → ${placeholderEmail || 'NO PLACEHOLDER SET'}`)
    }
    const unmatched = roster.rows.filter((r) => !people.some((p) => personTarget.get(p.id) === r))
    if (unmatched.length) line(`On the roster but not in KnockRoute (new people, nothing to carry over): ${unmatched.map((r) => r.name).join(', ')}`)
  }

  const claims = leads.filter((x) => x.claimed_by).length
  if (claims && !map.leads.columns.claimed_by) note(`${claims.toLocaleString()} route claims (claimed_by) are not copied; Therisma territories replace them.`)
  if (!map.leads.columns.prefix) note('Name prefixes (Mr., Mrs.) are not copied.')
  const t65NoDob = leads.filter((x) => x.lead_type === 't65' && !x.dob).length
  if (t65NoDob) note(`${t65NoDob} Turning 65 leads have no birth month.`)

  if (notes.length) {
    line()
    line('Notes:')
    for (const n of notes) line(`  - ${n}`)
  }
  line()
  if (problems.length) {
    line(`Must fix before the real copy (${problems.length}):`)
    for (const p of problems) line(`  ✗ ${p}`)
  } else line('Nothing blocking.')
}
