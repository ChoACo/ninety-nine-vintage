-- The production migration at 20260718030000 intentionally requires the
-- configured owner to already exist as a Kakao Auth identity. A brand-new
-- Supabase test project has no Auth users, so this test-only migration creates
-- the same prerequisite before the repository migration chain continues.
-- The runtime contract also uses two independent database sessions to verify
-- compare-and-swap confirmation. Keep dblink test-only and in public so the
-- SQL fixture can call it without widening production search paths.
create extension if not exists dblink with schema public;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '30be08c2-6259-42c6-af26-4ded6362de12',
    'authenticated',
    'authenticated',
    'owner-fixture@invalid.ninety-nine-vintage.local',
    extensions.crypt('test-only-password', extensions.gen_salt('bf')),
    clock_timestamp(),
    '{"provider":"kakao","providers":["kakao"],"role":"owner"}'::jsonb,
    '{"display_name":"Owner fixture"}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
    'authenticated',
    'authenticated',
    'operator-a-fixture@invalid.ninety-nine-vintage.local',
    extensions.crypt('test-only-password', extensions.gen_salt('bf')),
    clock_timestamp(),
    '{"provider":"kakao","providers":["kakao"],"role":"member"}'::jsonb,
    '{"display_name":"Operator A fixture"}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
    'authenticated',
    'authenticated',
    'operator-b-fixture@invalid.ninety-nine-vintage.local',
    extensions.crypt('test-only-password', extensions.gen_salt('bf')),
    clock_timestamp(),
    '{"provider":"kakao","providers":["kakao"],"role":"member"}'::jsonb,
    '{"display_name":"Operator B fixture"}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    '',
    '',
    '',
    ''
  )
on conflict (id) do nothing;

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values
  (
    '30be08c2-6259-42c6-af26-4ded6362de12',
    '30be08c2-6259-42c6-af26-4ded6362de12',
    jsonb_build_object(
      'sub', '30be08c2-6259-42c6-af26-4ded6362de12',
      'email', 'owner-fixture@invalid.ninety-nine-vintage.local'
    ),
    'kakao',
    clock_timestamp(),
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
    '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
    jsonb_build_object(
      'sub', '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee',
      'email', 'operator-a-fixture@invalid.ninety-nine-vintage.local'
    ),
    'kakao',
    clock_timestamp(),
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
    jsonb_build_object(
      'sub', '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
      'email', 'operator-b-fixture@invalid.ninety-nine-vintage.local'
    ),
    'kakao',
    clock_timestamp(),
    clock_timestamp(),
    clock_timestamp()
  )
on conflict (provider_id, provider) do nothing;
