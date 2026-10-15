-- KnockRoute update 3. Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
-- Shared app settings, starting with the road-routing key managers paste in under More.

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
