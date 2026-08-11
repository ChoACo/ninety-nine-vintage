-- Auth profile creation already inserts member_accounts with zero credits.
-- Provisioning the isolated owner test member must therefore reset that row
-- to the documented ten-credit baseline on both insert and conflict paths.

create or replace function public.provision_owner_hidden_test_member(
  p_actor_owner_id uuid,
  p_test_user_id uuid,
  p_label text default '테스트 회원'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_metadata jsonb;
begin
  if public.access_role_for_user(p_actor_owner_id) <> 'owner' then
    raise exception using errcode = '42501', message = '테스트 계정을 만들 소유자를 확인할 수 없습니다.';
  end if;
  if p_test_user_id is null or p_test_user_id = p_actor_owner_id
    or char_length(v_label) not between 2 and 40
  then
    raise exception using errcode = '22023', message = '테스트 계정 정보를 확인해 주세요.';
  end if;

  select coalesce(users.raw_app_meta_data, '{}'::jsonb)
  into v_metadata
  from auth.users as users
  where users.id = p_test_user_id
  for update;

  if v_metadata is null
    or v_metadata ->> 'account_type' <> 'owner_hidden_test'
    or v_metadata ->> 'provisioned_by_owner' <> p_actor_owner_id::text
    or exists (
      select 1 from auth.identities as identities
      where identities.user_id = p_test_user_id
        and identities.provider = 'kakao'
    )
  then
    raise exception using errcode = '42501', message = '신뢰된 서버가 만든 비로그인 테스트 Auth 계정이 아닙니다.';
  end if;

  if not exists (select 1 from public.profiles where id = p_test_user_id) then
    raise exception using errcode = 'P0002', message = '테스트 회원 프로필이 아직 생성되지 않았습니다.';
  end if;
  if exists (
    select 1 from public.owner_hidden_test_members
    where owner_id = p_actor_owner_id
      and retired_at is null
      and test_user_id <> p_test_user_id
  ) then
    raise exception using errcode = '23505', message = '활성 테스트 계정은 한 개만 유지할 수 있습니다.';
  end if;

  perform set_config('app.owner_hidden_test_actor', p_actor_owner_id::text, true);

  insert into public.owner_hidden_test_members (
    test_user_id,
    owner_id,
    label
  )
  values (p_test_user_id, p_actor_owner_id, v_label)
  on conflict (test_user_id) do update
  set label = excluded.label, retired_at = null;

  insert into public.account_access_roles (
    user_id,
    role_code,
    reports_to_operator_id
  )
  values (p_test_user_id, 'member', null)
  on conflict (user_id) do update
  set role_code = 'member', reports_to_operator_id = null;

  insert into public.member_accounts (
    member_id,
    shipping_credit_count,
    account_status
  )
  values (p_test_user_id, 10, 'active')
  on conflict (member_id) do update
  set
    shipping_credit_count = excluded.shipping_credit_count,
    account_status = excluded.account_status;

  update public.profiles
  set
    display_name = left(v_label, 40),
    nickname_initialized_at = coalesce(nickname_initialized_at, clock_timestamp()),
    nickname_self_change_used_at = coalesce(nickname_self_change_used_at, clock_timestamp())
  where id = p_test_user_id;

  perform public.insert_owner_hidden_test_member_audit(
    p_actor_owner_id,
    p_test_user_id,
    'test_member.provisioned',
    jsonb_build_object('label', v_label, 'initial_shipping_credits', 10)
  );
  return p_test_user_id;
end;
$$;

revoke all on function public.provision_owner_hidden_test_member(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.provision_owner_hidden_test_member(uuid, uuid, text)
to service_role;
