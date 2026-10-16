-- KnockRoute update 4. Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
--  * Follow-up and appointment dates (the Agenda tab)
--  * Status updates: follow-ups -> Booked / Not Interested; appointments -> Sold / Follow-Up / Not Interested
--  * Follow-ups and appointments logged before dates existed show as "Undated" until someone sets one

alter table public.activities add column if not exists due_at timestamptz;
alter table public.activities add column if not exists resolved_at timestamptz;
alter table public.activities add column if not exists resolution text;

alter table public.activities drop constraint if exists activities_outcome_check;
alter table public.activities add constraint activities_outcome_check check (outcome in
  ('no_answer', 'left_note', 'appointment', 'follow_up', 'not_interested', 'info_requested', 'bad_info', 'sold'));
alter table public.activities drop constraint if exists activities_channel_check;
alter table public.activities add constraint activities_channel_check check (channel in ('door', 'phone', 'update'));

drop index if exists public.activities_open_idx;
create index if not exists activities_open_items_idx on public.activities (lead_id)
  where outcome in ('appointment', 'follow_up') and resolved_at is null;

-- Older follow-ups/appointments that something else already happened after are closed out,
-- so only each lead's current one stays open.
with nxt as (
  select a.id, b.created_at, b.outcome
    from public.activities a
    join lateral (select created_at, outcome from public.activities b
                   where b.lead_id = a.lead_id and b.id <> a.id and b.created_at > a.created_at
                   order by b.created_at limit 1) b on true
   where a.outcome in ('appointment', 'follow_up') and a.resolved_at is null and a.lead_id is not null
)
update public.activities t set resolved_at = nxt.created_at, resolution = nxt.outcome
  from nxt where t.id = nxt.id;

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
   where lead_id = new.lead_id and id <> new.id and outcome in ('appointment', 'follow_up') and resolved_at is null;
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

-- Set or change the date on an open follow-up/appointment (its agent or a manager).
create or replace function public.set_due(item uuid, due timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  it public.activities%rowtype;
begin
  select * into it from public.activities where id = item;
  if not found or it.resolved_at is not null or it.outcome not in ('appointment', 'follow_up') then
    raise exception 'That follow-up or appointment was already updated.';
  end if;
  if it.member_id <> auth.uid() and not public.is_manager() then
    raise exception 'Only the agent who set it, or a manager, can change its date.';
  end if;
  update public.activities set due_at = due where id = item;
end $$;
grant execute on function public.set_due(uuid, timestamptz) to authenticated;

-- Lets the app know this update is in place (and that update 1 is too).
create or replace function public.knockroute_version() returns int
language sql stable as $$
  select case
    when not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'activities' and column_name = 'lead_label') then 1
    when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'set_due') then 5
    when exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'activities' and column_name = 'due_at') then 4
    else 3 end
$$;
grant execute on function public.knockroute_version() to authenticated;
