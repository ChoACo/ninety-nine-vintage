begin;

-- Long-lived commerce, fulfillment, refund and audit rows must not retain a
-- foreign key to the member profile. The UUID is deliberately preserved as a
-- non-PII ledger principal after Auth and profile deletion.
create table app_private.ledger_principals (
  id uuid primary key,
  principal_kind text not null default 'account'
    check (principal_kind in ('account', 'anonymous_ledger')),
  created_at timestamptz not null default clock_timestamp(),
  anonymized_at timestamptz,
  check (
    (principal_kind = 'account' and anonymized_at is null)
    or (principal_kind = 'anonymous_ledger' and anonymized_at is not null)
  )
);

revoke all on table app_private.ledger_principals
from public, anon, authenticated, service_role;

insert into app_private.ledger_principals (
  id,
  principal_kind,
  created_at,
  anonymized_at
)
select
  profiles.id,
  case when profiles.deleted_at is null then 'account' else 'anonymous_ledger' end,
  profiles.created_at,
  profiles.deleted_at
from public.profiles as profiles
on conflict (id) do nothing;

create or replace function app_private.ensure_profile_ledger_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.ledger_principals (id, principal_kind, created_at)
  values (new.id, 'account', coalesce(new.created_at, clock_timestamp()))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.ensure_profile_ledger_principal()
from public, anon, authenticated, service_role;

drop trigger if exists profiles_ensure_ledger_principal on public.profiles;
create trigger profiles_ensure_ledger_principal
before insert on public.profiles
for each row execute function app_private.ensure_profile_ledger_principal();

-- Auth is deleted immediately after withdrawal, while the already anonymized
-- profile remains for the seven-day retention window. The profile therefore
-- belongs to the ledger principal instead of cascading with auth.users.
do $$
declare
  profile_auth_key record;
begin
  for profile_auth_key in
    select
      constraints.conname as constraint_name,
      constraints.condeferrable,
      constraints.condeferred
    from pg_catalog.pg_constraint as constraints
    where constraints.contype = 'f'
      and constraints.conrelid = 'public.profiles'::regclass
      and constraints.confrelid = 'auth.users'::regclass
      and cardinality(constraints.conkey) = 1
      and cardinality(constraints.confkey) = 1
  loop
    execute format(
      'alter table public.profiles drop constraint %I',
      profile_auth_key.constraint_name
    );
    execute format(
      'alter table public.profiles add constraint %I foreign key (id) references app_private.ledger_principals(id) on update no action on delete restrict %s not valid',
      profile_auth_key.constraint_name,
      case
        when profile_auth_key.condeferrable and profile_auth_key.condeferred
          then 'deferrable initially deferred'
        when profile_auth_key.condeferrable
          then 'deferrable initially immediate'
        else 'not deferrable'
      end
    );
    execute format(
      'alter table public.profiles validate constraint %I',
      profile_auth_key.constraint_name
    );
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraints
    where constraints.contype = 'f'
      and constraints.conrelid = 'public.profiles'::regclass
      and constraints.confrelid = 'auth.users'::regclass
  ) then
    raise exception using
      errcode = '55000',
      message = '프로필과 인증 계정의 연쇄 삭제 연결이 남아 있습니다.';
  end if;
end;
$$;

-- Re-parent only NO ACTION/RESTRICT profile references. CASCADE and SET NULL
-- relationships are personal or operational data and intentionally retain
-- their existing profile-deletion behavior.
do $$
declare
  foreign_key record;
begin
  for foreign_key in
    select
      source_namespace.nspname as schema_name,
      source_table.relname as table_name,
      constraints.conname as constraint_name,
      source_column.attname as column_name,
      constraints.condeferrable,
      constraints.condeferred
    from pg_catalog.pg_constraint as constraints
    join pg_catalog.pg_class as source_table
      on source_table.oid = constraints.conrelid
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_table.relnamespace
    join pg_catalog.pg_attribute as source_column
      on source_column.attrelid = constraints.conrelid
      and source_column.attnum = constraints.conkey[1]
    where constraints.contype = 'f'
      and constraints.confrelid = 'public.profiles'::regclass
      and constraints.confdeltype in ('a', 'r')
      and cardinality(constraints.conkey) = 1
      and cardinality(constraints.confkey) = 1
  loop
    execute format(
      'alter table %I.%I drop constraint %I',
      foreign_key.schema_name,
      foreign_key.table_name,
      foreign_key.constraint_name
    );
    execute format(
      'alter table %I.%I add constraint %I foreign key (%I) references app_private.ledger_principals(id) on update no action on delete restrict %s not valid',
      foreign_key.schema_name,
      foreign_key.table_name,
      foreign_key.constraint_name,
      foreign_key.column_name,
      case
        when foreign_key.condeferrable and foreign_key.condeferred
          then 'deferrable initially deferred'
        when foreign_key.condeferrable
          then 'deferrable initially immediate'
        else 'not deferrable'
      end
    );
    execute format(
      'alter table %I.%I validate constraint %I',
      foreign_key.schema_name,
      foreign_key.table_name,
      foreign_key.constraint_name
    );
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraints
    where constraints.contype = 'f'
      and constraints.confrelid = 'public.profiles'::regclass
      and constraints.confdeltype in ('a', 'r')
  ) then
    raise exception using
      errcode = '55000',
      message = '삭제 가능한 프로필을 직접 제한하는 외래키가 남아 있습니다.';
  end if;
end;
$$;

create table app_private.withdrawn_member_retention (
  member_id uuid primary key
    references app_private.ledger_principals(id) on delete restrict,
  anonymized_reference text not null unique
    check (anonymized_reference ~ '^deleted-[a-f0-9]{32}$'),
  deletion_reason text not null
    check (char_length(btrim(deletion_reason)) between 1 and 500),
  deleted_at timestamptz not null,
  purge_due_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  check (purge_due_at = deleted_at + interval '7 days'),
  check (
    (last_attempt_at is null and last_error_code is null and attempt_count = 0)
    or (last_attempt_at is not null and attempt_count > 0)
  )
);

create index withdrawn_member_retention_due_idx
on app_private.withdrawn_member_retention (purge_due_at, member_id);

revoke all on table app_private.withdrawn_member_retention
from public, anon, authenticated, service_role;

create table app_private.member_management_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null
    references app_private.ledger_principals(id) on delete restrict,
  member_id uuid not null
    references app_private.ledger_principals(id) on delete restrict,
  action text not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  before_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(after_state) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);

create index member_management_events_member_idx
on app_private.member_management_events (member_id, occurred_at desc);

revoke all on table app_private.member_management_events
from public, anon, authenticated, service_role;

-- Deleted profiles from the previous implementation enter the same seven-day
-- retention window. Overdue rows are handled by the first scheduled cleanup.
insert into app_private.withdrawn_member_retention (
  member_id,
  anonymized_reference,
  deletion_reason,
  deleted_at,
  purge_due_at
)
select
  profiles.id,
  profiles.anonymized_reference,
  left(
    coalesce(
      nullif(btrim(accounts.suspension_reason), ''),
      '기존 탈퇴 회원 이관'
    ),
    500
  ),
  profiles.deleted_at,
  profiles.deleted_at + interval '7 days'
from public.profiles as profiles
join public.member_accounts as accounts on accounts.member_id = profiles.id
where profiles.deleted_at is not null
  and accounts.account_status = 'deleted'
  and profiles.anonymized_reference ~ '^deleted-[a-f0-9]{32}$'
on conflict (member_id) do nothing;

create or replace function public.get_manager_member_directory(
  p_limit integer default 200,
  p_offset integer default 0
)
returns table(
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
  suspended_until timestamptz,
  suspension_reason text,
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
  payment_deadline_exempt boolean,
  active_sanctions jsonb,
  is_deleted boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 500
    or p_offset is null or p_offset < 0
  then
    raise exception using errcode = '22023', message = '페이지 범위를 확인해 주세요.';
  end if;

  return query
  select
    profiles.id,
    profiles.display_name,
    kakao.full_name,
    users.email::text,
    accounts.phone,
    kakao.gender,
    kakao.birth_year,
    coalesce(kakao.profile_complete, false),
    kakao.last_synced_at,
    public.effective_member_account_status(profiles.id),
    accounts.suspended_until,
    accounts.suspension_reason,
    accounts.shipping_credit_count,
    (select count(*) from public.shipping_addresses where member_id = profiles.id),
    (select count(*) from public.auction_bids where bidder_id = profiles.id),
    (
      select conversations.status
      from public.support_conversations as conversations
      where conversations.member_id = profiles.id
      order by
        (conversations.status = 'open') desc,
        conversations.last_message_at desc nulls last
      limit 1
    ),
    profiles.created_at,
    coalesce(last_seen.last_seen_at, users.last_sign_in_at),
    roles.role_code,
    (
      select count(*)::integer
      from public.member_warnings where member_id = profiles.id
    ),
    (
      select count(*)::integer
      from public.member_bid_sanctions where member_id = profiles.id
    ),
    (
      select max(sanctions.ends_at)
      from public.member_bid_sanctions as sanctions
      where sanctions.member_id = profiles.id
        and sanctions.status = 'active'
        and sanctions.ends_at > clock_timestamp()
    ),
    roles.role_code = 'band_member',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', sanctions.id,
          'startsAt', sanctions.starts_at,
          'endsAt', sanctions.ends_at,
          'reason', sanctions.reason,
          'source', sanctions.source
        )
        order by sanctions.ends_at desc, sanctions.id
      )
      from public.member_bid_sanctions as sanctions
      where sanctions.member_id = profiles.id
        and sanctions.status = 'active'
        and sanctions.ends_at > clock_timestamp()
    ), '[]'::jsonb),
    false
  from public.profiles as profiles
  join public.member_accounts as accounts on accounts.member_id = profiles.id
  left join auth.users as users on users.id = profiles.id
  left join public.account_access_roles as roles on roles.user_id = profiles.id
  left join public.kakao_member_profiles as kakao on kakao.member_id = profiles.id
  left join public.account_last_seen as last_seen on last_seen.user_id = profiles.id
  where profiles.deleted_at is null
    and accounts.account_status <> 'deleted'
  order by (roles.role_code = 'owner') desc, profiles.created_at desc, profiles.id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_manager_member_directory(integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_manager_member_directory(integer, integer)
to authenticated;

create or replace function public.get_owner_withdrawn_member_retention(
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  member_id uuid,
  anonymized_reference text,
  deletion_reason text,
  deleted_at timestamptz,
  purge_due_at timestamptz,
  attempt_count integer,
  last_attempt_at timestamptz,
  last_error_code text,
  retention_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_limit is null or p_limit not between 1 and 500
    or p_offset is null or p_offset < 0
  then
    raise exception using errcode = '22023', message = '페이지 범위를 확인해 주세요.';
  end if;
  return query
  select
    retention.member_id,
    retention.anonymized_reference,
    retention.deletion_reason,
    retention.deleted_at,
    retention.purge_due_at,
    retention.attempt_count,
    retention.last_attempt_at,
    retention.last_error_code,
    case
      when retention.last_error_code is not null then 'failed'
      when retention.purge_due_at <= clock_timestamp() then 'due'
      else 'retained'
    end
  from app_private.withdrawn_member_retention as retention
  order by retention.deleted_at desc, retention.member_id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_owner_withdrawn_member_retention(integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_owner_withdrawn_member_retention(integer, integer)
to authenticated;

create or replace function public.set_managed_member_status(
  p_member_id uuid,
  p_status text,
  p_suspended_until timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_status text := lower(btrim(coalesce(p_status, '')));
  normalized_reason text := btrim(coalesce(p_reason, ''));
  target_role text;
  previous_status text;
  previous_suspended_until timestamptz;
  previous_suspension_reason text;
  changed_count integer;
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if requested_status not in ('active', 'suspended', 'temporary_suspended') then
    raise exception using errcode = '22023', message = '계정 상태를 확인해 주세요.';
  end if;
  if char_length(normalized_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = '처리 사유를 입력해 주세요.';
  end if;
  if requested_status = 'temporary_suspended'
    and (
      p_suspended_until is null
      or p_suspended_until <= clock_timestamp()
    )
  then
    raise exception using errcode = '22023', message = '현재 이후의 정지 만료일을 입력해 주세요.';
  end if;

  select
    roles.role_code,
    accounts.account_status,
    accounts.suspended_until,
    accounts.suspension_reason
  into
    target_role,
    previous_status,
    previous_suspended_until,
    previous_suspension_reason
  from public.account_access_roles as roles
  join public.profiles as profiles
    on profiles.id = roles.user_id and profiles.deleted_at is null
  join public.member_accounts as accounts
    on accounts.member_id = profiles.id and accounts.account_status <> 'deleted'
  where roles.user_id = p_member_id
  for update of roles, profiles, accounts;

  if not found then
    raise exception using errcode = 'P0002', message = '관리할 활성 계정을 찾을 수 없습니다.';
  end if;
  if target_role = 'owner' then
    raise exception using errcode = '42501', message = '소유자 계정 상태는 변경할 수 없습니다.';
  end if;

  update public.member_accounts
  set
    account_status = requested_status,
    suspended_until = case
      when requested_status = 'temporary_suspended' then p_suspended_until
      else null
    end,
    suspension_reason = case
      when requested_status = 'active' then null
      else normalized_reason
    end,
    status_updated_by = auth.uid(),
    updated_at = clock_timestamp()
  where member_id = p_member_id;
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception using errcode = 'P0002', message = '계정 상태를 변경하지 못했습니다.';
  end if;

  insert into app_private.member_management_events (
    actor_id,
    member_id,
    action,
    reason,
    before_state,
    after_state
  ) values (
    auth.uid(),
    p_member_id,
    'status.' || requested_status,
    normalized_reason,
    jsonb_build_object(
      'status', previous_status,
      'suspendedUntil', previous_suspended_until,
      'reason', previous_suspension_reason
    ),
    jsonb_build_object(
      'status', requested_status,
      'suspendedUntil', case
        when requested_status = 'temporary_suspended' then p_suspended_until
        else null
      end
    )
  );

  return jsonb_build_object(
    'memberId', p_member_id,
    'status', requested_status,
    'suspendedUntil', case
      when requested_status = 'temporary_suspended' then p_suspended_until
      else null
    end
  );
end;
$$;

revoke all on function public.set_managed_member_status(
  uuid, text, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.set_managed_member_status(
  uuid, text, timestamptz, text
) to authenticated;

create or replace function public.create_member_24_hour_sanction(
  p_member_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  started_at timestamptz := clock_timestamp();
begin
  return public.manage_member_sanction(
    'create',
    p_member_id,
    null,
    started_at,
    started_at + interval '24 hours',
    p_reason
  );
end;
$$;

revoke all on function public.create_member_24_hour_sanction(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.create_member_24_hour_sanction(uuid, text)
to authenticated;

create or replace function public.prepare_managed_member_deletion(
  p_member_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
  normalized_reason text := btrim(coalesce(p_reason, ''));
  v_anonymized_reference text :=
    'deleted-' || replace(gen_random_uuid()::text, '-', '');
  v_deleted_at timestamptz := clock_timestamp();
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if char_length(normalized_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = '탈퇴 처리 사유를 입력해 주세요.';
  end if;

  select roles.role_code into target_role
  from public.account_access_roles as roles
  join public.profiles as profiles
    on profiles.id = roles.user_id and profiles.deleted_at is null
  where roles.user_id = p_member_id
  for update of roles, profiles;
  if not found then
    raise exception using errcode = 'P0002', message = '탈퇴 처리할 계정을 찾을 수 없습니다.';
  end if;
  if target_role = 'owner' then
    raise exception using errcode = '42501', message = '소유자 계정은 탈퇴 처리할 수 없습니다.';
  end if;

  update public.stores
  set operator_id = auth.uid(), updated_at = clock_timestamp()
  where operator_id = p_member_id;
  update public.support_conversations
  set assigned_staff_id = null
  where assigned_staff_id = p_member_id;
  delete from public.fulfillment_center_staff_assignments
  where user_id = p_member_id;
  delete from public.shipping_addresses where member_id = p_member_id;
  delete from public.kakao_member_profiles where member_id = p_member_id;

  update public.member_accounts
  set
    phone = null,
    account_status = 'deleted',
    suspended_until = null,
    suspension_reason = normalized_reason,
    status_updated_by = auth.uid(),
    updated_at = v_deleted_at
  where member_id = p_member_id;
  if not found then
    raise exception using errcode = 'P0002', message = '회원 계정 데이터를 찾을 수 없습니다.';
  end if;

  update public.profiles
  set
    display_name = '탈퇴 회원 ' || right(v_anonymized_reference, 8),
    avatar_url = null,
    deleted_at = v_deleted_at,
    anonymized_reference = v_anonymized_reference
  where id = p_member_id;

  insert into app_private.withdrawn_member_retention (
    member_id,
    anonymized_reference,
    deletion_reason,
    deleted_at,
    purge_due_at
  ) values (
    p_member_id,
    v_anonymized_reference,
    normalized_reason,
    v_deleted_at,
    v_deleted_at + interval '7 days'
  );

  insert into app_private.member_management_events (
    actor_id,
    member_id,
    action,
    reason,
    before_state,
    after_state
  ) values (
    auth.uid(),
    p_member_id,
    'member.withdrawn',
    normalized_reason,
    jsonb_build_object('role', target_role),
    jsonb_build_object(
      'anonymizedReference', v_anonymized_reference,
      'purgeDueAt', v_deleted_at + interval '7 days'
    )
  );

  delete from public.account_access_roles where user_id = p_member_id;

  return jsonb_build_object(
    'memberId', p_member_id,
    'anonymizedReference', v_anonymized_reference,
    'deletedAt', v_deleted_at,
    'purgeDueAt', v_deleted_at + interval '7 days',
    'prepared', true
  );
end;
$$;

revoke all on function public.prepare_managed_member_deletion(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.prepare_managed_member_deletion(uuid, text)
to authenticated;

create or replace function app_private.cleanup_withdrawn_member(
  p_member_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  retention app_private.withdrawn_member_retention%rowtype;
  profile_deleted boolean := false;
  principal_deleted boolean := false;
begin
  select * into retention
  from app_private.withdrawn_member_retention
  where member_id = p_member_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '탈퇴 보관 기록을 찾을 수 없습니다.';
  end if;
  if retention.purge_due_at > p_now then
    raise exception using errcode = '55000', message = '7일 보관 기간이 지나지 않았습니다.';
  end if;
  if exists (select 1 from auth.users where id = p_member_id) then
    raise exception using errcode = '55000', message = '인증 계정을 먼저 삭제해야 합니다.';
  end if;

  delete from public.profiles where id = p_member_id;
  profile_deleted := found;

  update app_private.ledger_principals
  set
    principal_kind = 'anonymous_ledger',
    anonymized_at = coalesce(anonymized_at, retention.deleted_at)
  where id = p_member_id;

  delete from app_private.withdrawn_member_retention
  where member_id = p_member_id;

  begin
    delete from app_private.ledger_principals where id = p_member_id;
    principal_deleted := found;
  exception
    when foreign_key_violation then
      principal_deleted := false;
  end;

  return jsonb_build_object(
    'memberId', p_member_id,
    'profileDeleted', profile_deleted,
    'ledgerPrincipalDeleted', principal_deleted,
    'purged', true
  );
end;
$$;

revoke all on function app_private.cleanup_withdrawn_member(uuid, timestamptz)
from public, anon, authenticated, service_role;

create or replace function app_private.run_withdrawn_member_retention_cleanup(
  p_now timestamptz default clock_timestamp(),
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_member record;
  processed_count integer := 0;
  failed_count integer := 0;
  error_code text;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = '정리 개수 범위를 확인해 주세요.';
  end if;

  for due_member in
    select retention.member_id
    from app_private.withdrawn_member_retention as retention
    where retention.purge_due_at <= p_now
    order by retention.purge_due_at, retention.member_id
    limit p_limit
    for update skip locked
  loop
    begin
      perform app_private.cleanup_withdrawn_member(due_member.member_id, p_now);
      processed_count := processed_count + 1;
    exception
      when others then
        get stacked diagnostics error_code = returned_sqlstate;
        update app_private.withdrawn_member_retention
        set
          attempt_count = attempt_count + 1,
          last_attempt_at = clock_timestamp(),
          last_error_code = error_code
        where member_id = due_member.member_id;
        failed_count := failed_count + 1;
    end;
  end loop;

  return jsonb_build_object(
    'processedCount', processed_count,
    'failedCount', failed_count,
    'ranAt', p_now
  );
end;
$$;

revoke all on function app_private.run_withdrawn_member_retention_cleanup(
  timestamptz, integer
) from public, anon, authenticated, service_role;

create or replace function public.retry_withdrawn_member_cleanup(
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  return app_private.cleanup_withdrawn_member(p_member_id, clock_timestamp());
end;
$$;

revoke all on function public.retry_withdrawn_member_cleanup(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.retry_withdrawn_member_cleanup(uuid)
to authenticated;

-- Compatibility for the previously deployed member-management Worker.
create or replace function public.purge_deleted_member_record(
  p_member_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = '정리 재시도 사유를 입력해 주세요.';
  end if;
  return app_private.cleanup_withdrawn_member(p_member_id, clock_timestamp());
end;
$$;

revoke all on function public.purge_deleted_member_record(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.purge_deleted_member_record(uuid, text)
to authenticated;

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'withdrawn-member-retention-cleanup'
  ) then
    perform cron.schedule(
      'withdrawn-member-retention-cleanup',
      '17 * * * *',
      $job$
        select app_private.run_withdrawn_member_retention_cleanup(
          clock_timestamp(),
          100
        );
      $job$
    );
  end if;
end;
$$;

commit;
