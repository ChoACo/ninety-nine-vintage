begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';

create or replace function public.owner_force_ledger_rollback_service(
  p_actor_owner_id uuid,
  p_action text,
  p_entity_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
    or p_actor_owner_id is null
    or not exists (
      select 1
      from public.account_access_roles roles
      where roles.user_id = p_actor_owner_id
        and roles.role_code = 'owner'
        and roles.grade_level = 0
    )
  then
    raise exception using errcode='42501',message='신뢰된 소유자 서버 요청이 필요합니다.';
  end if;
  perform set_config('request.jwt.claim.sub',p_actor_owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  return public.owner_force_ledger_rollback(
    p_action,p_entity_id,p_expected_version,p_reason,p_idempotency_key
  );
end;
$$;

create or replace function public.owner_restore_ledger_repair_event_service(
  p_actor_owner_id uuid,
  p_event_id uuid,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
    or p_actor_owner_id is null
    or not exists (
      select 1
      from public.account_access_roles roles
      where roles.user_id = p_actor_owner_id
        and roles.role_code = 'owner'
        and roles.grade_level = 0
    )
  then
    raise exception using errcode='42501',message='신뢰된 소유자 서버 요청이 필요합니다.';
  end if;
  perform set_config('request.jwt.claim.sub',p_actor_owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  return public.owner_restore_ledger_repair_event(
    p_event_id,p_reason,p_idempotency_key
  );
end;
$$;

revoke all on function public.owner_force_ledger_rollback(text,uuid,bigint,text,uuid)
from public,anon,authenticated,service_role;
revoke all on function public.owner_restore_ledger_repair_event(uuid,text,uuid)
from public,anon,authenticated,service_role;
revoke all on function public.owner_force_ledger_rollback_service(uuid,text,uuid,bigint,text,uuid)
from public,anon,authenticated,service_role;
revoke all on function public.owner_restore_ledger_repair_event_service(uuid,uuid,text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.owner_force_ledger_rollback_service(uuid,text,uuid,bigint,text,uuid)
to service_role;
grant execute on function public.owner_restore_ledger_repair_event_service(uuid,uuid,text,uuid)
to service_role;

comment on function public.owner_force_ledger_rollback_service(uuid,text,uuid,bigint,text,uuid) is
  'Trusted-server-only bridge. Revalidates the supplied grade-zero Owner before entering the audited force rollback transaction.';
comment on function public.owner_restore_ledger_repair_event_service(uuid,uuid,text,uuid) is
  'Trusted-server-only bridge. Revalidates the supplied grade-zero Owner before restoring an audited rollback snapshot.';

commit;
