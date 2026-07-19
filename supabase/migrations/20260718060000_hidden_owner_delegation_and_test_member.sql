-- Replace the PIN-gated "owner mode" with an always-authorized internal owner
-- identity, an explicit operator-delegation context, and a non-login test
-- member. The owner remains role level 0 internally, but public UI continues
-- to map that private role to the ordinary "운영자" label.
--
-- Delegation is deliberately not JWT impersonation. Every context switch and
-- every action performed through a delegated wrapper must be committed with
-- the real actor UUID, target operator UUID, action name, and JSON payload in
-- the immutable audit table below.

drop function if exists public.process_owner_mode_pin_attempt(uuid, boolean);
drop table if exists public.owner_mode_unlock_limits cascade;
drop table if exists public.owner_mode_sessions cascade;

do $$
declare
  v_owner_id constant uuid := '30be08c2-6259-42c6-af26-4ded6362de12'::uuid;
begin
  if not exists (
    select 1
    from public.account_access_roles as roles
    join auth.identities as identities
      on identities.user_id = roles.user_id
     and identities.provider = 'kakao'
    where roles.user_id = v_owner_id
      and roles.role_code = 'owner'
      and roles.grade_level = 0.0
  ) then
    raise exception using
      errcode = 'P0001',
      message = '지정된 카카오 소유자의 0등급 권한을 확인할 수 없습니다.';
  end if;
end;
$$;

create table public.owner_operator_delegation_targets (
  owner_id uuid not null references public.profiles (id) on delete restrict,
  operator_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, operator_id),
  check (owner_id <> operator_id)
);

alter table public.owner_operator_delegation_targets enable row level security;
alter table public.owner_operator_delegation_targets force row level security;
revoke all on public.owner_operator_delegation_targets
from public, anon, authenticated, service_role;

create or replace function public.validate_owner_operator_delegation_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.access_role_for_user(new.owner_id) <> 'owner' then
    raise exception using errcode = '42501', message = '유효한 소유자 계정이 아닙니다.';
  end if;
  if public.access_role_for_user(new.operator_id) <> 'operator' then
    raise exception using errcode = '23514', message = '유효한 운영자 계정만 대리 대상으로 지정할 수 있습니다.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_owner_operator_delegation_target()
from public, anon, authenticated, service_role;

create trigger owner_operator_delegation_targets_validate
before insert or update on public.owner_operator_delegation_targets
for each row execute function public.validate_owner_operator_delegation_target();

insert into public.owner_operator_delegation_targets (owner_id, operator_id)
values
  (
    '30be08c2-6259-42c6-af26-4ded6362de12'::uuid,
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'::uuid
  ),
  (
    '30be08c2-6259-42c6-af26-4ded6362de12'::uuid,
    '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'::uuid
  )
on conflict (owner_id, operator_id) do nothing;

do $$
begin
  if (
    select count(*)
    from public.owner_operator_delegation_targets as targets
    where targets.owner_id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
      and targets.operator_id in (
        '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d'::uuid,
        '4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee'::uuid
      )
  ) <> 2 then
    raise exception using
      errcode = 'P0001',
      message = '승인된 두 운영자 대리 대상을 확인하지 못했습니다.';
  end if;
end;
$$;

create table public.owner_operator_delegation_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_owner_id uuid not null references public.profiles (id) on delete restrict,
  target_operator_id uuid not null references public.profiles (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  check (expires_at > created_at),
  check (ended_at is null or ended_at >= created_at),
  foreign key (actor_owner_id, target_operator_id)
    references public.owner_operator_delegation_targets (owner_id, operator_id)
    on delete restrict
);

create unique index owner_operator_delegation_one_active_idx
on public.owner_operator_delegation_sessions (actor_owner_id)
where ended_at is null;
create index owner_operator_delegation_session_history_idx
on public.owner_operator_delegation_sessions
  (actor_owner_id, created_at desc, id);

alter table public.owner_operator_delegation_sessions enable row level security;
alter table public.owner_operator_delegation_sessions force row level security;
revoke all on public.owner_operator_delegation_sessions
from public, anon, authenticated, service_role;

create table public.owner_operator_delegation_audit (
  id bigint generated always as identity primary key,
  session_id uuid not null
    references public.owner_operator_delegation_sessions (id) on delete restrict,
  actor_owner_id uuid not null,
  target_operator_id uuid not null,
  action text not null
    check (action ~ '^[a-z][a-z0-9_.:-]{2,79}$'),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object')
    check (octet_length(payload::text) <= 32768),
  occurred_at timestamptz not null default clock_timestamp()
);

create index owner_operator_delegation_audit_actor_time_idx
on public.owner_operator_delegation_audit
  (actor_owner_id, occurred_at desc, id desc);
create index owner_operator_delegation_audit_target_time_idx
on public.owner_operator_delegation_audit
  (target_operator_id, occurred_at desc, id desc);

alter table public.owner_operator_delegation_audit enable row level security;
alter table public.owner_operator_delegation_audit force row level security;
revoke all on public.owner_operator_delegation_audit
from public, anon, authenticated, service_role;

create or replace function public.reject_append_only_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = '감사 로그는 수정하거나 삭제할 수 없습니다.';
end;
$$;

revoke all on function public.reject_append_only_audit_mutation()
from public, anon, authenticated, service_role;

create trigger owner_operator_delegation_audit_append_only
before update or delete or truncate on public.owner_operator_delegation_audit
for each statement execute function public.reject_append_only_audit_mutation();

create or replace function public.insert_owner_operator_delegation_audit(
  p_session_id uuid,
  p_actor_owner_id uuid,
  p_target_operator_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id bigint;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if public.access_role_for_user(p_actor_owner_id) <> 'owner' then
    raise exception using errcode = '42501', message = '감사 로그의 행위자가 유효한 소유자가 아닙니다.';
  end if;
  if coalesce(p_action, '') !~ '^[a-z][a-z0-9_.:-]{2,79}$' then
    raise exception using errcode = '22023', message = '감사 작업 코드 형식이 올바르지 않습니다.';
  end if;
  if jsonb_typeof(v_payload) <> 'object' or octet_length(v_payload::text) > 32768 then
    raise exception using errcode = '22023', message = '감사 payload 형식이나 크기가 올바르지 않습니다.';
  end if;
  if not exists (
    select 1
    from public.owner_operator_delegation_sessions as sessions
    where sessions.id = p_session_id
      and sessions.actor_owner_id = p_actor_owner_id
      and sessions.target_operator_id = p_target_operator_id
  ) then
    raise exception using errcode = '42501', message = '대리 세션과 감사 주체가 일치하지 않습니다.';
  end if;

  insert into public.owner_operator_delegation_audit (
    session_id,
    actor_owner_id,
    target_operator_id,
    action,
    payload
  )
  values (
    p_session_id,
    p_actor_owner_id,
    p_target_operator_id,
    p_action,
    v_payload
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

revoke all on function public.insert_owner_operator_delegation_audit(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.begin_owner_operator_delegation(
  p_target_operator_id uuid,
  p_reason text
)
returns table (
  session_id uuid,
  target_operator_id uuid,
  target_display_name text,
  reason text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_previous record;
  v_session public.owner_operator_delegation_sessions%rowtype;
  v_target_name text;
begin
  if v_actor is null or public.access_role_for_user(v_actor) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자만 운영자 대리 컨텍스트를 시작할 수 있습니다.';
  end if;
  if char_length(v_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = '대리 사유를 3자 이상 300자 이하로 입력해 주세요.';
  end if;
  if not exists (
    select 1
    from public.owner_operator_delegation_targets as targets
    where targets.owner_id = v_actor
      and targets.operator_id = p_target_operator_id
      and public.access_role_for_user(targets.operator_id) = 'operator'
  ) then
    raise exception using errcode = '42501', message = '승인되지 않은 운영자 대리 대상입니다.';
  end if;

  for v_previous in
    select sessions.*
    from public.owner_operator_delegation_sessions as sessions
    where sessions.actor_owner_id = v_actor
      and sessions.ended_at is null
    for update
  loop
    update public.owner_operator_delegation_sessions
    set ended_at = clock_timestamp(), last_used_at = clock_timestamp()
    where id = v_previous.id;

    perform public.insert_owner_operator_delegation_audit(
      v_previous.id,
      v_actor,
      v_previous.target_operator_id,
      'delegation.replaced',
      jsonb_build_object('replacement_target_id', p_target_operator_id)
    );
  end loop;

  insert into public.owner_operator_delegation_sessions (
    actor_owner_id,
    target_operator_id,
    reason,
    expires_at
  )
  values (
    v_actor,
    p_target_operator_id,
    v_reason,
    clock_timestamp() + interval '2 hours'
  )
  returning * into v_session;

  perform public.insert_owner_operator_delegation_audit(
    v_session.id,
    v_actor,
    p_target_operator_id,
    'delegation.started',
    jsonb_build_object('reason', v_reason, 'expires_at', v_session.expires_at)
  );

  select profiles.display_name
  into v_target_name
  from public.profiles as profiles
  where profiles.id = p_target_operator_id;

  return query
  select
    v_session.id,
    p_target_operator_id,
    v_target_name,
    v_session.reason,
    v_session.created_at,
    v_session.expires_at;
end;
$$;

revoke all on function public.begin_owner_operator_delegation(uuid, text)
from public, anon;
grant execute on function public.begin_owner_operator_delegation(uuid, text)
to authenticated;

create or replace function public.get_current_owner_operator_delegation()
returns table (
  session_id uuid,
  target_operator_id uuid,
  target_display_name text,
  reason text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.access_role_for_user(auth.uid()) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;

  return query
  select
    sessions.id,
    sessions.target_operator_id,
    profiles.display_name,
    sessions.reason,
    sessions.created_at,
    sessions.expires_at
  from public.owner_operator_delegation_sessions as sessions
  join public.profiles as profiles on profiles.id = sessions.target_operator_id
  where sessions.actor_owner_id = auth.uid()
    and sessions.ended_at is null
    and sessions.expires_at > statement_timestamp()
  order by sessions.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_current_owner_operator_delegation()
from public, anon;
grant execute on function public.get_current_owner_operator_delegation()
to authenticated;

create or replace function public.end_owner_operator_delegation(
  p_session_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.owner_operator_delegation_sessions%rowtype;
begin
  if v_actor is null or public.access_role_for_user(v_actor) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;

  select sessions.*
  into v_session
  from public.owner_operator_delegation_sessions as sessions
  where sessions.actor_owner_id = v_actor
    and sessions.ended_at is null
    and (p_session_id is null or sessions.id = p_session_id)
  order by sessions.created_at desc
  limit 1
  for update;

  if not found then return false; end if;

  update public.owner_operator_delegation_sessions
  set ended_at = clock_timestamp(), last_used_at = clock_timestamp()
  where id = v_session.id;

  perform public.insert_owner_operator_delegation_audit(
    v_session.id,
    v_actor,
    v_session.target_operator_id,
    'delegation.ended',
    '{}'::jsonb
  );
  return true;
end;
$$;

revoke all on function public.end_owner_operator_delegation(uuid)
from public, anon;
grant execute on function public.end_owner_operator_delegation(uuid)
to authenticated;

-- Delegated action wrappers call this inside the same transaction as the real
-- mutation. It returns the effective operator UUID only after committing an
-- immutable event. Calling it separately never grants table access.
create or replace function public.record_owner_operator_delegated_action(
  p_session_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.owner_operator_delegation_sessions%rowtype;
begin
  if v_actor is null or public.access_role_for_user(v_actor) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if coalesce(p_action, '') like 'delegation.%' then
    raise exception using errcode = '22023', message = '예약된 감사 작업 코드는 사용할 수 없습니다.';
  end if;

  select sessions.*
  into v_session
  from public.owner_operator_delegation_sessions as sessions
  where sessions.id = p_session_id
    and sessions.actor_owner_id = v_actor
    and sessions.ended_at is null
    and sessions.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception using errcode = '42501', message = '활성 운영자 대리 세션이 없습니다.';
  end if;

  perform public.insert_owner_operator_delegation_audit(
    v_session.id,
    v_actor,
    v_session.target_operator_id,
    p_action,
    p_payload
  );
  update public.owner_operator_delegation_sessions
  set last_used_at = clock_timestamp()
  where id = v_session.id;

  return v_session.target_operator_id;
end;
$$;

-- Intentionally not granted to a browser role. A security-definer wrapper
-- that performs the corresponding mutation calls it atomically.
revoke all on function public.record_owner_operator_delegated_action(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;

-- For ordinary staff this is simply auth.uid(). For the owner it resolves an
-- active, unexpired delegation session and otherwise deliberately falls back
-- to the owner's real UUID. The helper never changes JWT identity or RLS
-- privileges; it only controls durable business attribution.
create or replace function public.current_owner_delegated_operator()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_target uuid;
begin
  if v_actor is null then return null; end if;
  if public.access_role_for_user(v_actor) <> 'owner' then return v_actor; end if;

  select sessions.target_operator_id
  into v_target
  from public.owner_operator_delegation_sessions as sessions
  where sessions.actor_owner_id = v_actor
    and sessions.ended_at is null
    and sessions.expires_at > statement_timestamp()
  order by sessions.created_at desc
  limit 1;

  return coalesce(v_target, v_actor);
end;
$$;

revoke all on function public.current_owner_delegated_operator() from public;
grant execute on function public.current_owner_delegated_operator()
to authenticated;

create or replace function public.apply_owner_product_delegation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_effective_actor uuid;
  v_session_id uuid;
  v_action text;
begin
  if v_actor is null then
    return new;
  end if;

  if public.access_role_for_user(v_actor) <> 'owner' then
    if tg_op = 'INSERT' then
      new.created_by := v_actor;
      new.updated_by := v_actor;
    end if;
    return new;
  end if;

  v_effective_actor := public.current_owner_delegated_operator();
  if tg_op = 'INSERT' then
    new.created_by := v_effective_actor;
    new.updated_by := v_effective_actor;
    v_action := 'product.insert';
  else
    new.created_by := old.created_by;
    new.updated_by := v_effective_actor;
    v_action := 'product.update';
  end if;

  if v_effective_actor <> v_actor then
    select sessions.id
    into v_session_id
    from public.owner_operator_delegation_sessions as sessions
    where sessions.actor_owner_id = v_actor
      and sessions.target_operator_id = v_effective_actor
      and sessions.ended_at is null
      and sessions.expires_at > clock_timestamp()
    order by sessions.created_at desc
    limit 1
    for update;

    if v_session_id is null then
      raise exception using errcode = '42501', message = '활성 운영자 대리 세션을 확인할 수 없습니다.';
    end if;

    perform public.record_owner_operator_delegated_action(
      v_session_id,
      v_action,
      jsonb_build_object(
        'product_id', new.id,
        'operation', lower(tg_op),
        'status', new.status,
        'previous_updated_by', case when tg_op = 'UPDATE' then old.updated_by else null end
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.apply_owner_product_delegation()
from public, anon, authenticated, service_role;

drop trigger if exists products_apply_owner_delegation on public.products;
create trigger products_apply_owner_delegation
before insert or update on public.products
for each row execute function public.apply_owner_product_delegation();

drop policy if exists "Staff insert products" on public.products;
create policy "Staff insert products"
on public.products
for insert
to authenticated
with check (
  (select public.can_manage_products())
  and created_by = (select public.current_owner_delegated_operator())
  and updated_by = (select public.current_owner_delegated_operator())
  and status in ('pending', 'active')
  and participant_count = 0
  and current_price = starting_price
  and bid_history = '[]'::jsonb
  and bid_locked_at is null
  and final_bid_id is null
  and final_bid_amount is null
);

create or replace function public.list_owner_operator_delegation_targets()
returns table (
  operator_id uuid,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.access_role_for_user(auth.uid()) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;

  return query
  select targets.operator_id, profiles.display_name
  from public.owner_operator_delegation_targets as targets
  join public.profiles as profiles on profiles.id = targets.operator_id
  where targets.owner_id = auth.uid()
    and public.access_role_for_user(targets.operator_id) = 'operator'
  order by profiles.display_name, targets.operator_id;
end;
$$;

revoke all on function public.list_owner_operator_delegation_targets()
from public, anon;
grant execute on function public.list_owner_operator_delegation_targets()
to authenticated;

create or replace function public.get_owner_operator_delegation_audit(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  audit_id bigint,
  session_id uuid,
  actor_owner_id uuid,
  target_operator_id uuid,
  action text,
  payload jsonb,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.access_role_for_user(auth.uid()) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 500
    or p_offset is null or p_offset < 0
  then
    raise exception using errcode = '22023', message = '감사 로그 페이지 범위를 확인해 주세요.';
  end if;

  return query
  select
    audit.id,
    audit.session_id,
    audit.actor_owner_id,
    audit.target_operator_id,
    audit.action,
    audit.payload,
    audit.occurred_at
  from public.owner_operator_delegation_audit as audit
  where audit.actor_owner_id = auth.uid()
  order by audit.occurred_at desc, audit.id desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_owner_operator_delegation_audit(integer, integer)
from public, anon;
grant execute on function public.get_owner_operator_delegation_audit(integer, integer)
to authenticated;

-- A system test member is a real auth/profile/member row so FK-backed bids,
-- payments, and shipments remain realistic. It has random credentials that
-- are never returned and is operated only through owner-only proxy RPCs.
create table public.owner_hidden_test_members (
  test_user_id uuid primary key references public.profiles (id) on delete restrict,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  label text not null check (char_length(btrim(label)) between 2 and 40),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check (test_user_id <> owner_id),
  check (retired_at is null or retired_at >= created_at)
);

create unique index owner_hidden_test_members_one_active_idx
on public.owner_hidden_test_members (owner_id)
where retired_at is null;

alter table public.owner_hidden_test_members enable row level security;
alter table public.owner_hidden_test_members force row level security;
revoke all on public.owner_hidden_test_members
from public, anon, authenticated, service_role;

create or replace function public.is_owner_hidden_test_member(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_hidden_test_members as test_members
    where test_members.test_user_id = p_user_id
  );
$$;

revoke all on function public.is_owner_hidden_test_member(uuid)
from public, anon, authenticated, service_role;

create table public.owner_hidden_test_member_audit (
  id bigint generated always as identity primary key,
  actor_owner_id uuid not null,
  target_test_user_id uuid not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.:-]{2,79}$'),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object')
    check (octet_length(payload::text) <= 32768),
  occurred_at timestamptz not null default clock_timestamp()
);

create index owner_hidden_test_member_audit_actor_time_idx
on public.owner_hidden_test_member_audit
  (actor_owner_id, occurred_at desc, id desc);

alter table public.owner_hidden_test_member_audit enable row level security;
alter table public.owner_hidden_test_member_audit force row level security;
revoke all on public.owner_hidden_test_member_audit
from public, anon, authenticated, service_role;

create trigger owner_hidden_test_member_audit_append_only
before update or delete or truncate on public.owner_hidden_test_member_audit
for each statement execute function public.reject_append_only_audit_mutation();

create or replace function public.insert_owner_hidden_test_member_audit(
  p_actor_owner_id uuid,
  p_target_test_user_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if public.access_role_for_user(p_actor_owner_id) <> 'owner' then
    raise exception using errcode = '42501', message = '유효한 소유자 행위자가 아닙니다.';
  end if;
  if coalesce(p_action, '') !~ '^[a-z][a-z0-9_.:-]{2,79}$'
    or jsonb_typeof(v_payload) <> 'object'
    or octet_length(v_payload::text) > 32768
  then
    raise exception using errcode = '22023', message = '테스트 계정 감사 정보가 올바르지 않습니다.';
  end if;

  insert into public.owner_hidden_test_member_audit (
    actor_owner_id,
    target_test_user_id,
    action,
    payload
  )
  values (p_actor_owner_id, p_target_test_user_id, p_action, v_payload)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.insert_owner_hidden_test_member_audit(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

-- Permit exactly one exception to the Kakao-only account-role invariant: an
-- active, server-provisioned test identity may hold only the ordinary member
-- role. It can never become owner/operator/employee/band_member.
create or replace function public.validate_account_access_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_hidden_test boolean := public.is_owner_hidden_test_member(new.user_id);
begin
  if tg_op = 'UPDATE'
    and old.role_code = 'owner'
    and (
      new.user_id <> old.user_id
      or new.role_code <> old.role_code
      or new.reports_to_operator_id is distinct from old.reports_to_operator_id
    )
  then
    raise exception using errcode = '42501', message = 'owner 역할은 변경하거나 이전할 수 없습니다.';
  end if;

  if v_is_hidden_test
    and (new.role_code <> 'member' or new.reports_to_operator_id is not null)
  then
    raise exception using errcode = '42501', message = '숨은 테스트 계정은 일반 회원 역할만 사용할 수 있습니다.';
  end if;

  if tg_op = 'UPDATE'
    and old.role_code = 'operator'
    and new.role_code <> 'operator'
    and exists (
      select 1
      from public.account_access_roles as employee_roles
      where employee_roles.role_code = 'employee'
        and employee_roles.reports_to_operator_id = old.user_id
    )
  then
    raise exception using errcode = '23514', message = '담당 직원의 역할을 먼저 변경한 뒤 운영자 권한을 해제해 주세요.';
  end if;

  if new.role_code = 'owner' then
    if new.reports_to_operator_id is not null or not exists (
      select 1
      from auth.users as users
      where users.id = new.user_id
        and users.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
        and public.auth_user_has_kakao_identity(users.id)
    ) then
      raise exception using errcode = '23514', message = 'owner 역할은 지정된 관리자 Auth 계정에만 유지할 수 있습니다.';
    end if;
  elsif not v_is_hidden_test and not public.auth_user_has_kakao_identity(new.user_id) then
    raise exception using errcode = '23514', message = '일반 계정은 카카오 인증이 필요합니다.';
  end if;

  if new.role_code <> 'employee' and new.reports_to_operator_id is not null then
    raise exception using errcode = '23514', message = '담당 운영자는 직원 역할에만 지정할 수 있습니다.';
  end if;
  if new.role_code = 'employee' and new.reports_to_operator_id is null then
    raise exception using errcode = '23514', message = '직원에게는 담당 운영자를 지정해야 합니다.';
  end if;
  if new.reports_to_operator_id is not null and not exists (
    select 1
    from public.account_access_roles as roles
    where roles.user_id = new.reports_to_operator_id
      and roles.role_code = 'operator'
      and public.auth_user_has_kakao_identity(roles.user_id)
  ) then
    raise exception using errcode = '23514', message = '담당 운영자는 현재 유효한 카카오 운영자여야 합니다.';
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
    when roles.role_code = 'owner' and exists (
      select 1 from auth.users as users
      where users.id = roles.user_id
        and users.id = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
        and public.auth_user_has_kakao_identity(users.id)
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
  where roles.user_id = p_user_id;
$$;

revoke all on function public.access_role_for_user(uuid) from public;

create or replace function public.protect_owner_hidden_test_member_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_owner_hidden_test_member(old.user_id) then
    if tg_op = 'DELETE' then
      raise exception using errcode = '42501', message = '테스트 계정을 먼저 폐기 처리해야 합니다.';
    end if;
    if new.role_code <> 'member'
      or new.reports_to_operator_id is not null
      or new.user_id <> old.user_id
    then
      raise exception using errcode = '42501', message = '숨은 테스트 계정 역할은 변경할 수 없습니다.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_owner_hidden_test_member_role()
from public, anon, authenticated, service_role;

create trigger account_access_roles_protect_hidden_test
before update or delete on public.account_access_roles
for each row execute function public.protect_owner_hidden_test_member_role();

-- Hidden test rows may be changed only through the dedicated owner RPCs below.
-- Those RPCs set a transaction-local actor marker. service_role operations
-- (for example verified payment webhooks) have no auth.uid() and remain
-- available, while every browser-authenticated legacy management RPC is
-- blocked even if the caller guesses the synthetic UUID.
create or replace function public.protect_owner_hidden_test_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_actor uuid := auth.uid();
  v_marker uuid;
  v_record jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  begin
    v_member_id := nullif(v_record ->> tg_argv[0], '')::uuid;
    if v_member_id is null and tg_op = 'UPDATE' then
      v_member_id := nullif(to_jsonb(old) ->> tg_argv[0], '')::uuid;
    end if;
  exception when invalid_text_representation then
    v_member_id := null;
  end;

  if v_member_id is null or not public.is_owner_hidden_test_member(v_member_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_actor is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  begin
    v_marker := nullif(current_setting('app.owner_hidden_test_actor', true), '')::uuid;
  exception when invalid_text_representation then
    v_marker := null;
  end;
  if v_marker is distinct from v_actor or public.access_role_for_user(v_actor) <> 'owner' then
    raise exception using
      errcode = '42501',
      message = '숨은 테스트 계정은 전용 소유자 작업을 통해서만 변경할 수 있습니다.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_owner_hidden_test_write()
from public, anon, authenticated, service_role;

create trigger profiles_protect_hidden_test_write
before update or delete on public.profiles
for each row execute function public.protect_owner_hidden_test_write('id');
create trigger member_accounts_protect_hidden_test_write
before update or delete on public.member_accounts
for each row execute function public.protect_owner_hidden_test_write('member_id');
create trigger shipping_addresses_protect_hidden_test_write
before insert or update or delete on public.shipping_addresses
for each row execute function public.protect_owner_hidden_test_write('member_id');
create trigger shipping_requests_protect_hidden_test_write
before insert or update or delete on public.shipping_requests
for each row execute function public.protect_owner_hidden_test_write('member_id');
create trigger payment_orders_protect_hidden_test_write
before insert or update or delete on public.payment_orders
for each row execute function public.protect_owner_hidden_test_write('buyer_id');
create trigger member_warnings_protect_hidden_test_write
before insert or update or delete on public.member_warnings
for each row execute function public.protect_owner_hidden_test_write('member_id');
create trigger member_bid_sanctions_protect_hidden_test_write
before insert or update or delete on public.member_bid_sanctions
for each row execute function public.protect_owner_hidden_test_write('member_id');
create trigger support_conversations_protect_hidden_test_write
before insert or update or delete on public.support_conversations
for each row execute function public.protect_owner_hidden_test_write('member_id');

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
  set account_status = 'active';

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

create or replace function public.retire_owner_hidden_test_member(
  p_actor_owner_id uuid,
  p_test_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.access_role_for_user(p_actor_owner_id) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;

  perform set_config('app.owner_hidden_test_actor', p_actor_owner_id::text, true);

  update public.owner_hidden_test_members
  set retired_at = clock_timestamp()
  where owner_id = p_actor_owner_id
    and test_user_id = p_test_user_id
    and retired_at is null;
  if not found then return false; end if;

  perform public.insert_owner_hidden_test_member_audit(
    p_actor_owner_id,
    p_test_user_id,
    'test_member.retired',
    '{}'::jsonb
  );
  return true;
end;
$$;

revoke all on function public.retire_owner_hidden_test_member(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.retire_owner_hidden_test_member(uuid, uuid)
to service_role;

create or replace function public.get_owner_hidden_test_member()
returns table (
  test_user_id uuid,
  display_name text,
  phone text,
  shipping_credit_count integer,
  account_status text,
  created_at timestamptz,
  addresses jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.access_role_for_user(auth.uid()) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;

  return query
  select
    tests.test_user_id,
    profiles.display_name,
    accounts.phone,
    accounts.shipping_credit_count,
    accounts.account_status,
    tests.created_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', addresses.id,
            'label', addresses.label,
            'recipientName', addresses.recipient_name,
            'phone', addresses.phone,
            'address', addresses.address,
            'isDefault', addresses.is_default
          )
          order by addresses.is_default desc, addresses.created_at, addresses.id
        )
        from public.shipping_addresses as addresses
        where addresses.member_id = tests.test_user_id
      ),
      '[]'::jsonb
    )
  from public.owner_hidden_test_members as tests
  join public.profiles as profiles on profiles.id = tests.test_user_id
  join public.member_accounts as accounts on accounts.member_id = tests.test_user_id
  where tests.owner_id = auth.uid()
    and tests.retired_at is null
  limit 1;
end;
$$;

revoke all on function public.get_owner_hidden_test_member()
from public, anon;
grant execute on function public.get_owner_hidden_test_member()
to authenticated;

create or replace function public.get_owner_hidden_test_member_for_service(
  p_actor_owner_id uuid,
  p_include_retired boolean default false
)
returns table (
  test_user_id uuid,
  retired_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.access_role_for_user(p_actor_owner_id) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  return query
  select tests.test_user_id, tests.retired_at
  from public.owner_hidden_test_members as tests
  where tests.owner_id = p_actor_owner_id
    and (p_include_retired or tests.retired_at is null)
  order by tests.retired_at nulls first, tests.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_owner_hidden_test_member_for_service(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.get_owner_hidden_test_member_for_service(uuid, boolean)
to service_role;

create or replace function public.owner_update_hidden_test_member_profile(
  p_display_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_owner is null or public.access_role_for_user(v_owner) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if char_length(v_name) not between 2 and 40
    or (v_phone is not null and char_length(v_phone) not between 7 and 30)
  then
    raise exception using errcode = '22023', message = '테스트 회원 정보 형식을 확인해 주세요.';
  end if;

  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null
  for update;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;

  perform set_config('app.owner_hidden_test_actor', v_owner::text, true);

  update public.profiles set display_name = v_name where id = v_test_user;
  update public.member_accounts set phone = v_phone where member_id = v_test_user;
  perform public.insert_owner_hidden_test_member_audit(
    v_owner,
    v_test_user,
    'test_member.profile_updated',
    jsonb_build_object('display_name', v_name, 'has_phone', v_phone is not null)
  );
end;
$$;

revoke all on function public.owner_update_hidden_test_member_profile(text, text)
from public, anon;
grant execute on function public.owner_update_hidden_test_member_profile(text, text)
to authenticated;

create or replace function public.owner_upsert_hidden_test_shipping_address(
  p_id uuid,
  p_label text,
  p_recipient_name text,
  p_phone text,
  p_address text,
  p_is_default boolean default false
)
returns setof public.shipping_addresses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
  v_address_id uuid := coalesce(p_id, gen_random_uuid());
  v_make_default boolean;
begin
  if v_owner is null or public.access_role_for_user(v_owner) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 40
    or char_length(btrim(coalesce(p_recipient_name, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_phone, ''))) not between 7 and 30
    or char_length(btrim(coalesce(p_address, ''))) not between 5 and 500
  then
    raise exception using errcode = '22023', message = '배송지 정보를 확인해 주세요.';
  end if;

  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null
  for update;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;

  perform set_config('app.owner_hidden_test_actor', v_owner::text, true);

  perform 1 from public.member_accounts
  where member_id = v_test_user for update;
  v_make_default := coalesce(p_is_default, false) or not exists (
    select 1 from public.shipping_addresses
    where member_id = v_test_user and is_default
  );
  if v_make_default then
    update public.shipping_addresses
    set is_default = false
    where member_id = v_test_user and id <> v_address_id and is_default;
  end if;

  insert into public.shipping_addresses (
    id, member_id, label, recipient_name, phone, address, is_default
  )
  values (
    v_address_id,
    v_test_user,
    btrim(p_label),
    btrim(p_recipient_name),
    btrim(p_phone),
    btrim(p_address),
    v_make_default
  )
  on conflict (id) do update
  set
    label = excluded.label,
    recipient_name = excluded.recipient_name,
    phone = excluded.phone,
    address = excluded.address,
    is_default = excluded.is_default
  where shipping_addresses.member_id = v_test_user;
  if not found then
    raise exception using errcode = '42501', message = '다른 회원의 배송지는 수정할 수 없습니다.';
  end if;

  update public.member_accounts set phone = btrim(p_phone)
  where member_id = v_test_user;
  perform public.insert_owner_hidden_test_member_audit(
    v_owner,
    v_test_user,
    'test_member.shipping_address_upserted',
    jsonb_build_object(
      'address_id', v_address_id,
      'label', btrim(p_label),
      'is_default', v_make_default
    )
  );
  return query
  select addresses.*
  from public.shipping_addresses as addresses
  where addresses.id = v_address_id and addresses.member_id = v_test_user;
end;
$$;

revoke all on function public.owner_upsert_hidden_test_shipping_address(
  uuid, text, text, text, text, boolean
) from public, anon;
grant execute on function public.owner_upsert_hidden_test_shipping_address(
  uuid, text, text, text, text, boolean
) to authenticated;

create or replace function public.owner_delete_hidden_test_shipping_address(
  p_address_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
begin
  if v_owner is null or public.access_role_for_user(v_owner) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;

  perform set_config('app.owner_hidden_test_actor', v_owner::text, true);

  delete from public.shipping_addresses
  where id = p_address_id and member_id = v_test_user;
  if not found then return false; end if;

  perform public.insert_owner_hidden_test_member_audit(
    v_owner,
    v_test_user,
    'test_member.shipping_address_deleted',
    jsonb_build_object('address_id', p_address_id)
  );
  return true;
end;
$$;

revoke all on function public.owner_delete_hidden_test_shipping_address(uuid)
from public, anon;
grant execute on function public.owner_delete_hidden_test_shipping_address(uuid)
to authenticated;

create or replace function public.owner_set_hidden_test_shipping_credits(
  p_credit_count integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
begin
  if v_owner is null or public.access_role_for_user(v_owner) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_credit_count is null or p_credit_count not between 0 and 10000 then
    raise exception using errcode = '22023', message = '배송 이용권 범위를 확인해 주세요.';
  end if;
  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null
  for update;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;

  perform set_config('app.owner_hidden_test_actor', v_owner::text, true);

  update public.member_accounts
  set shipping_credit_count = p_credit_count
  where member_id = v_test_user;
  perform public.insert_owner_hidden_test_member_audit(
    v_owner,
    v_test_user,
    'test_member.shipping_credits_set',
    jsonb_build_object('shipping_credit_count', p_credit_count)
  );
  return p_credit_count;
end;
$$;

revoke all on function public.owner_set_hidden_test_shipping_credits(integer)
from public, anon;
grant execute on function public.owner_set_hidden_test_shipping_credits(integer)
to authenticated;

-- Keep the row shape aligned with get_my_won_products() so the owner test
-- console can exercise the same payment/storage split without authenticating
-- as the synthetic account.
create or replace function public.get_owner_hidden_test_won_products()
returns table (
  product_id uuid,
  title text,
  image_urls text[],
  closed_at timestamptz,
  final_bid_amount bigint,
  shipping_status text,
  shipment_request_id uuid,
  payment_id text,
  payment_method text,
  vbank_num text,
  vbank_bank text,
  vbank_due timestamptz,
  payment_status text,
  requested_method text,
  portone_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
begin
  if v_owner is null or public.access_role_for_user(v_owner) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;

  return query
  select
    products.id,
    products.title,
    products.image_urls,
    products.closes_at,
    winner.amount,
    case
      when requests.status = 'shipped' then 'shipped'
      when requests.id is not null then 'requested'
      else 'ready'
    end,
    requests.id,
    orders.payment_id,
    orders.payment_method,
    orders.vbank_num,
    orders.vbank_bank,
    orders.vbank_due,
    coalesce(orders.payment_status, '대기중'),
    orders.requested_method,
    orders.portone_status
  from public.products as products
  join lateral (
    select bids.bidder_id, bids.amount
    from public.auction_bids as bids
    where bids.product_id = products.id
    order by bids.amount desc, bids.created_at desc, bids.id desc
    limit 1
  ) as winner on true
  left join public.shipping_request_items as items
    on items.product_id = products.id
  left join public.shipping_requests as requests
    on requests.id = items.request_id
  left join public.payment_orders as orders
    on orders.product_id = products.id
   and orders.buyer_id = v_test_user
  where winner.bidder_id = v_test_user
    and products.status = 'closed'
  order by products.closes_at desc, products.id;
end;
$$;

revoke all on function public.get_owner_hidden_test_won_products()
from public, anon;
grant execute on function public.get_owner_hidden_test_won_products()
to authenticated;

create or replace function public.owner_request_hidden_test_shipping(
  p_product_ids uuid[],
  p_address_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
  v_credit_count integer;
  v_address public.shipping_addresses%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_valid_count integer;
  v_distinct_count integer;
begin
  if v_owner is null or public.access_role_for_user(v_owner) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_product_ids is null
    or cardinality(p_product_ids) < 1
    or cardinality(p_product_ids) > 100
  then
    raise exception using errcode = '22023', message = '택배 접수할 상품을 선택해 주세요.';
  end if;
  select count(distinct product_id) into v_distinct_count
  from unnest(p_product_ids) as selected(product_id);
  if v_distinct_count <> cardinality(p_product_ids) then
    raise exception using errcode = '22023', message = '중복된 상품 선택이 있습니다.';
  end if;

  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null
  for update;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;
  perform set_config('app.owner_hidden_test_actor', v_owner::text, true);

  select accounts.shipping_credit_count into v_credit_count
  from public.member_accounts as accounts
  where accounts.member_id = v_test_user
    and accounts.account_status = 'active'
  for update;
  if v_credit_count is null or v_credit_count < 1 then
    raise exception using errcode = 'P0001', message = '택배 가능 횟수가 부족합니다.';
  end if;

  select addresses.* into v_address
  from public.shipping_addresses as addresses
  where addresses.id = p_address_id and addresses.member_id = v_test_user;
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 배송지를 찾을 수 없습니다.';
  end if;

  perform orders.id
  from public.payment_orders as orders
  where orders.product_id = any(p_product_ids)
    and orders.buyer_id = v_test_user
  order by orders.product_id
  for update;

  select count(*) into v_valid_count
  from public.products as products
  join lateral (
    select bids.bidder_id
    from public.auction_bids as bids
    where bids.product_id = products.id
    order by bids.amount desc, bids.created_at desc, bids.id desc
    limit 1
  ) as winner on true
  join public.payment_orders as orders
    on orders.product_id = products.id
   and orders.buyer_id = v_test_user
   and orders.payment_status = '결제완료'
   and orders.portone_status = 'PAID'
  where products.id = any(p_product_ids)
    and products.status = 'closed'
    and winner.bidder_id = v_test_user
    and not exists (
      select 1 from public.shipping_request_items as items
      where items.product_id = products.id
    );
  if v_valid_count <> cardinality(p_product_ids) then
    raise exception using errcode = '42501', message = '결제가 완료되지 않았거나 접수할 수 없는 상품이 포함되었습니다.';
  end if;

  insert into public.shipping_requests (
    id, member_id, address_id, address_snapshot
  ) values (
    v_request_id,
    v_test_user,
    v_address.id,
    jsonb_build_object(
      'label', v_address.label,
      'recipientName', v_address.recipient_name,
      'phone', v_address.phone,
      'address', v_address.address
    )
  );
  insert into public.shipping_request_items (request_id, product_id)
  select v_request_id, selected.product_id
  from unnest(p_product_ids) as selected(product_id);
  update public.member_accounts
  set shipping_credit_count = shipping_credit_count - 1
  where member_id = v_test_user;

  perform public.insert_owner_hidden_test_member_audit(
    v_owner,
    v_test_user,
    'test_member.shipping_requested',
    jsonb_build_object(
      'shipping_request_id', v_request_id,
      'address_id', p_address_id,
      'product_ids', to_jsonb(p_product_ids)
    )
  );
  return v_request_id;
end;
$$;

revoke all on function public.owner_request_hidden_test_shipping(uuid[], uuid)
from public, anon;
grant execute on function public.owner_request_hidden_test_shipping(uuid[], uuid)
to authenticated;

create or replace function public.get_owner_hidden_test_shipping_requests()
returns table (
  request_id uuid,
  status text,
  courier text,
  tracking_number text,
  requested_at timestamptz,
  shipped_at timestamptz,
  address_snapshot jsonb,
  product_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
begin
  if v_owner is null or public.access_role_for_user(v_owner) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;

  return query
  select
    requests.id,
    requests.status,
    requests.courier,
    requests.tracking_number,
    requests.requested_at,
    requests.shipped_at,
    requests.address_snapshot,
    coalesce(
      array_agg(items.product_id order by items.product_id)
        filter (where items.product_id is not null),
      '{}'::uuid[]
    )
  from public.shipping_requests as requests
  left join public.shipping_request_items as items
    on items.request_id = requests.id
  where requests.member_id = v_test_user
  group by requests.id
  order by requests.requested_at desc, requests.id;
end;
$$;

revoke all on function public.get_owner_hidden_test_shipping_requests()
from public, anon;
grant execute on function public.get_owner_hidden_test_shipping_requests()
to authenticated;

create or replace function public.owner_mark_hidden_test_shipping_shipped(
  p_request_id uuid,
  p_courier text,
  p_tracking_number text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
begin
  if v_owner is null or public.access_role_for_user(v_owner) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if char_length(btrim(coalesce(p_courier, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_tracking_number, ''))) not between 1 and 120
  then
    raise exception using errcode = '22023', message = '택배사와 송장번호를 확인해 주세요.';
  end if;
  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;
  perform set_config('app.owner_hidden_test_actor', v_owner::text, true);

  update public.shipping_requests
  set
    status = 'shipped',
    courier = btrim(p_courier),
    tracking_number = btrim(p_tracking_number),
    shipped_at = clock_timestamp()
  where id = p_request_id
    and member_id = v_test_user
    and status = 'requested';
  if not found then
    raise exception using errcode = 'P0002', message = '처리할 테스트 배송 요청을 찾지 못했습니다.';
  end if;

  perform public.insert_owner_hidden_test_member_audit(
    v_owner,
    v_test_user,
    'test_member.shipping_marked_shipped',
    jsonb_build_object(
      'shipping_request_id', p_request_id,
      'courier', btrim(p_courier),
      'tracking_number', btrim(p_tracking_number)
    )
  );
  return 'shipped';
end;
$$;

revoke all on function public.owner_mark_hidden_test_shipping_shipped(uuid, text, text)
from public, anon;
grant execute on function public.owner_mark_hidden_test_shipping_shipped(uuid, text, text)
to authenticated;

create or replace function public.get_owner_hidden_test_member_audit(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  audit_id bigint,
  actor_owner_id uuid,
  target_test_user_id uuid,
  action text,
  payload jsonb,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.access_role_for_user(auth.uid()) <> 'owner' then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 500
    or p_offset is null or p_offset < 0
  then
    raise exception using errcode = '22023', message = '감사 로그 페이지 범위를 확인해 주세요.';
  end if;
  return query
  select audit.id, audit.actor_owner_id, audit.target_test_user_id,
    audit.action, audit.payload, audit.occurred_at
  from public.owner_hidden_test_member_audit as audit
  where audit.actor_owner_id = auth.uid()
  order by audit.occurred_at desc, audit.id desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_owner_hidden_test_member_audit(integer, integer)
from public, anon;
grant execute on function public.get_owner_hidden_test_member_audit(integer, integer)
to authenticated;

-- Operators must not discover the synthetic test profile even if they guess
-- its UUID. The owner can still read it through the existing owner policy and
-- the dedicated owner-only RPCs above.
drop policy if exists "Operators read non-owner profiles" on public.profiles;
create policy "Operators read non-owner profiles"
on public.profiles
for select
to authenticated
using (
  (select public.is_operator())
  and public.access_role_for_user(id) is not null
  and public.access_role_for_user(id) <> 'owner'
  and not public.is_owner_hidden_test_member(id)
);

-- The online directory is an explicit defense in depth. Synthetic test users
-- have no Kakao identity and can never be listed, even if a future server test
-- writes a heartbeat for them.
drop function if exists public.get_online_member_directory(integer);
create function public.get_online_member_directory(
  p_limit integer default 50
)
returns table (
  id uuid,
  display_name text,
  is_operator boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.auth_user_has_kakao_identity(auth.uid()) then
    raise exception using errcode = '42501', message = '카카오 로그인이 필요합니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = '22023', message = '온라인 회원 조회 범위를 확인해 주세요.';
  end if;

  return query
  with online as (
    select
      profiles.id,
      profiles.display_name,
      roles.role_code = 'operator' as is_operator
    from public.account_last_seen as last_seen
    join public.account_access_roles as roles on roles.user_id = last_seen.user_id
    join public.profiles as profiles on profiles.id = last_seen.user_id
    where last_seen.last_seen_at >= statement_timestamp() - interval '75 seconds'
      and roles.role_code in ('operator', 'band_member', 'member')
      and profiles.nickname_initialized_at is not null
      and public.auth_user_has_kakao_identity(last_seen.user_id)
      and not public.is_owner_hidden_test_member(last_seen.user_id)
  )
  select online.id, online.display_name, online.is_operator,
    count(*) over () as total_count
  from online
  order by online.is_operator desc, online.display_name, online.id
  limit p_limit;
end;
$$;

revoke all on function public.get_online_member_directory(integer) from public;
grant execute on function public.get_online_member_directory(integer)
to authenticated;

-- Re-declare the staff directory with an explicit synthetic-account filter.
-- The missing Kakao identity already excludes it, but the registry predicate
-- keeps this invariant intact if authentication metadata changes later.
drop function if exists public.get_staff_member_directory(integer, integer);
create function public.get_staff_member_directory(
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id uuid,
  display_name text,
  legal_name text,
  email text,
  phone text,
  gender text,
  birth_year smallint,
  kakao_profile_complete boolean,
  kakao_synced_at timestamptz,
  account_status text,
  shipping_credit_count integer,
  address_count bigint,
  bid_count bigint,
  support_status text,
  created_at timestamptz,
  last_seen_at timestamptz,
  access_role text,
  warning_count integer,
  sanction_count integer,
  bid_blocked_until timestamptz,
  payment_deadline_exempt boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '회원 조회 권한이 필요합니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 500
    or p_offset is null or p_offset < 0
  then
    raise exception using errcode = '22023', message = '회원 목록 페이지 범위를 확인해 주세요.';
  end if;

  return query
  select
    profiles.id,
    profiles.display_name,
    kakao_profiles.full_name,
    users.email::text,
    accounts.phone,
    kakao_profiles.gender,
    kakao_profiles.birth_year,
    coalesce(kakao_profiles.profile_complete, false),
    kakao_profiles.last_synced_at,
    accounts.account_status,
    accounts.shipping_credit_count,
    (select count(*) from public.shipping_addresses as addresses
      where addresses.member_id = profiles.id),
    (select count(*) from public.auction_bids as bids
      where bids.bidder_id = profiles.id),
    (
      select conversations.status
      from public.support_conversations as conversations
      where conversations.member_id = profiles.id
      order by
        (conversations.status = 'open') desc,
        conversations.last_message_at desc nulls last,
        conversations.created_at desc
      limit 1
    ),
    profiles.created_at,
    coalesce(last_seen.last_seen_at, users.last_sign_in_at),
    roles.role_code,
    (select count(*)::integer from public.member_warnings as warnings
      where warnings.member_id = profiles.id),
    (select count(*)::integer from public.member_bid_sanctions as sanctions
      where sanctions.member_id = profiles.id),
    (
      select max(sanctions.ends_at)
      from public.member_bid_sanctions as sanctions
      where sanctions.member_id = profiles.id
        and sanctions.ends_at > clock_timestamp()
    ),
    roles.role_code = 'band_member'
  from public.profiles as profiles
  join auth.users as users on users.id = profiles.id
  join public.member_accounts as accounts on accounts.member_id = profiles.id
  join public.account_access_roles as roles on roles.user_id = profiles.id
  left join public.kakao_member_profiles as kakao_profiles
    on kakao_profiles.member_id = profiles.id
  left join public.account_last_seen as last_seen
    on last_seen.user_id = profiles.id
  where (
      roles.role_code in ('employee', 'band_member', 'member')
      or (public.is_owner() and roles.role_code = 'operator')
    )
    and public.auth_user_has_kakao_identity(profiles.id)
    and not public.is_owner_hidden_test_member(profiles.id)
  order by profiles.created_at desc, profiles.id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_staff_member_directory(integer, integer)
from public;
grant execute on function public.get_staff_member_directory(integer, integer)
to authenticated;

create or replace function public.get_pending_nickname_change_requests()
returns table (
  request_id uuid,
  member_id uuid,
  current_nickname text,
  requested_nickname text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '닉네임 요청 조회 권한이 없습니다.';
  end if;
  return query
  select
    requests.id,
    requests.member_id,
    profiles.display_name,
    requests.requested_nickname,
    requests.created_at
  from public.nickname_change_requests as requests
  join public.profiles as profiles on profiles.id = requests.member_id
  where requests.status = 'pending'
    and public.access_role_for_user(requests.member_id)
      in ('employee', 'band_member', 'member')
    and not public.is_owner_hidden_test_member(requests.member_id)
  order by requests.created_at, requests.id;
end;
$$;

revoke all on function public.get_pending_nickname_change_requests()
from public;
grant execute on function public.get_pending_nickname_change_requests()
to authenticated;

drop policy if exists "Members read their shipping requests and staff read all"
on public.shipping_requests;
create policy "Members read their shipping requests and staff read all"
on public.shipping_requests
for select
to authenticated
using (
  (member_id = (select auth.uid()) and (select public.is_member()))
  or (
    (select public.is_staff())
    and ((select public.is_owner()) or not public.is_owner_hidden_test_member(member_id))
  )
);

drop policy if exists "Members read their shipping items and staff read all"
on public.shipping_request_items;
create policy "Members read their shipping items and staff read all"
on public.shipping_request_items
for select
to authenticated
using (
  exists (
    select 1
    from public.shipping_requests as requests
    where requests.id = request_id
      and (
        (requests.member_id = (select auth.uid()) and (select public.is_member()))
        or (
          (select public.is_staff())
          and (
            (select public.is_owner())
            or not public.is_owner_hidden_test_member(requests.member_id)
          )
        )
      )
  )
);

drop policy if exists "Employees read pending shipping requests"
on public.shipping_requests;
create policy "Employees read pending shipping requests"
on public.shipping_requests
for select
to authenticated
using (
  (select public.is_employee())
  and status = 'requested'
  and not public.is_owner_hidden_test_member(member_id)
);

drop policy if exists "Employees read pending shipping items"
on public.shipping_request_items;
create policy "Employees read pending shipping items"
on public.shipping_request_items
for select
to authenticated
using (
  (select public.is_employee())
  and exists (
    select 1
    from public.shipping_requests as requests
    where requests.id = request_id
      and requests.status = 'requested'
      and not public.is_owner_hidden_test_member(requests.member_id)
  )
);

drop policy if exists "Members read their payment orders and operators read all"
on public.payment_orders;
create policy "Members read their payment orders and operators read all"
on public.payment_orders
for select
to authenticated
using (
  (buyer_id = (select auth.uid()) and (select public.is_member()))
  or (
    (select public.can_manage_members())
    and ((select public.is_owner()) or not public.is_owner_hidden_test_member(buyer_id))
  )
);

drop policy if exists "Members read their payment attempts and operators read all"
on public.payment_attempts;
create policy "Members read their payment attempts and operators read all"
on public.payment_attempts
for select
to authenticated
using (
  exists (
    select 1
    from public.payment_orders as orders
    where orders.id = order_id
      and (
        (orders.buyer_id = (select auth.uid()) and (select public.is_member()))
        or (
          (select public.can_manage_members())
          and (
            (select public.is_owner())
            or not public.is_owner_hidden_test_member(orders.buyer_id)
          )
        )
    )
  )
);

-- Hidden test-member activity is visible only to the owner. The earlier staff
-- policy exposed raw bidder_id/display_name columns through direct reads.
drop policy if exists "Staff read every bid" on public.auction_bids;
create policy "Staff read every bid"
on public.auction_bids
for select
to authenticated
using (
  (select public.is_staff())
  and (
    (select public.is_owner())
    or not public.is_owner_hidden_test_member(bidder_id)
  )
);

-- Support row policies delegate authorization to these helpers. Applying the
-- hidden-member boundary here also protects messages and read receipts.
create or replace function public.can_access_support_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and (
        public.is_owner()
        or not public.is_owner_hidden_test_member(conversations.member_id)
      )
      and (
        public.is_owner()
        or (
          public.support_access_role(auth.uid()) = 'operator'
          and public.is_support_operator(auth.uid())
          and conversations.assigned_staff_id = auth.uid()
        )
        or (
          public.support_access_role(auth.uid()) in ('member', 'band_member')
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
          and case
            when conversations.conversation_type = 'product'
              then public.is_product_support_assignee(conversations.assigned_staff_id)
            else public.is_support_operator(conversations.assigned_staff_id)
          end
        )
        or (
          public.support_access_role(auth.uid()) = 'employee'
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type = 'internal'
          and conversations.assigned_staff_id = public.support_employee_operator(auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_access_support_conversation(uuid) from public;
grant execute on function public.can_access_support_conversation(uuid)
  to authenticated;

create or replace function public.can_send_support_message(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and conversations.status = 'open'
      and (
        public.is_owner()
        or not public.is_owner_hidden_test_member(conversations.member_id)
      )
      and (
        (
          public.support_access_role(auth.uid()) = 'operator'
          and public.is_support_operator(auth.uid())
          and conversations.assigned_staff_id = auth.uid()
        )
        or (
          auth.uid() = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
          and public.is_owner()
          and conversations.conversation_type = 'product'
          and conversations.assigned_staff_id = auth.uid()
          and public.is_product_support_assignee(auth.uid())
        )
        or (
          public.support_access_role(auth.uid()) in ('member', 'band_member')
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type in ('general', 'product')
          and case
            when conversations.conversation_type = 'product'
              then public.is_product_support_assignee(conversations.assigned_staff_id)
            else public.is_support_operator(conversations.assigned_staff_id)
          end
        )
        or (
          public.support_access_role(auth.uid()) = 'employee'
          and public.has_kakao_identity(auth.uid())
          and conversations.member_id = auth.uid()
          and conversations.conversation_type = 'internal'
          and conversations.assigned_staff_id = public.support_employee_operator(auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_send_support_message(uuid) from public;
grant execute on function public.can_send_support_message(uuid)
  to authenticated;

create or replace function public.can_manage_support_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_conversations as conversations
    where conversations.id = p_conversation_id
      and (
        public.is_owner()
        or not public.is_owner_hidden_test_member(conversations.member_id)
      )
      and conversations.assigned_staff_id = auth.uid()
      and (
        public.is_support_operator(auth.uid())
        or (
          conversations.conversation_type = 'product'
          and auth.uid() = '30be08c2-6259-42c6-af26-4ded6362de12'::uuid
          and public.is_owner()
          and public.is_product_support_assignee(auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_manage_support_conversation(uuid) from public;
grant execute on function public.can_manage_support_conversation(uuid)
  to authenticated;
