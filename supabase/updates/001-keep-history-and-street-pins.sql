-- KnockRoute update 1. Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
--  * Street-level pins for new builds (pin_approx)
--  * Removing leads keeps their door-knock history (reports and exports stay complete)

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
