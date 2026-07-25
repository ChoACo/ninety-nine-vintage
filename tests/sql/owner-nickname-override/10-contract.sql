\set ON_ERROR_STOP on

insert into app_private.ledger_principals (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');

insert into public.profiles (id, display_name) values
  ('11111111-1111-4111-8111-111111111111', '소유자'),
  ('22222222-2222-4222-8222-222222222222', '기존닉네임'),
  ('33333333-3333-4333-8333-333333333333', '일반회원');

insert into public.account_access_roles (user_id, role_code) values
  ('11111111-1111-4111-8111-111111111111', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'operator'),
  ('33333333-3333-4333-8333-333333333333', 'member');

insert into public.member_accounts (member_id, account_status) values
  ('11111111-1111-4111-8111-111111111111', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'active'),
  ('33333333-3333-4333-8333-333333333333', 'active');

insert into public.nickname_change_requests (
  member_id,
  requested_nickname
) values (
  '22222222-2222-4222-8222-222222222222',
  '승인대기닉네임'
);

do $$
declare
  v_result jsonb;
begin
  perform set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    true
  );
  select public.owner_set_account_nickname(
    '22222222-2222-4222-8222-222222222222',
    '새 닉네임',
    '소유자 직접 변경 검증'
  ) into v_result;

  assert v_result ->> 'nickname' = '새 닉네임';
  assert (
    select profiles.display_name = '새 닉네임'
      and profiles.nickname_initialized_at is not null
    from public.profiles as profiles
    where profiles.id = '22222222-2222-4222-8222-222222222222'
  );
  assert (
    select requests.status = 'cancelled'
      and requests.reviewed_by =
        '11111111-1111-4111-8111-111111111111'::uuid
      and requests.reviewed_at is not null
    from public.nickname_change_requests as requests
    where requests.member_id =
      '22222222-2222-4222-8222-222222222222'
  );
  assert (
    select events.action = 'nickname.owner_override'
      and events.before_state ->> 'nickname' = '기존닉네임'
      and events.after_state ->> 'nickname' = '새 닉네임'
    from app_private.member_management_events as events
    where events.member_id =
      '22222222-2222-4222-8222-222222222222'
  );
end;
$$;

do $$
begin
  perform set_config(
    'request.jwt.claim.sub',
    '33333333-3333-4333-8333-333333333333',
    true
  );
  begin
    perform public.owner_set_account_nickname(
      '22222222-2222-4222-8222-222222222222',
      '권한없는변경',
      '거부 검증'
    );
    raise exception 'non-owner nickname override unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
