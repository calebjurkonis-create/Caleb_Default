-- KnockRoute update 8. Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
--  * Remembers which "What's new" announcements each person has closed, on their account,
--    so it shows once per person (not once per phone).

create table if not exists public.seen_notices (
  member_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  notice text not null,
  seen_at timestamptz not null default now(),
  primary key (member_id, notice)
);
alter table public.seen_notices enable row level security;
drop policy if exists "see own notices" on public.seen_notices;
create policy "see own notices" on public.seen_notices for select to authenticated using (member_id = auth.uid());
drop policy if exists "close own notices" on public.seen_notices;
create policy "close own notices" on public.seen_notices for insert to authenticated with check (member_id = auth.uid());

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
    when not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'lead_lists' and column_name = 'owner_id') then 7
    when not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'seen_notices') then 8
    else 9 end
$$;
grant execute on function public.knockroute_version() to authenticated;
