-- Ensure the serialized owner PIN-attempt RPC exists in environments where
-- the owner-session tables were deployed before the final hardening step.
create or replace function public.process_owner_mode_pin_attempt(
  p_owner_id uuid,
  p_matches boolean
)
returns table (
  allowed boolean,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_failed_attempts smallint;
  v_window_started_at timestamptz;
  v_locked_until timestamptz;
begin
  if public.access_role_for_user(p_owner_id) <> 'owner' then
    raise exception using errcode = '42501', message = '전용 모드 접근 권한이 없습니다.';
  end if;

  insert into public.owner_mode_unlock_limits (owner_id)
  values (p_owner_id)
  on conflict (owner_id) do nothing;

  select
    limits.failed_attempts,
    limits.window_started_at,
    limits.locked_until
  into
    v_failed_attempts,
    v_window_started_at,
    v_locked_until
  from public.owner_mode_unlock_limits as limits
  where limits.owner_id = p_owner_id
  for update;

  if v_locked_until is not null and v_locked_until > v_now then
    return query select false, v_locked_until;
    return;
  end if;

  if v_window_started_at <= v_now - interval '15 minutes' then
    v_failed_attempts := 0;
    v_window_started_at := v_now;
    v_locked_until := null;
  end if;

  if p_matches is true then
    update public.owner_mode_unlock_limits
    set
      failed_attempts = 0,
      window_started_at = v_now,
      locked_until = null,
      updated_at = v_now
    where owner_id = p_owner_id;
    return query select true, null::timestamptz;
    return;
  end if;

  v_failed_attempts := v_failed_attempts + 1;
  v_locked_until := case
    when v_failed_attempts >= 5 then v_now + interval '15 minutes'
    else null
  end;

  update public.owner_mode_unlock_limits
  set
    failed_attempts = v_failed_attempts,
    window_started_at = v_window_started_at,
    locked_until = v_locked_until,
    updated_at = v_now
  where owner_id = p_owner_id;

  return query select false, v_locked_until;
end;
$$;

revoke all on function public.process_owner_mode_pin_attempt(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.process_owner_mode_pin_attempt(uuid, boolean)
  to service_role;
