-- KnockRoute update 7. Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
--  * Agents can add their own leads (one at a time or from a spreadsheet).
--  * Only that agent and managers ever see them; other agents don't, and neither does their history.
--  * Each agent's own leads go in their own list, which other agents can't see either.
--  * Knocks on them count on the leaderboard like any other knock.

-- ── Lead type ───────────────────────────────────────────────────────────────
alter table public.leads drop constraint if exists leads_lead_type_check;
alter table public.leads add constraint leads_lead_type_check check (lead_type in ('t65', 'nho', 'personal'));

-- ── Each agent's own list ───────────────────────────────────────────────────
alter table public.lead_lists add column if not exists owner_id uuid references public.profiles (id) on delete cascade;
create index if not exists lead_lists_owner_idx on public.lead_lists (owner_id);

drop policy if exists "team reads lists" on public.lead_lists;
create policy "team reads lists" on public.lead_lists for select to authenticated
  using (owner_id is null or owner_id = auth.uid() or public.is_manager());
drop policy if exists "agents start own list" on public.lead_lists;
create policy "agents start own list" on public.lead_lists for insert to authenticated
  with check (owner_id = auth.uid() and created_by = auth.uid());

-- ── Agents add, fix and remove their own leads (nothing else) ───────────────
drop policy if exists "agents add own leads" on public.leads;
create policy "agents add own leads" on public.leads for insert to authenticated
  with check (
    lead_type = 'personal' and assigned_to = auth.uid()
    and exists (select 1 from public.lead_lists ll where ll.id = list_id and ll.owner_id = auth.uid())
  );
drop policy if exists "agents edit own leads" on public.leads;
create policy "agents edit own leads" on public.leads for update to authenticated
  using (lead_type = 'personal' and assigned_to = auth.uid())
  with check (
    lead_type = 'personal' and assigned_to = auth.uid()
    and exists (select 1 from public.lead_lists ll where ll.id = list_id and ll.owner_id = auth.uid())
  );
drop policy if exists "agents remove own leads" on public.leads;
create policy "agents remove own leads" on public.leads for delete to authenticated
  using (lead_type = 'personal' and assigned_to = auth.uid());

-- Visits on an own lead that's later removed stay private (only t65 history is shared).
-- (Update 6's rule already does this: removed-lead history shows to everyone only when it was a t65 lead.)

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
    else 8 end
$$;
grant execute on function public.knockroute_version() to authenticated;
