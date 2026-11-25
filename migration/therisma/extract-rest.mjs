#!/usr/bin/env node
/**
 * KnockRoute export over Supabase's REST API: the same JSON file as extract.sql,
 * for when there's no database password to hand.
 *
 * READ ONLY: it sends GET requests and nothing else.
 *
 * The key is never in this file, in chat or in git. In Claude's cloud session it
 * is saved as a network secret (header "apikey") and the network proxy adds it to
 * each request; the placeholder below is all this script ever sees. Elsewhere,
 * set KR_API_KEY in the shell.
 *
 *   node extract-rest.mjs kr-bundle.json
 *
 * The file holds names, addresses and phone numbers: keep it out of git
 * (.gitignore covers kr-bundle*.json) and delete it after the copy.
 */
import fs from 'node:fs'

const BASE = (process.env.KR_URL ?? 'https://wybrhduekutlgsahbrqj.supabase.co').replace(/\/$/, '') + '/rest/v1'
const KEY = process.env.KR_API_KEY ?? 'injected-by-proxy'
const out = process.argv[2] ?? 'kr-bundle.json'
const PAGE = 1000

const TABLES = {
  people: ['profiles', 'id,name,role,created_at'],
  lists: ['lead_lists', 'id,name,created_by,created_at,owner_id'],
  leads: [
    'leads',
    'id,list_id,lead_type,prefix,first_name,last_name,address,city,state,zip,county,phone,dob,lat,lng,pin_approx,status,attempts,' +
      'last_activity_at,last_activity_by,assigned_to,claimed_by,claimed_at,sale_date,sale_price,homestead,buyer_flag,parcel_id,property_type,source_note,created_at',
  ],
  activities: ['activities', 'id,lead_id,member_id,channel,outcome,notes,lead_label,lead_type,created_at,due_at,resolved_at,resolution'],
  gated_zones: ['gated_zones', 'id,name,points,source,status,created_by,created_at'],
  settings: ['app_settings', '*'],
}

async function getAll(table, select) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const url = `${BASE}/${table}?select=${select}&order=id.asc&offset=${from}&limit=${PAGE}`
    const res = await fetch(url, { method: 'GET', headers: { apikey: KEY, Accept: 'application/json' } })
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const bundle = { source: 'knockroute', exported_at: new Date().toISOString(), schema_version: null, via: 'rest' }
for (const [key, [table, select]] of Object.entries(TABLES)) {
  bundle[key] = await getAll(table, select)
  console.log(`${key}: ${bundle[key].length.toLocaleString()}`)
}
fs.writeFileSync(out, JSON.stringify(bundle))
console.log(`Wrote ${out}. Nothing in KnockRoute was changed (GET requests only).`)
