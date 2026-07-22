insert into public.profiles (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000005'),
  ('10000000-0000-4000-8000-000000000006');

insert into public.account_access_roles (
  user_id,
  role_code,
  reports_to_operator_id
) values
  ('10000000-0000-4000-8000-000000000001', 'owner', null),
  ('10000000-0000-4000-8000-000000000002', 'operator', null),
  ('10000000-0000-4000-8000-000000000003', 'operator', null),
  ('10000000-0000-4000-8000-000000000004', 'employee', '10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000005', 'employee', '10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000006', 'member', null);

insert into public.stores (id, name, operator_id, is_active) values
  (
    '20000000-0000-4000-8000-000000000001',
    'Store A',
    '10000000-0000-4000-8000-000000000002',
    true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Store B',
    '10000000-0000-4000-8000-000000000003',
    true
  );

-- The intake migration must prove its own post-deploy projections. No legacy
-- orders, items, shipping requests, or physical-location claims are seeded.
