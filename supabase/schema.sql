-- KnockRoute database. Paste this whole file into Supabase > SQL Editor > New query, then Run.
-- Safe to re-run: it only creates what is missing.

-- ── Team members ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  role text not null default 'agent' check (role in ('agent', 'manager')),
  created_at timestamptz not null default now()
);

-- Every invited user gets a profile automatically. Name comes from the part of the email before "@"
-- until a manager edits it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager')
$$;

-- ── Lead lists (one per uploaded spreadsheet) ───────────────────────────────
create table if not exists public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ── Leads ───────────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lead_lists (id) on delete cascade,
  prefix text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  address text not null,
  city text not null default '',
  state text not null default 'FL',
  zip text not null default '',
  county text not null default '',
  phone text not null default '',
  dob text not null default '',
  lat double precision,
  lng double precision,
  status text not null default 'new',
  attempts int not null default 0,
  last_activity_at timestamptz,
  last_activity_by uuid references public.profiles (id),
  assigned_to uuid references public.profiles (id) on delete set null, -- null = shared pool
  claimed_by uuid references public.profiles (id) on delete set null,  -- on someone's route today
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
-- Pin marks the street, not the exact house (new builds the map services don't know yet).
alter table public.leads add column if not exists pin_approx boolean not null default false;
create index if not exists leads_list_idx on public.leads (list_id);
create index if not exists leads_assigned_idx on public.leads (assigned_to);

-- ── Dispositions (every door knock / call) ──────────────────────────────────
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null, -- removed leads keep their history
  member_id uuid not null references public.profiles (id) default auth.uid(),
  channel text not null check (channel in ('door', 'phone')),
  outcome text not null check (outcome in
    ('no_answer', 'left_note', 'appointment', 'follow_up', 'not_interested', 'info_requested', 'bad_info')),
  notes text not null default '',
  lead_label text not null default '', -- "First Last, Address, City", kept if the lead is removed
  created_at timestamptz not null default now()
);
create index if not exists activities_lead_idx on public.activities (lead_id, created_at desc);
create index if not exists activities_created_idx on public.activities (created_at desc);

-- Logging a disposition updates the lead's status for everyone.
create or replace function public.apply_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads
     set status = new.outcome,
         attempts = attempts + 1,
         last_activity_at = new.created_at,
         last_activity_by = new.member_id
   where id = new.lead_id;
  return new;
end $$;

drop trigger if exists on_activity_insert on public.activities;
create trigger on_activity_insert after insert on public.activities
  for each row execute function public.apply_activity();

-- Agents can claim/unclaim leads for their route without being able to edit anything else.
create or replace function public.claim_leads(lead_ids uuid[], claim boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.leads
     set claimed_by = case when claim then auth.uid() else null end,
         claimed_at = case when claim then now() else null end
   where id = any (lead_ids)
     and (assigned_to is null or assigned_to = auth.uid() or public.is_manager())
     and (claim or claimed_by = auth.uid() or public.is_manager());
end $$;

-- ── Who can see and change what ─────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.lead_lists enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;

drop policy if exists "team reads profiles" on public.profiles;
create policy "team reads profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "managers edit profiles" on public.profiles;
create policy "managers edit profiles" on public.profiles for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "team reads lists" on public.lead_lists;
create policy "team reads lists" on public.lead_lists for select to authenticated using (true);
drop policy if exists "managers manage lists" on public.lead_lists;
create policy "managers manage lists" on public.lead_lists for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Agents see the shared pool plus leads assigned to them. Managers see everything.
drop policy if exists "see pool or own leads" on public.leads;
create policy "see pool or own leads" on public.leads for select to authenticated
  using (assigned_to is null or assigned_to = auth.uid() or public.is_manager());
drop policy if exists "managers manage leads" on public.leads;
create policy "managers manage leads" on public.leads for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "see activity on visible leads" on public.activities;
create policy "see activity on visible leads" on public.activities for select to authenticated
  using (lead_id is null or exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists "log own activity" on public.activities;
create policy "log own activity" on public.activities for insert to authenticated
  with check (member_id = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists "managers fix activity" on public.activities;
create policy "managers fix activity" on public.activities for delete to authenticated
  using (public.is_manager());

-- ── Live updates ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'leads') then
    alter publication supabase_realtime add table public.leads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'activities') then
    alter publication supabase_realtime add table public.activities;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ── Later updates (also in supabase/updates/) ───────────────────────────────
-- Street-level pins
alter table public.leads add column if not exists pin_approx boolean not null default false;

-- Each visit remembers who it was about, so history survives the lead being removed.
alter table public.activities add column if not exists lead_label text not null default '';
update public.activities a
   set lead_label = trim(l.first_name || ' ' || l.last_name) || ', ' || l.address || ', ' || l.city
  from public.leads l
 where l.id = a.lead_id and a.lead_label = '';

create or replace function public.label_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select trim(first_name || ' ' || last_name) || ', ' || address || ', ' || city
    into new.lead_label
    from public.leads where id = new.lead_id;
  new.lead_label := coalesce(new.lead_label, '');
  return new;
end $$;

drop trigger if exists before_activity_insert on public.activities;
create trigger before_activity_insert before insert on public.activities
  for each row execute function public.label_activity();

-- Removing a lead now keeps its visits (unlinked) instead of deleting them.
alter table public.activities alter column lead_id drop not null;
alter table public.activities drop constraint if exists activities_lead_id_fkey;
alter table public.activities add constraint activities_lead_id_fkey
  foreign key (lead_id) references public.leads (id) on delete set null;

drop policy if exists "see activity on visible leads" on public.activities;
create policy "see activity on visible leads" on public.activities for select to authenticated
  using (lead_id is null or exists (select 1 from public.leads l where l.id = lead_id));

-- Lets the app check this update has been applied.
create or replace function public.knockroute_version() returns int
language sql stable as $$ select 2 $$;
grant execute on function public.knockroute_version() to authenticated;


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

-- Reports 3 only if update 1 (history kept when leads are removed) is also in place.
create or replace function public.knockroute_version() returns int
language sql stable as $$
  select case when exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'activities' and column_name = 'lead_label')
              then 3 else 1 end
$$;
grant execute on function public.knockroute_version() to authenticated;


alter table public.activities add column if not exists due_at timestamptz;
alter table public.activities add column if not exists resolved_at timestamptz;
alter table public.activities add column if not exists resolution text;

alter table public.activities drop constraint if exists activities_outcome_check;
alter table public.activities add constraint activities_outcome_check check (outcome in
  ('no_answer', 'left_note', 'appointment', 'follow_up', 'not_interested', 'info_requested', 'bad_info', 'sold'));
alter table public.activities drop constraint if exists activities_channel_check;
alter table public.activities add constraint activities_channel_check check (channel in ('door', 'phone', 'update'));

create index if not exists activities_open_idx on public.activities (due_at)
  where due_at is not null and resolved_at is null;

-- Logging anything on a lead moves its status forward and closes its earlier open follow-up/appointment.
-- Status updates (channel 'update') don't count as another door knock.
create or replace function public.apply_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads
     set status = new.outcome,
         attempts = attempts + case when new.channel = 'update' then 0 else 1 end,
         last_activity_at = new.created_at,
         last_activity_by = new.member_id
   where id = new.lead_id;
  update public.activities
     set resolved_at = new.created_at, resolution = new.outcome
   where lead_id = new.lead_id and id <> new.id and due_at is not null and resolved_at is null;
  return new;
end $$;

-- Update an open follow-up/appointment. The agent who set it or a manager can do this.
create or replace function public.resolve_item(item uuid, result text, note text, next_due timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  it public.activities%rowtype;
begin
  select * into it from public.activities where id = item;
  if not found or it.resolved_at is not null then
    raise exception 'That follow-up or appointment was already updated.';
  end if;
  if it.member_id <> auth.uid() and not public.is_manager() then
    raise exception 'Only the agent who set it, or a manager, can update it.';
  end if;
  if result not in ('appointment', 'follow_up', 'not_interested', 'sold') then
    raise exception 'Not a valid update.';
  end if;
  insert into public.activities (lead_id, member_id, channel, outcome, notes, due_at)
  values (it.lead_id, auth.uid(), 'update', result, coalesce(note, ''),
          case when result in ('appointment', 'follow_up') then next_due end);
end $$;
grant execute on function public.resolve_item(uuid, text, text, timestamptz) to authenticated;

-- Lets the app know this update is in place (and that update 1 is too).
create or replace function public.knockroute_version() returns int
language sql stable as $$
  select case
    when not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'activities' and column_name = 'lead_label') then 1
    when exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'activities' and column_name = 'due_at') then 4
    else 3 end
$$;
grant execute on function public.knockroute_version() to authenticated;
