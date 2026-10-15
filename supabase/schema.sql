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
create index if not exists leads_list_idx on public.leads (list_id);
create index if not exists leads_assigned_idx on public.leads (assigned_to);

-- ── Dispositions (every door knock / call) ──────────────────────────────────
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  member_id uuid not null references public.profiles (id) default auth.uid(),
  channel text not null check (channel in ('door', 'phone')),
  outcome text not null check (outcome in
    ('no_answer', 'left_note', 'appointment', 'follow_up', 'not_interested', 'info_requested', 'bad_info')),
  notes text not null default '',
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
  using (exists (select 1 from public.leads l where l.id = lead_id));
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
