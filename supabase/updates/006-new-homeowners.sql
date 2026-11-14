-- KnockRoute update 6. Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
--  * A second kind of lead: new homeowners (recent home buyers), with sale date, price,
--    homestead, LLC/Trust flag, parcel, property type and the source's note.
--  * They're imported assigned to one person, so agents never see them (the existing
--    "see pool or own leads" rule); managers do. Knock history on a new-homeowner lead that
--    is later removed stays hidden from agents too.
--  * Also adds the shared settings table from update 3, in case it was skipped.

-- ── Shared settings (update 3) ──────────────────────────────────────────────
create table if not exists public.app_settings (
  name text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "team reads settings" on public.app_settings;
create policy "team reads settings" on public.app_settings for select to authenticated using (true);
drop policy if exists "managers change settings" on public.app_settings;
create policy "managers change settings" on public.app_settings for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ── Lead types ──────────────────────────────────────────────────────────────
alter table public.leads add column if not exists lead_type text not null default 't65';
alter table public.leads drop constraint if exists leads_lead_type_check;
alter table public.leads add constraint leads_lead_type_check check (lead_type in ('t65', 'nho'));
alter table public.leads add column if not exists sale_date date;
alter table public.leads add column if not exists sale_price numeric;
alter table public.leads add column if not exists homestead text;
alter table public.leads add column if not exists buyer_flag text;
alter table public.leads add column if not exists parcel_id text;
alter table public.leads add column if not exists property_type text;
alter table public.leads add column if not exists source_note text;

-- One new-homeowner lead per address, so monthly files never double up.
create unique index if not exists leads_nho_address_idx
  on public.leads (lower(regexp_replace(trim(address), '\s+', ' ', 'g')), left(zip, 5))
  where lead_type = 'nho';

-- Each visit remembers which kind of lead it was, so history stays private after a lead is removed.
alter table public.activities add column if not exists lead_type text not null default 't65';

create or replace function public.label_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select trim(first_name || ' ' || last_name) || ', ' || address || ', ' || city, lead_type
    into new.lead_label, new.lead_type
    from public.leads where id = new.lead_id;
  new.lead_label := coalesce(new.lead_label, '');
  new.lead_type := coalesce(new.lead_type, 't65');
  return new;
end $$;

drop policy if exists "see activity on visible leads" on public.activities;
create policy "see activity on visible leads" on public.activities for select to authenticated
  using (
    (lead_id is null and (lead_type = 't65' or member_id = auth.uid() or public.is_manager()))
    or exists (select 1 from public.leads l where l.id = lead_id)
  );

-- Lets the app know which updates are in place.
create or replace function public.knockroute_version() returns int
language sql stable as $$
  select case
    when not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'activities' and column_name = 'lead_label') then 1
    when not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'activities' and column_name = 'due_at') then 3
    when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'set_due') then 4
    when not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'gated_zones') then 5
    when not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_type') then 6
    else 7 end
$$;
grant execute on function public.knockroute_version() to authenticated;
