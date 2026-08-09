begin;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '30be08c2-6259-42c6-af26-4ded6362de12',
    'role', 'authenticated'
  )::text,
  true
);

update public.profiles
set deleted_at = null
where id = '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d';

insert into public.kakao_member_profiles(member_id, kakao_subject, profile_complete)
values ('9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d', 'operator-boundary-fixture', true);

insert into public.account_access_roles(user_id, role_code)
values ('9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d', 'operator')
on conflict (user_id) do update
set role_code = excluded.role_code;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $$
begin
  begin
    perform public.set_member_access_role(
      '10000000-0000-4000-8000-000000000001',
      'band_member'
    );
    raise exception 'operator changed a global member role';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.add_member_warning(
      '10000000-0000-4000-8000-000000000001',
      'manual',
      'operator must be denied'
    );
    raise exception 'operator created a global warning';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.manage_member_sanction(
      'create',
      '10000000-0000-4000-8000-000000000001',
      null,
      clock_timestamp(),
      clock_timestamp() + interval '1 day',
      'operator must be denied'
    );
    raise exception 'operator created a global sanction';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
rollback;
