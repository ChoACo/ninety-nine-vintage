begin;

create or replace function public.owner_set_account_nickname(
  p_member_id uuid,
  p_nickname text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_nickname text := public.assert_valid_member_nickname(p_nickname);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_role text;
  v_previous_nickname text;
  v_cancelled_request_count integer := 0;
begin
  if v_actor_id is null or not public.is_owner() then
    raise exception using
      errcode = '42501',
      message = '소유자 권한이 필요합니다.';
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception using
      errcode = '22023',
      message = '닉네임 변경 사유를 1자 이상 500자 이하로 입력해 주세요.';
  end if;

  select
    roles.role_code,
    profiles.display_name
  into
    v_role,
    v_previous_nickname
  from public.account_access_roles as roles
  join public.profiles as profiles
    on profiles.id = roles.user_id
   and profiles.deleted_at is null
  join public.member_accounts as accounts
    on accounts.member_id = profiles.id
   and accounts.account_status <> 'deleted'
  where roles.user_id = p_member_id
  for update of profiles;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '닉네임을 변경할 활성 계정을 찾을 수 없습니다.';
  end if;
  if v_role not in ('operator', 'employee', 'band_member', 'member') then
    raise exception using
      errcode = '42501',
      message = '소유자 계정의 닉네임은 이 기능으로 변경할 수 없습니다.';
  end if;
  if v_previous_nickname = v_nickname then
    raise exception using
      errcode = '22023',
      message = '현재 닉네임과 다른 값을 입력해 주세요.';
  end if;

  update public.profiles
  set
    display_name = v_nickname,
    nickname_initialized_at = coalesce(
      nickname_initialized_at,
      clock_timestamp()
    )
  where id = p_member_id;

  update public.nickname_change_requests
  set
    status = 'cancelled',
    reviewed_by = v_actor_id,
    review_note = left('소유자 직접 변경: ' || v_reason, 300),
    reviewed_at = clock_timestamp()
  where member_id = p_member_id
    and status = 'pending';
  get diagnostics v_cancelled_request_count = row_count;

  insert into app_private.member_management_events (
    actor_id,
    member_id,
    action,
    reason,
    before_state,
    after_state
  ) values (
    v_actor_id,
    p_member_id,
    'nickname.owner_override',
    v_reason,
    jsonb_build_object(
      'nickname', v_previous_nickname,
      'role', v_role
    ),
    jsonb_build_object(
      'nickname', v_nickname,
      'role', v_role,
      'cancelledPendingRequestCount', v_cancelled_request_count
    )
  );

  return jsonb_build_object(
    'memberId', p_member_id,
    'nickname', v_nickname,
    'previousNickname', v_previous_nickname,
    'cancelledPendingRequestCount', v_cancelled_request_count
  );
end;
$$;

revoke all on function public.owner_set_account_nickname(uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.owner_set_account_nickname(uuid, text, text)
to authenticated;

comment on function public.owner_set_account_nickname(uuid, text, text)
  is 'Owner-only audited nickname override for active non-owner accounts; pending review requests are cancelled.';

commit;
