begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

alter table public.owner_store_management_events
  drop constraint if exists owner_store_management_events_action_check;

alter table public.owner_store_management_events
  add constraint owner_store_management_events_action_check
  check (
    action in (
      'create', 'update', 'archive', 'restore',
      'employee_assign', 'employee_remove',
      'operator_assign', 'operator_remove',
      'banner_update'
    )
  );

create or replace function public.update_owner_store_banner(
  p_store_id uuid,
  p_banner_url text,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_grade_zero_owner();
  v_before public.stores%rowtype;
  v_after public.stores%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_existing_action text;
  v_existing_request jsonb;
begin
  if p_store_id is null or p_expected_version is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = '매장과 현재 버전을 확인해 주세요.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = '처리 사유를 확인해 주세요.';
  end if;
  if p_banner_url is not null and (
    char_length(btrim(p_banner_url)) > 500
    or btrim(p_banner_url) !~ '^https?://'
  ) then
    raise exception using errcode = '22023', message = '배너 이미지 주소를 확인해 주세요.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0)
  );
  v_request := jsonb_build_object(
    'action', 'banner_update',
    'storeId', p_store_id,
    'bannerUrl', nullif(btrim(coalesce(p_banner_url, '')), ''),
    'expectedVersion', p_expected_version
  );

  select events.action, events.request_snapshot, events.result
    into v_existing_action, v_existing_request, v_result
  from public.owner_store_management_events as events
  where events.actor_user_id = v_actor
    and events.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_action <> 'banner_update' or v_existing_request <> v_request then
      raise exception using errcode = '55000', message = '같은 중복 처리 방지 키로 다른 요청을 처리할 수 없습니다.';
    end if;
    return v_result;
  end if;

  select stores.* into v_before
  from public.stores as stores
  where stores.id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '매장을 찾을 수 없습니다.';
  end if;
  if v_before.version <> p_expected_version then
    raise exception using errcode = '55000', message = '매장 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  update public.stores
  set banner_url = nullif(btrim(coalesce(p_banner_url, '')), ''),
      mall_image = nullif(btrim(coalesce(p_banner_url, '')), ''),
      version = version + 1,
      updated_at = now()
  where id = p_store_id
  returning * into v_after;

  v_result := jsonb_build_object(
    'storeId', v_after.id,
    'bannerUrl', v_after.banner_url,
    'version', v_after.version
  );
  insert into public.owner_store_management_events (
    actor_user_id, idempotency_key, action, store_id, reason,
    request_snapshot, before_snapshot, after_snapshot, result
  ) values (
    v_actor, p_idempotency_key, 'banner_update', v_after.id, btrim(p_reason),
    v_request,
    jsonb_build_object('bannerUrl', v_before.banner_url, 'version', v_before.version),
    jsonb_build_object('bannerUrl', v_after.banner_url, 'version', v_after.version),
    v_result
  );
  return v_result;
end;
$$;

revoke all on function public.update_owner_store_banner(uuid, text, bigint, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.update_owner_store_banner(uuid, text, bigint, uuid, text)
to authenticated;

comment on function public.update_owner_store_banner(uuid, text, bigint, uuid, text) is
  'Grade-zero owner CAS update for a public store banner with idempotent audit logging.';

commit;
