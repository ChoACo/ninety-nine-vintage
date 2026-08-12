-- Record each successful Owner-initiated switch to the dedicated production
-- member account without reopening the retired Owner-as-member role mode.

create or replace function public.owner_record_hidden_test_member_session_access(
  p_test_user_id uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_audit_id bigint;
begin
  if v_owner_id is null
    or public.access_role_for_user(v_owner_id) <> 'owner'
  then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;

  perform 1
  from public.owner_hidden_test_members as test_members
  join public.account_access_roles as roles
    on roles.user_id = test_members.test_user_id
   and roles.role_code = 'member'
   and roles.grade_level = 3
  join public.member_accounts as accounts
    on accounts.member_id = test_members.test_user_id
  where test_members.owner_id = v_owner_id
    and test_members.test_user_id = p_test_user_id
    and test_members.retired_at is null
    and public.effective_member_account_status(accounts.member_id) = 'active'
  for key share of test_members;

  if not found then
    raise exception using errcode = '42501', message = '활성 테스트 회원 권한이 없습니다.';
  end if;

  v_audit_id := public.insert_owner_hidden_test_member_audit(
    v_owner_id,
    p_test_user_id,
    'test_member.session_accessed',
    jsonb_build_object('authentication', 'password_session')
  );
  return v_audit_id;
end;
$$;

revoke all on function public.owner_record_hidden_test_member_session_access(uuid)
from public, anon, service_role;
grant execute on function public.owner_record_hidden_test_member_session_access(uuid)
to authenticated;

comment on function public.owner_record_hidden_test_member_session_access(uuid) is
  'Validates and audits a successful Owner-initiated switch to the linked active production test member.';
