-- KnockRoute update 5. Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
--  * Gated areas: managers mark gated communities on the map; everyone sees them.
--    Leads inside stay routable; it's only a heads-up.

create table if not exists public.gated_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  -- [[lat, lng], ...] around the area
  points jsonb not null,
  -- 'drawn' by a manager, or 'osm' when confirmed from an OpenStreetMap suggestion
  source text not null default 'drawn' check (source in ('drawn', 'osm')),
  -- The OpenStreetMap suggestion it came from, so dismissed/confirmed ones aren't suggested again
  osm_id text unique,
  -- 'dismissed' = a suggestion a manager said isn't gated (kept only so it isn't suggested again)
  status text not null default 'active' check (status in ('active', 'dismissed')),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.gated_zones enable row level security;

drop policy if exists "team sees gated areas" on public.gated_zones;
create policy "team sees gated areas" on public.gated_zones for select to authenticated using (true);
drop policy if exists "managers manage gated areas" on public.gated_zones;
create policy "managers manage gated areas" on public.gated_zones for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'gated_zones') then
    alter publication supabase_realtime add table public.gated_zones;
  end if;
end $$;

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
    else 6 end
$$;
grant execute on function public.knockroute_version() to authenticated;
