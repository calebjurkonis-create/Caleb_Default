-- KnockRoute: add teammates who sign in with a username instead of an email.
-- Fill in the list, then paste into Supabase > SQL Editor > New query > Run.
-- Safe to re-run: people who already exist only get their name and role refreshed.
-- Each person must choose their own password the first time they sign in.

do $$
declare
  r record;
  uid uuid;
  mail text;
begin
  for r in select * from (values
    -- (username,            name shown in app,  temporary password, role)
    ('firstnamelastname',     'Firstname Lastname', 'Firstname123!',  'agent')
  ) as t(username, name, password, role)
  loop
    mail := lower(r.username) || '@knockroute.example.com';
    select id into uid from auth.users where email = mail;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
        extensions.crypt(r.password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', r.name, 'temp_password', true), now(), now(),
        '', '', '', ''
      );
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text,
              jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true),
              'email', now(), now(), now());
    end if;
    insert into public.profiles (id, name, role) values (uid, r.name, r.role)
      on conflict (id) do update set name = excluded.name, role = excluded.role;
  end loop;
end $$;

-- Reset someone's password (they'll be asked to choose a new one at next sign-in):
-- update auth.users
--    set encrypted_password = extensions.crypt('Firstname123!', extensions.gen_salt('bf')),
--        raw_user_meta_data = raw_user_meta_data || '{"temp_password": true}'
--  where email = 'firstnamelastname@knockroute.example.com';
