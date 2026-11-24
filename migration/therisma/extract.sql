-- KnockRoute → Therisma, step 1: export everything into one JSON file.
--
-- READ ONLY. This runs inside a read-only transaction, so it cannot change
-- KnockRoute even by mistake. It reads public tables plus auth.users (for
-- sign-in emails), so it needs the database owner connection string.
--
--   psql "$KR_DATABASE_URL" -X -q -t -A -v ON_ERROR_STOP=1 \
--        -f migration/therisma/extract.sql -o kr-bundle.json
--
-- kr-bundle.json holds names, addresses and phone numbers. Keep it off
-- GitHub and delete it once the copy is done.

begin transaction isolation level repeatable read read only;

select json_build_object(
  'source', 'knockroute',
  'exported_at', now(),
  'schema_version', (select public.knockroute_version()),

  'people', (
    select coalesce(json_agg(json_build_object(
      'id', p.id, 'name', p.name, 'role', p.role, 'email', u.email,
      'created_at', p.created_at, 'last_sign_in_at', u.last_sign_in_at
    ) order by p.name), '[]'::json)
    from public.profiles p left join auth.users u on u.id = p.id),

  'lists', (
    select coalesce(json_agg(json_build_object(
      'id', l.id, 'name', l.name, 'created_by', l.created_by,
      'created_at', l.created_at, 'owner_id', l.owner_id
    ) order by l.created_at), '[]'::json)
    from public.lead_lists l),

  'leads', (
    select coalesce(json_agg(json_build_object(
      'id', x.id, 'list_id', x.list_id, 'lead_type', x.lead_type,
      'prefix', x.prefix, 'first_name', x.first_name, 'last_name', x.last_name,
      'address', x.address, 'city', x.city, 'state', x.state, 'zip', x.zip,
      'county', x.county, 'phone', x.phone, 'dob', x.dob,
      'lat', x.lat, 'lng', x.lng, 'pin_approx', x.pin_approx,
      'status', x.status, 'attempts', x.attempts,
      'last_activity_at', x.last_activity_at, 'last_activity_by', x.last_activity_by,
      'assigned_to', x.assigned_to, 'claimed_by', x.claimed_by, 'claimed_at', x.claimed_at,
      'sale_date', x.sale_date, 'sale_price', x.sale_price, 'homestead', x.homestead,
      'buyer_flag', x.buyer_flag, 'parcel_id', x.parcel_id,
      'property_type', x.property_type, 'source_note', x.source_note,
      'created_at', x.created_at
    ) order by x.created_at, x.id), '[]'::json)
    from public.leads x),

  'activities', (
    select coalesce(json_agg(json_build_object(
      'id', a.id, 'lead_id', a.lead_id, 'member_id', a.member_id,
      'channel', a.channel, 'outcome', a.outcome, 'notes', a.notes,
      'lead_label', a.lead_label, 'lead_type', a.lead_type,
      'created_at', a.created_at, 'due_at', a.due_at,
      'resolved_at', a.resolved_at, 'resolution', a.resolution
    ) order by a.created_at, a.id), '[]'::json)
    from public.activities a),

  'gated_zones', (
    select coalesce(json_agg(json_build_object(
      'id', g.id, 'name', g.name, 'points', g.points, 'source', g.source,
      'status', g.status, 'created_by', g.created_by, 'created_at', g.created_at
    ) order by g.name), '[]'::json)
    from public.gated_zones g),

  'settings', (
    select coalesce(json_agg(to_json(s)), '[]'::json) from public.app_settings s)
);

commit;
