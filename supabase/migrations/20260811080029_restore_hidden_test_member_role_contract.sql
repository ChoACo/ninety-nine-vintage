-- Restore the hidden owner test-member exception that was unintentionally
-- removed when the store-scoped role contract replaced these functions.
-- The exception remains narrow: only an active, server-provisioned hidden
-- identity may hold the ordinary member role, without an operator parent.

create or replace function public.validate_account_access_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_hidden_test boolean := public.is_owner_hidden_test_member(new.user_id);
begin
  if tg_op = 'UPDATE' and old.role_code = 'owner' and
     row(new.user_id, new.role_code, new.reports_to_operator_id)
       is distinct from row(old.user_id, old.role_code, old.reports_to_operator_id)
  then
    raise exception using errcode = '42501', message = '소유자 역할은 변경하거나 이전할 수 없습니다.';
  end if;

  if v_is_hidden_test
    and (new.role_code <> 'member' or new.reports_to_operator_id is not null)
  then
    raise exception using errcode = '42501', message = '숨은 테스트 계정은 일반 회원 역할만 사용할 수 있습니다.';
  end if;

  if new.role_code = 'owner' then
    if new.reports_to_operator_id is not null
      or not exists (select 1 from auth.users where id = new.user_id)
    then
      raise exception using errcode = '23514', message = '유효한 인증 계정만 소유자 역할을 유지할 수 있습니다.';
    end if;
  elsif not v_is_hidden_test
    and not public.auth_user_has_kakao_identity(new.user_id)
  then
    raise exception using errcode = '23514', message = 'Kakao 인증 계정에만 운영 역할을 부여할 수 있습니다.';
  end if;

  if new.role_code <> 'employee' and new.reports_to_operator_id is not null then
    raise exception using errcode = '23514', message = '담당 운영자는 직원 역할에만 지정할 수 있습니다.';
  end if;
  if new.role_code = 'employee' and new.reports_to_operator_id is null then
    raise exception using errcode = '23514', message = '직원에게 담당 운영자를 지정해 주세요.';
  end if;
  if new.reports_to_operator_id is not null and not exists (
    select 1
    from public.account_access_roles as roles
    where roles.user_id = new.reports_to_operator_id
      and roles.role_code = 'operator'
  ) then
    raise exception using errcode = '23514', message = '유효한 운영자를 지정해 주세요.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_account_access_role()
from public, anon, authenticated, service_role;

create or replace function public.access_role_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when profiles.deleted_at is not null then null
    when public.owner_member_mode_is_active(p_user_id) then 'member'
    when roles.role_code = 'owner' and exists (
      select 1
      from auth.users as users
      where users.id = roles.user_id
    ) then 'owner'
    when roles.role_code = 'member'
      and public.is_owner_hidden_test_member(roles.user_id)
    then 'member'
    when roles.role_code <> 'owner'
      and public.auth_user_has_kakao_identity(roles.user_id)
    then roles.role_code
    else null
  end
  from public.account_access_roles as roles
  join public.profiles as profiles on profiles.id = roles.user_id
  where roles.user_id = p_user_id;
$$;

revoke all on function public.access_role_for_user(uuid) from public, anon;
grant execute on function public.access_role_for_user(uuid)
to authenticated, service_role;

comment on function public.access_role_for_user(uuid) is
  'Returns the effective role, including owner member-mode and the isolated hidden test-member exception.';
