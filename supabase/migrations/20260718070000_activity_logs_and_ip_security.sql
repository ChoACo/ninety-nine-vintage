-- Privacy-aware activity disclosure and IP/session security controls.
--
-- Security principles:
--   * raw activity and IP data are never exposed through table grants;
--   * member disclosure is request based, time limited, and masked;
--   * cross-member disclosure needs both subject consent and owner approval;
--   * decisions and audit/history rows are append-only;
--   * the service role may only call narrow session/IP RPCs and cannot query
--     the underlying tables through PostgREST.

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
-- Existing RLS policies call app_private.is_owner_hidden_test_member_for_policy
-- as authenticated users. Keep schema lookup while every new private object
-- below retains explicit EXECUTE/SELECT revokes.
grant usage on schema app_private to authenticated;
revoke create on schema app_private from authenticated;

create or replace function app_private.reject_security_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = '보안 및 개인정보 감사 기록은 수정하거나 삭제할 수 없습니다.';
end;
$$;

revoke all on function app_private.reject_security_history_mutation()
from public, anon, authenticated, service_role;

create table public.security_activity_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  subject_user_id uuid,
  category text not null
    check (category ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  event_type text not null
    check (event_type ~ '^[a-z][a-z0-9_.:-]{2,95}$'),
  action text not null
    check (action ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  entity_type text
    check (entity_type is null or entity_type ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  entity_id text
    check (entity_id is null or char_length(entity_id) between 1 and 200),
  severity text not null default 'info'
    check (severity in ('info', 'notice', 'warning', 'critical')),
  ip_address inet,
  user_agent text
    check (user_agent is null or char_length(user_agent) <= 1024),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object')
    check (octet_length(metadata::text) <= 16384),
  occurred_at timestamptz not null default clock_timestamp()
);

create index security_activity_logs_actor_time_idx
on public.security_activity_logs (actor_user_id, occurred_at desc, id desc);
create index security_activity_logs_subject_time_idx
on public.security_activity_logs (subject_user_id, occurred_at desc, id desc);
create index security_activity_logs_category_time_idx
on public.security_activity_logs (category, occurred_at desc, id desc);

alter table public.security_activity_logs enable row level security;
alter table public.security_activity_logs force row level security;
revoke all on public.security_activity_logs
from public, anon, authenticated, service_role;

create trigger security_activity_logs_append_only
before update or delete or truncate on public.security_activity_logs
for each statement execute function app_private.reject_security_history_mutation();

create or replace function app_private.write_security_activity(
  p_actor_user_id uuid,
  p_subject_user_id uuid,
  p_category text,
  p_event_type text,
  p_action text,
  p_source text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_severity text default 'info',
  p_ip_address inet default null,
  p_user_agent text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default clock_timestamp()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.security_activity_logs (
    actor_user_id,
    subject_user_id,
    category,
    event_type,
    action,
    source,
    entity_type,
    entity_id,
    severity,
    ip_address,
    user_agent,
    metadata,
    occurred_at
  ) values (
    p_actor_user_id,
    p_subject_user_id,
    lower(btrim(p_category)),
    lower(btrim(p_event_type)),
    lower(btrim(p_action)),
    lower(btrim(p_source)),
    nullif(lower(btrim(p_entity_type)), ''),
    nullif(left(btrim(p_entity_id), 200), ''),
    lower(btrim(p_severity)),
    p_ip_address,
    nullif(left(btrim(p_user_agent), 1024), ''),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_occurred_at, clock_timestamp())
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app_private.write_security_activity(
  uuid, uuid, text, text, text, text, text, text, text, inet, text, jsonb,
  timestamptz
) from public, anon, authenticated, service_role;

-- An access request is immutable. Its current state is derived exclusively
-- from the append-only decision stream below.
create table public.security_log_access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null,
  subject_user_id uuid not null,
  requested_from timestamptz not null,
  requested_to timestamptz not null,
  reason text not null
    check (char_length(btrim(reason)) between 10 and 500),
  created_at timestamptz not null default clock_timestamp(),
  request_expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  check (requested_to >= requested_from),
  check (requested_to - requested_from <= interval '90 days'),
  check (request_expires_at > created_at)
);

create index security_log_access_requests_requester_idx
on public.security_log_access_requests (requester_user_id, created_at desc);
create index security_log_access_requests_subject_idx
on public.security_log_access_requests (subject_user_id, created_at desc);

alter table public.security_log_access_requests enable row level security;
alter table public.security_log_access_requests force row level security;
revoke all on public.security_log_access_requests
from public, anon, authenticated, service_role;

create trigger security_log_access_requests_append_only
before update or delete or truncate on public.security_log_access_requests
for each statement execute function app_private.reject_security_history_mutation();

create table public.security_log_access_decisions (
  id bigint generated always as identity primary key,
  request_id uuid not null
    references public.security_log_access_requests (id) on delete restrict,
  actor_user_id uuid not null,
  decision_type text not null
    check (decision_type in (
      'subject_approved', 'subject_denied',
      'owner_approved', 'owner_denied',
      'access_revoked', 'access_viewed'
    )),
  note text
    check (note is null or char_length(btrim(note)) between 2 and 500),
  access_expires_at timestamptz,
  decided_at timestamptz not null default clock_timestamp(),
  check (
    (decision_type = 'owner_approved' and access_expires_at is not null)
    or (decision_type <> 'owner_approved' and access_expires_at is null)
  )
);

create unique index security_log_access_subject_decision_once_idx
on public.security_log_access_decisions (request_id)
where decision_type in ('subject_approved', 'subject_denied');
create unique index security_log_access_owner_decision_once_idx
on public.security_log_access_decisions (request_id)
where decision_type in ('owner_approved', 'owner_denied');
create unique index security_log_access_revocation_once_idx
on public.security_log_access_decisions (request_id)
where decision_type = 'access_revoked';
create index security_log_access_decisions_request_time_idx
on public.security_log_access_decisions (request_id, decided_at, id);

alter table public.security_log_access_decisions enable row level security;
alter table public.security_log_access_decisions force row level security;
revoke all on public.security_log_access_decisions
from public, anon, authenticated, service_role;

create trigger security_log_access_decisions_append_only
before update or delete or truncate on public.security_log_access_decisions
for each statement execute function app_private.reject_security_history_mutation();

create table public.security_ip_block_rules (
  id uuid primary key default gen_random_uuid(),
  network cidr not null,
  label text
    check (label is null or char_length(btrim(label)) between 2 and 80),
  reason text not null
    check (char_length(btrim(reason)) between 10 and 500),
  enabled boolean not null default true,
  expires_at timestamptz,
  archived_at timestamptz,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at is null or expires_at > created_at),
  check (archived_at is null or not enabled)
);

create index security_ip_block_rules_lookup_idx
on public.security_ip_block_rules (enabled, expires_at, archived_at);
create unique index security_ip_block_rules_active_network_idx
on public.security_ip_block_rules (network)
where archived_at is null;

alter table public.security_ip_block_rules enable row level security;
alter table public.security_ip_block_rules force row level security;
revoke all on public.security_ip_block_rules
from public, anon, authenticated, service_role;

create table public.security_ip_block_rule_audit (
  id bigint generated always as identity primary key,
  rule_id uuid not null,
  actor_user_id uuid not null,
  action text not null
    check (action in ('created', 'updated', 'enabled', 'disabled', 'archived')),
  change_reason text not null
    check (char_length(btrim(change_reason)) between 10 and 500),
  before_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(before_state) = 'object')
    check (octet_length(before_state::text) <= 8192),
  after_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(after_state) = 'object')
    check (octet_length(after_state::text) <= 8192),
  occurred_at timestamptz not null default clock_timestamp()
);

create index security_ip_block_rule_audit_rule_time_idx
on public.security_ip_block_rule_audit (rule_id, occurred_at desc, id desc);

alter table public.security_ip_block_rule_audit enable row level security;
alter table public.security_ip_block_rule_audit force row level security;
revoke all on public.security_ip_block_rule_audit
from public, anon, authenticated, service_role;

create trigger security_ip_block_rule_audit_append_only
before update or delete or truncate on public.security_ip_block_rule_audit
for each statement execute function app_private.reject_security_history_mutation();

create table public.security_session_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  auth_session_id uuid,
  browser_tab_session_id uuid not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  latest_ip inet not null,
  latest_user_agent text
    check (latest_user_agent is null or char_length(latest_user_agent) <= 1024),
  last_event text not null
    check (last_event in ('session_started', 'session_resumed', 'heartbeat')),
  last_outcome text not null
    check (last_outcome in ('allowed', 'blocked')),
  matched_rule_id uuid references public.security_ip_block_rules (id) on delete restrict,
  unique (user_id, browser_tab_session_id),
  check (last_seen_at >= first_seen_at),
  check (
    (last_outcome = 'allowed' and matched_rule_id is null)
    or (last_outcome = 'blocked' and matched_rule_id is not null)
  )
);

create index security_session_records_user_time_idx
on public.security_session_records (user_id, last_seen_at desc, id);
create index security_session_records_ip_time_idx
on public.security_session_records (latest_ip, last_seen_at desc);

alter table public.security_session_records enable row level security;
alter table public.security_session_records force row level security;
revoke all on public.security_session_records
from public, anon, authenticated, service_role;

create table public.security_session_ip_history (
  id bigint generated always as identity primary key,
  session_record_id uuid not null
    references public.security_session_records (id) on delete restrict,
  user_id uuid not null,
  ip_address inet not null,
  user_agent text
    check (user_agent is null or char_length(user_agent) <= 1024),
  event_type text not null
    check (event_type in ('session_started', 'session_resumed', 'heartbeat')),
  outcome text not null
    check (outcome in ('allowed', 'blocked')),
  matched_rule_id uuid references public.security_ip_block_rules (id) on delete restrict,
  observed_at timestamptz not null default clock_timestamp(),
  check (
    (outcome = 'allowed' and matched_rule_id is null)
    or (outcome = 'blocked' and matched_rule_id is not null)
  )
);

create index security_session_ip_history_user_time_idx
on public.security_session_ip_history (user_id, observed_at desc, id desc);
create index security_session_ip_history_ip_time_idx
on public.security_session_ip_history (ip_address, observed_at desc, id desc);

alter table public.security_session_ip_history enable row level security;
alter table public.security_session_ip_history force row level security;
revoke all on public.security_session_ip_history
from public, anon, authenticated, service_role;

create trigger security_session_ip_history_append_only
before update or delete or truncate on public.security_session_ip_history
for each statement execute function app_private.reject_security_history_mutation();

-- Existing append-only owner audit sources remain authoritative. This private
-- normalized view avoids copying them while making one chronological feed.
create or replace view app_private.normalized_security_activity as
select
  'activity:' || logs.id::text as log_key,
  logs.actor_user_id,
  logs.subject_user_id,
  logs.category,
  logs.event_type,
  logs.action,
  logs.source,
  logs.entity_type,
  logs.entity_id,
  logs.severity,
  logs.ip_address,
  logs.user_agent,
  logs.metadata,
  logs.occurred_at
from public.security_activity_logs as logs
union all
select
  'delegation:' || audit.id::text,
  audit.actor_owner_id,
  audit.target_operator_id,
  'authorization',
  'owner.operator_delegation.' || audit.action,
  audit.action,
  'owner_operator_delegation_audit',
  'delegation_session',
  audit.session_id::text,
  'notice',
  null::inet,
  null::text,
  audit.payload,
  audit.occurred_at
from public.owner_operator_delegation_audit as audit
union all
select
  'owner-test:' || audit.id::text,
  audit.actor_owner_id,
  audit.target_test_user_id,
  'owner_test',
  'owner.hidden_test.' || audit.action,
  audit.action,
  'owner_hidden_test_member_audit',
  'hidden_test_member',
  audit.target_test_user_id::text,
  'notice',
  null::inet,
  null::text,
  audit.payload,
  audit.occurred_at
from public.owner_hidden_test_member_audit as audit
union all
select
  'owner-auction:' || audit.id::text,
  audit.actor_owner_id,
  audit.subject_member_id,
  'auction',
  'owner.auction.' || audit.action,
  audit.action,
  'owner_auction_action_audit',
  'product',
  audit.product_id::text,
  'notice',
  null::inet,
  null::text,
  jsonb_build_object(
    'reason', audit.reason,
    'before_state', audit.before_state,
    'after_state', audit.after_state,
    'payload', audit.payload
  ),
  audit.occurred_at
from public.owner_auction_action_audit as audit;

revoke all on app_private.normalized_security_activity
from public, anon, authenticated, service_role;

create or replace function app_private.mask_security_text(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := nullif(btrim(p_value), '');
  v_length integer;
begin
  if v_value is null then return null; end if;
  v_length := char_length(v_value);
  if v_length <= 2 then return repeat('*', v_length); end if;
  return left(v_value, 1) || repeat('*', least(v_length - 2, 8)) || right(v_value, 1);
end;
$$;

create or replace function app_private.mask_security_ip(p_ip inet)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_ip is null then return null; end if;
  if family(p_ip) = 4 then
    return regexp_replace(host(p_ip), '[0-9]+$', '***');
  end if;
  return set_masklen(p_ip, 48)::cidr::text || '…';
end;
$$;

revoke all on function app_private.mask_security_text(text),
  app_private.mask_security_ip(inet)
from public, anon, authenticated, service_role;

create or replace view app_private.security_log_request_states as
select
  requests.*,
  case
    when requests.requester_user_id = requests.subject_user_id then 'not_required'
    when subject_decision.decision_type = 'subject_approved' then 'approved'
    when subject_decision.decision_type = 'subject_denied' then 'denied'
    else null
  end as subject_decision,
  case
    when owner_decision.decision_type = 'owner_approved' then 'approved'
    when owner_decision.decision_type = 'owner_denied' then 'denied'
    else null
  end as owner_decision,
  owner_decision.access_expires_at,
  case
    when revocation.id is not null then 'revoked'
    when subject_decision.decision_type = 'subject_denied'
      or owner_decision.decision_type = 'owner_denied' then 'denied'
    when owner_decision.decision_type = 'owner_approved'
      and owner_decision.access_expires_at > clock_timestamp()
      and (
        requests.requester_user_id = requests.subject_user_id
        or subject_decision.decision_type = 'subject_approved'
      ) then 'approved'
    when owner_decision.decision_type = 'owner_approved'
      and owner_decision.access_expires_at <= clock_timestamp() then 'expired'
    when requests.request_expires_at <= clock_timestamp() then 'expired'
    when requests.requester_user_id <> requests.subject_user_id
      and subject_decision.id is null then 'awaiting_subject_consent'
    else 'awaiting_owner_approval'
  end as status
from public.security_log_access_requests as requests
left join public.security_log_access_decisions as subject_decision
  on subject_decision.request_id = requests.id
 and subject_decision.decision_type in ('subject_approved', 'subject_denied')
left join public.security_log_access_decisions as owner_decision
  on owner_decision.request_id = requests.id
 and owner_decision.decision_type in ('owner_approved', 'owner_denied')
left join public.security_log_access_decisions as revocation
  on revocation.request_id = requests.id
 and revocation.decision_type = 'access_revoked';

revoke all on app_private.security_log_request_states
from public, anon, authenticated, service_role;

create or replace function public.request_security_log_access(
  p_reason text,
  p_requested_from timestamptz,
  p_requested_to timestamptz,
  p_subject_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester uuid := auth.uid();
  v_subject uuid;
  v_requester_name text;
  v_subject_name text := nullif(public.normalize_member_nickname(p_subject_display_name), '');
  v_now timestamptz := clock_timestamp();
  v_request_id uuid;
  v_match_count integer;
begin
  if v_requester is null
    or not public.auth_user_has_kakao_identity(v_requester)
    or public.access_role_for_user(v_requester) = 'owner' then
    raise exception using errcode = '42501', message = '회원 로그 요청 권한이 없습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('security-log-request:' || v_requester::text, 0)
  );

  select profiles.display_name into v_requester_name
  from public.profiles as profiles
  where profiles.id = v_requester;

  if v_requester_name is null then
    raise exception using errcode = 'P0002', message = '회원 정보를 찾을 수 없습니다.';
  end if;

  if v_subject_name is null
    or lower(v_subject_name) = lower(public.normalize_member_nickname(v_requester_name)) then
    v_subject := v_requester;
  else
    select count(*), min(profiles.id::text)::uuid
    into v_match_count, v_subject
    from public.profiles as profiles
    join public.account_access_roles as roles on roles.user_id = profiles.id
    join public.member_accounts as accounts on accounts.member_id = profiles.id
    where lower(public.normalize_member_nickname(profiles.display_name)) = lower(v_subject_name)
      and roles.role_code in ('member', 'band_member')
      and accounts.account_status = 'active'
      and not exists (
        select 1 from public.owner_hidden_test_members as hidden_test
        where hidden_test.test_user_id = profiles.id
          and hidden_test.retired_at is null
      );

    if v_match_count <> 1 or v_subject is null then
      -- The same response for no match and duplicate match prevents nickname
      -- enumeration and accidental disclosure to the wrong subject.
      raise exception using errcode = 'P0002', message = '요청 대상을 정확히 확인할 수 없습니다.';
    end if;
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = '로그 요청 사유를 10자 이상 입력해 주세요.';
  end if;

  if (
    select count(*)
    from public.security_log_access_requests as recent
    where recent.requester_user_id = v_requester
      and recent.created_at > v_now - interval '24 hours'
  ) >= 5 then
    raise exception using errcode = '42900', message = '하루 로그 요청 횟수를 초과했습니다.';
  end if;
  if p_requested_from is null or p_requested_to is null
    or p_requested_from > v_now
    or least(p_requested_to, v_now) < p_requested_from
    or least(p_requested_to, v_now) - p_requested_from > interval '90 days' then
    raise exception using errcode = '22023', message = '로그 요청 기간이 올바르지 않습니다.';
  end if;

  if exists (
    select 1
    from app_private.security_log_request_states as state
    where state.requester_user_id = v_requester
      and state.subject_user_id = v_subject
      and state.status in (
        'awaiting_subject_consent', 'awaiting_owner_approval', 'approved'
      )
  ) then
    raise exception using errcode = '23505', message = '같은 대상에 대한 진행 중인 요청이 있습니다.';
  end if;

  insert into public.security_log_access_requests (
    requester_user_id,
    subject_user_id,
    requested_from,
    requested_to,
    reason,
    created_at,
    request_expires_at
  ) values (
    v_requester,
    v_subject,
    p_requested_from,
    least(p_requested_to, v_now),
    btrim(p_reason),
    v_now,
    v_now + interval '7 days'
  ) returning id into v_request_id;

  perform app_private.write_security_activity(
    v_requester,
    v_subject,
    'privacy',
    'privacy.log_access.requested',
    'requested',
    'security_log_access_requests',
    'log_access_request',
    v_request_id::text,
    'notice',
    null,
    null,
    jsonb_build_object('cross_user', v_requester <> v_subject),
    v_now
  );

  return v_request_id;
end;
$$;

revoke all on function public.request_security_log_access(
  text, timestamptz, timestamptz, text
) from public, anon, service_role;
grant execute on function public.request_security_log_access(
  text, timestamptz, timestamptz, text
) to authenticated;

create or replace function public.list_my_security_log_access_requests()
returns table (
  request_id uuid,
  requester_display_name text,
  subject_display_name text,
  is_requester boolean,
  is_subject boolean,
  requested_from timestamptz,
  requested_to timestamptz,
  reason text,
  created_at timestamptz,
  request_expires_at timestamptz,
  subject_decision text,
  owner_decision text,
  access_expires_at timestamptz,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.auth_user_has_kakao_identity(auth.uid()) then
    raise exception using errcode = '42501', message = '로그 요청 조회 권한이 없습니다.';
  end if;

  return query
  select
    state.id,
    coalesce(requester.display_name, '탈퇴회원'),
    coalesce(subject.display_name, '탈퇴회원'),
    state.requester_user_id = auth.uid(),
    state.subject_user_id = auth.uid(),
    state.requested_from,
    state.requested_to,
    state.reason,
    state.created_at,
    state.request_expires_at,
    state.subject_decision,
    state.owner_decision,
    state.access_expires_at,
    state.status
  from app_private.security_log_request_states as state
  left join public.profiles as requester on requester.id = state.requester_user_id
  left join public.profiles as subject on subject.id = state.subject_user_id
  where auth.uid() in (state.requester_user_id, state.subject_user_id)
  order by state.created_at desc, state.id desc;
end;
$$;

revoke all on function public.list_my_security_log_access_requests()
from public, anon, service_role;
grant execute on function public.list_my_security_log_access_requests()
to authenticated;

create or replace function public.respond_security_log_subject_consent(
  p_request_id uuid,
  p_approved boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.security_log_access_requests%rowtype;
  v_decision text;
begin
  if auth.uid() is null or not public.auth_user_has_kakao_identity(auth.uid()) then
    raise exception using errcode = '42501', message = '개인정보 동의 권한이 없습니다.';
  end if;
  if p_note is not null and char_length(btrim(p_note)) not between 2 and 500 then
    raise exception using errcode = '22023', message = '동의 의견이 올바르지 않습니다.';
  end if;

  select * into v_request
  from public.security_log_access_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '로그 요청을 찾을 수 없습니다.';
  end if;
  if v_request.requester_user_id = v_request.subject_user_id
    or v_request.subject_user_id <> auth.uid() then
    raise exception using errcode = '42501', message = '이 요청의 동의 대상이 아닙니다.';
  end if;
  if v_request.request_expires_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = '로그 요청이 만료되었습니다.';
  end if;
  if exists (
    select 1 from public.security_log_access_decisions
    where request_id = p_request_id
      and decision_type in ('subject_approved', 'subject_denied')
  ) then
    raise exception using errcode = '23505', message = '이미 동의 여부를 결정했습니다.';
  end if;

  v_decision := case when p_approved then 'subject_approved' else 'subject_denied' end;
  insert into public.security_log_access_decisions (
    request_id, actor_user_id, decision_type, note
  ) values (p_request_id, auth.uid(), v_decision, nullif(btrim(p_note), ''));

  perform app_private.write_security_activity(
    auth.uid(),
    v_request.requester_user_id,
    'privacy',
    'privacy.log_access.' || v_decision,
    v_decision,
    'security_log_access_decisions',
    'log_access_request',
    p_request_id::text,
    'notice',
    null,
    null,
    jsonb_build_object('outcome', case when p_approved then 'approved' else 'denied' end)
  );
end;
$$;

revoke all on function public.respond_security_log_subject_consent(uuid, boolean, text)
from public, anon, service_role;
grant execute on function public.respond_security_log_subject_consent(uuid, boolean, text)
to authenticated;

create or replace function public.get_approved_masked_security_logs(
  p_request_id uuid,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  log_key text,
  occurred_at timestamptz,
  category text,
  event_type text,
  action text,
  source text,
  actor_label text,
  subject_label text,
  entity_type text,
  entity_id_masked text,
  severity text,
  ip_address_masked text,
  user_agent_masked text,
  metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request app_private.security_log_request_states%rowtype;
  v_request_lock public.security_log_access_requests%rowtype;
begin
  if auth.uid() is null or not public.auth_user_has_kakao_identity(auth.uid()) then
    raise exception using errcode = '42501', message = '승인 로그 열람 권한이 없습니다.';
  end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 100000 then
    raise exception using errcode = '22023', message = '페이지 범위가 올바르지 않습니다.';
  end if;

  select * into v_request_lock
  from public.security_log_access_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = '승인된 임시 열람 권한이 없습니다.';
  end if;

  select * into v_request
  from app_private.security_log_request_states
  where id = p_request_id;

  if not found or v_request.requester_user_id <> auth.uid()
    or v_request.status <> 'approved'
    or v_request.access_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = '승인된 임시 열람 권한이 없습니다.';
  end if;

  insert into public.security_log_access_decisions (
    request_id, actor_user_id, decision_type, note
  ) values (p_request_id, auth.uid(), 'access_viewed', null);

  perform app_private.write_security_activity(
    auth.uid(),
    v_request.subject_user_id,
    'privacy',
    'privacy.log_access.viewed',
    'viewed',
    'security_log_access_decisions',
    'log_access_request',
    p_request_id::text,
    'notice',
    null,
    null,
    jsonb_build_object('reference', p_request_id::text)
  );

  return query
  select
    activity.log_key,
    activity.occurred_at,
    activity.category,
    activity.event_type,
    activity.action,
    activity.source,
    app_private.mask_security_text(actor.display_name),
    app_private.mask_security_text(subject.display_name),
    activity.entity_type,
    app_private.mask_security_text(activity.entity_id),
    activity.severity,
    app_private.mask_security_ip(activity.ip_address),
    case
      when activity.user_agent is null then null
      else '브라우저 정보 마스킹됨'
    end,
    -- The member UI does not currently render metadata. Return an empty object
    -- rather than transferring unused amounts, sanction details or identifiers.
    '{}'::jsonb
  from app_private.normalized_security_activity as activity
  left join public.profiles as actor on actor.id = activity.actor_user_id
  left join public.profiles as subject on subject.id = activity.subject_user_id
  where v_request.subject_user_id in (
      activity.actor_user_id,
      activity.subject_user_id
    )
    and activity.occurred_at >= v_request.requested_from
    -- request.created_at is a fixed snapshot boundary. Approval never exposes
    -- activity generated after the member submitted the request.
    and activity.occurred_at <= least(v_request.requested_to, v_request.created_at)
  order by activity.occurred_at desc, activity.log_key desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_approved_masked_security_logs(uuid, integer, integer)
from public, anon, service_role;
grant execute on function public.get_approved_masked_security_logs(uuid, integer, integer)
to authenticated;

create or replace function public.revoke_security_log_access(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request app_private.security_log_request_states%rowtype;
  v_request_lock public.security_log_access_requests%rowtype;
  v_actor uuid := auth.uid();
  v_is_owner boolean := coalesce(public.is_owner(), false);
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = '로그 열람 철회 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = '열람 중단 사유를 10자 이상 입력해 주세요.';
  end if;

  select * into v_request_lock
  from public.security_log_access_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '철회할 로그 요청을 찾을 수 없습니다.';
  end if;

  select * into v_request
  from app_private.security_log_request_states
  where id = p_request_id;

  if not found or v_request.status in ('denied', 'revoked', 'expired') then
    raise exception using errcode = 'P0002', message = '철회할 승인 요청을 찾을 수 없습니다.';
  end if;
  if v_is_owner then
    if v_request.owner_decision <> 'approved' then
      raise exception using errcode = '42501', message = '관리자는 승인된 열람만 중단할 수 있습니다.';
    end if;
  elsif not public.auth_user_has_kakao_identity(v_actor) then
    raise exception using errcode = '42501', message = '이 로그 열람을 철회할 권한이 없습니다.';
  elsif v_request.requester_user_id = v_request.subject_user_id then
    if v_request.requester_user_id <> v_actor then
      raise exception using errcode = '42501', message = '이 로그 요청을 철회할 권한이 없습니다.';
    end if;
  elsif v_request.subject_user_id <> v_actor
    or v_request.subject_decision <> 'approved' then
    raise exception using errcode = '42501', message = '정보 주체만 개인정보 동의를 철회할 수 있습니다.';
  end if;
  if exists (
    select 1 from public.security_log_access_decisions
    where request_id = p_request_id and decision_type = 'access_revoked'
  ) then
    raise exception using errcode = '23505', message = '이미 열람이 중단되었습니다.';
  end if;

  insert into public.security_log_access_decisions (
    request_id, actor_user_id, decision_type, note
  ) values (p_request_id, v_actor, 'access_revoked', btrim(p_reason));

  perform app_private.write_security_activity(
    v_actor,
    v_request.requester_user_id,
    'privacy',
    'privacy.log_access.revoked',
    'revoked',
    'security_log_access_decisions',
    'log_access_request',
    p_request_id::text,
    'warning',
    null,
    null,
    jsonb_build_object('outcome', 'revoked')
  );
end;
$$;

revoke all on function public.revoke_security_log_access(uuid, text)
from public, anon, service_role;
grant execute on function public.revoke_security_log_access(uuid, text)
to authenticated;

create or replace function public.owner_list_security_activity(
  p_reason text,
  p_user_id uuid default null,
  p_category text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  log_key text,
  actor_user_id uuid,
  actor_display_name text,
  subject_user_id uuid,
  subject_display_name text,
  category text,
  event_type text,
  action text,
  source text,
  entity_type text,
  entity_id text,
  severity text,
  ip_address text,
  user_agent text,
  metadata jsonb,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '원문 활동 로그 조회 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = '원문 로그 조회 사유를 10자 이상 입력해 주세요.';
  end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 100000 then
    raise exception using errcode = '22023', message = '페이지 범위가 올바르지 않습니다.';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception using errcode = '22023', message = '조회 기간이 올바르지 않습니다.';
  end if;

  return query
  select
    activity.log_key,
    activity.actor_user_id,
    actor.display_name,
    activity.subject_user_id,
    subject.display_name,
    activity.category,
    activity.event_type,
    activity.action,
    activity.source,
    activity.entity_type,
    activity.entity_id,
    activity.severity,
    host(activity.ip_address),
    activity.user_agent,
    activity.metadata,
    activity.occurred_at
  from app_private.normalized_security_activity as activity
  left join public.profiles as actor on actor.id = activity.actor_user_id
  left join public.profiles as subject on subject.id = activity.subject_user_id
  where (p_user_id is null or p_user_id in (
      activity.actor_user_id, activity.subject_user_id
    ))
    and (p_category is null or activity.category = lower(btrim(p_category)))
    and (p_from is null or activity.occurred_at >= p_from)
    and (p_to is null or activity.occurred_at <= p_to)
  order by activity.occurred_at desc, activity.log_key desc
  limit p_limit offset p_offset;

  get diagnostics v_count = row_count;
  perform app_private.write_security_activity(
    auth.uid(),
    p_user_id,
    'privacy',
    'owner.raw_activity.viewed',
    'viewed',
    'owner_list_security_activity',
    'profile',
    p_user_id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'access_reason', btrim(p_reason),
      'category_filter', p_category,
      'from_filter', p_from,
      'to_filter', p_to,
      'row_count', v_count
    )
  );
end;
$$;

revoke all on function public.owner_list_security_activity(
  text, uuid, text, timestamptz, timestamptz, integer, integer
) from public, anon, service_role;
grant execute on function public.owner_list_security_activity(
  text, uuid, text, timestamptz, timestamptz, integer, integer
) to authenticated;

create or replace function public.owner_list_security_log_access_requests(
  p_reason text,
  p_status text default null,
  p_user_id uuid default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  request_id uuid,
  requester_user_id uuid,
  requester_display_name text,
  subject_user_id uuid,
  subject_display_name text,
  is_requester boolean,
  is_subject boolean,
  requested_from timestamptz,
  requested_to timestamptz,
  reason text,
  created_at timestamptz,
  request_expires_at timestamptz,
  subject_decision text,
  owner_decision text,
  access_expires_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '로그 승인 요청함 조회 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = '승인 요청함 조회 사유를 10자 이상 입력해 주세요.';
  end if;
  if p_status is not null and p_status not in (
    'awaiting_subject_consent', 'awaiting_owner_approval', 'approved',
    'denied', 'revoked', 'expired'
  ) then
    raise exception using errcode = '22023', message = '요청 상태 필터가 올바르지 않습니다.';
  end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 100000 then
    raise exception using errcode = '22023', message = '페이지 범위가 올바르지 않습니다.';
  end if;

  return query
  select
    state.id,
    state.requester_user_id,
    coalesce(requester.display_name, '탈퇴회원'),
    state.subject_user_id,
    coalesce(subject.display_name, '탈퇴회원'),
    false,
    false,
    state.requested_from,
    state.requested_to,
    state.reason,
    state.created_at,
    state.request_expires_at,
    state.subject_decision,
    state.owner_decision,
    state.access_expires_at,
    state.status
  from app_private.security_log_request_states as state
  left join public.profiles as requester on requester.id = state.requester_user_id
  left join public.profiles as subject on subject.id = state.subject_user_id
  where (p_status is null or state.status = p_status)
    and (p_user_id is null or p_user_id in (
      state.requester_user_id, state.subject_user_id
    ))
  order by state.created_at desc, state.id desc
  limit p_limit offset p_offset;

  get diagnostics v_count = row_count;
  perform app_private.write_security_activity(
    auth.uid(), p_user_id, 'privacy', 'owner.log_request_queue.viewed',
    'viewed', 'owner_list_security_log_access_requests', 'profile',
    p_user_id::text, 'notice', null, null,
    jsonb_build_object(
      'access_reason', btrim(p_reason),
      'status_filter', p_status,
      'row_count', v_count
    )
  );
end;
$$;

revoke all on function public.owner_list_security_log_access_requests(
  text, text, uuid, integer, integer
) from public, anon, service_role;
grant execute on function public.owner_list_security_log_access_requests(
  text, text, uuid, integer, integer
) to authenticated;

create or replace function public.owner_decide_security_log_access(
  p_request_id uuid,
  p_approved boolean,
  p_note text,
  p_access_hours integer default 24
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.security_log_access_requests%rowtype;
  v_decision text;
  v_expires_at timestamptz;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '로그 요청 승인 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = '승인 또는 거절 사유를 10자 이상 입력해 주세요.';
  end if;
  if p_access_hours not between 1 and 24 then
    raise exception using errcode = '22023', message = '임시 열람 시간은 1시간부터 24시간까지입니다.';
  end if;

  select * into v_request
  from public.security_log_access_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '로그 요청을 찾을 수 없습니다.';
  end if;
  if v_request.request_expires_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = '로그 요청이 만료되었습니다.';
  end if;
  if exists (
    select 1 from public.security_log_access_decisions
    where request_id = p_request_id
      and decision_type in ('owner_approved', 'owner_denied')
  ) then
    raise exception using errcode = '23505', message = '이미 관리자 결정이 완료되었습니다.';
  end if;
  if exists (
    select 1 from public.security_log_access_decisions
    where request_id = p_request_id and decision_type = 'access_revoked'
  ) then
    raise exception using errcode = '42501', message = '정보 주체가 동의를 철회한 요청입니다.';
  end if;
  if p_approved
    and v_request.requester_user_id <> v_request.subject_user_id
    and not exists (
      select 1 from public.security_log_access_decisions
      where request_id = p_request_id and decision_type = 'subject_approved'
    ) then
    raise exception using errcode = '42501', message = '정보 주체의 동의가 먼저 필요합니다.';
  end if;

  v_decision := case when p_approved then 'owner_approved' else 'owner_denied' end;
  v_expires_at := case
    when p_approved then clock_timestamp() + make_interval(hours => p_access_hours)
    else null
  end;

  insert into public.security_log_access_decisions (
    request_id, actor_user_id, decision_type, note, access_expires_at
  ) values (
    p_request_id, auth.uid(), v_decision, btrim(p_note), v_expires_at
  );

  perform app_private.write_security_activity(
    auth.uid(),
    v_request.requester_user_id,
    'privacy',
    'privacy.log_access.' || v_decision,
    v_decision,
    'security_log_access_decisions',
    'log_access_request',
    p_request_id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'outcome', case when p_approved then 'approved' else 'denied' end,
      'access_hours', case when p_approved then p_access_hours else null end,
      'access_reason', btrim(p_note)
    )
  );
end;
$$;

revoke all on function public.owner_decide_security_log_access(
  uuid, boolean, text, integer
) from public, anon, service_role;
grant execute on function public.owner_decide_security_log_access(
  uuid, boolean, text, integer
) to authenticated;

create or replace function app_private.audit_security_ip_block_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_before jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_after jsonb := to_jsonb(new);
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif old.archived_at is null and new.archived_at is not null then
    v_action := 'archived';
  elsif not old.enabled and new.enabled then
    v_action := 'enabled';
  elsif old.enabled and not new.enabled then
    v_action := 'disabled';
  else
    v_action := 'updated';
  end if;

  insert into public.security_ip_block_rule_audit (
    rule_id, actor_user_id, action, change_reason, before_state, after_state
  ) values (
    new.id,
    auth.uid(),
    v_action,
    coalesce(
      nullif(current_setting('app.security_ip_change_reason', true), ''),
      new.reason
    ),
    v_before,
    v_after
  );

  perform app_private.write_security_activity(
    auth.uid(),
    null,
    'security',
    'security.ip_block.' || v_action,
    v_action,
    'security_ip_block_rules',
    'ip_block_rule',
    new.id::text,
    case when new.enabled then 'warning' else 'notice' end,
    null,
    null,
    jsonb_build_object(
      'network', new.network::text,
      'enabled', new.enabled,
      'expires_at', new.expires_at,
      'archived', new.archived_at is not null,
      'access_reason', coalesce(
        nullif(current_setting('app.security_ip_change_reason', true), ''),
        new.reason
      )
    )
  );
  return new;
end;
$$;

revoke all on function app_private.audit_security_ip_block_rule()
from public, anon, authenticated, service_role;

create trigger security_ip_block_rules_audit
after insert or update on public.security_ip_block_rules
for each row execute function app_private.audit_security_ip_block_rule();

create or replace function app_private.parse_security_network(p_network text)
returns cidr
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_network cidr;
begin
  begin
    v_network := btrim(p_network)::cidr;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'IP 또는 CIDR 형식이 올바르지 않습니다.';
  end;
  if (family(v_network) = 4 and masklen(v_network) < 8)
    or (family(v_network) = 6 and masklen(v_network) < 32) then
    raise exception using errcode = '22023', message = '지나치게 넓은 IP 대역은 차단할 수 없습니다.';
  end if;
  return v_network;
end;
$$;

create or replace function app_private.assert_owner_not_in_security_network(
  p_network cidr
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.security_session_records as sessions
    join public.account_access_roles as roles on roles.user_id = sessions.user_id
    where roles.role_code = 'owner'
      and sessions.last_seen_at > clock_timestamp() - interval '30 minutes'
      and sessions.latest_ip <<= p_network
  ) then
    raise exception using
      errcode = '22023',
      message = '현재 관리자 세션이 포함된 IP 대역은 차단할 수 없습니다.';
  end if;
end;
$$;

create or replace function app_private.assert_request_ip_not_in_security_network(
  p_request_ip text,
  p_network cidr
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_request_ip inet;
begin
  begin
    v_request_ip := btrim(p_request_ip)::inet;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = '현재 요청 IP를 확인할 수 없습니다.';
  end;
  if v_request_ip <<= p_network then
    raise exception using
      errcode = '22023',
      message = '현재 관리자 접속 IP가 포함된 대역은 차단할 수 없습니다.';
  end if;
end;
$$;

revoke all on function app_private.parse_security_network(text),
  app_private.assert_owner_not_in_security_network(cidr),
  app_private.assert_request_ip_not_in_security_network(text, cidr)
from public, anon, authenticated, service_role;

create or replace function public.owner_create_ip_block_rule(
  p_network text,
  p_request_ip text,
  p_reason text,
  p_label text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_network cidr;
  v_rule_id uuid;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'IP 차단 생성 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500
    or (p_label is not null and char_length(btrim(p_label)) not between 2 and 80)
    or (p_expires_at is not null and p_expires_at <= clock_timestamp()) then
    raise exception using errcode = '22023', message = 'IP 차단 설정값이 올바르지 않습니다.';
  end if;

  v_network := app_private.parse_security_network(p_network);
  perform app_private.assert_request_ip_not_in_security_network(p_request_ip, v_network);
  perform app_private.assert_owner_not_in_security_network(v_network);
  perform set_config('app.security_ip_change_reason', btrim(p_reason), true);

  insert into public.security_ip_block_rules (
    network, label, reason, enabled, expires_at, created_by, updated_by
  ) values (
    v_network, nullif(btrim(p_label), ''), btrim(p_reason), true,
    p_expires_at, auth.uid(), auth.uid()
  ) returning id into v_rule_id;

  return v_rule_id;
end;
$$;

revoke all on function public.owner_create_ip_block_rule(
  text, text, text, text, timestamptz
) from public, anon, service_role;
grant execute on function public.owner_create_ip_block_rule(
  text, text, text, text, timestamptz
) to authenticated;

create or replace function public.owner_update_ip_block_rule(
  p_rule_id uuid,
  p_change_reason text,
  p_request_ip text,
  p_network text default null,
  p_label text default null,
  p_clear_label boolean default false,
  p_reason text default null,
  p_enabled boolean default null,
  p_expires_at timestamptz default null,
  p_clear_expires_at boolean default false,
  p_archive boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.security_ip_block_rules%rowtype;
  v_network cidr;
  v_label text;
  v_reason text;
  v_enabled boolean;
  v_expires_at timestamptz;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'IP 차단 수정 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_change_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = 'IP 차단 변경 사유를 10자 이상 입력해 주세요.';
  end if;

  select * into v_rule
  from public.security_ip_block_rules
  where id = p_rule_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'IP 차단 규칙을 찾을 수 없습니다.';
  end if;
  if v_rule.archived_at is not null then
    raise exception using errcode = '22023', message = '보관 처리된 규칙은 수정할 수 없습니다.';
  end if;

  v_network := case
    when p_network is null then v_rule.network
    else app_private.parse_security_network(p_network)
  end;
  v_label := case
    when p_clear_label then null
    when p_label is null then v_rule.label
    else nullif(btrim(p_label), '')
  end;
  v_reason := coalesce(nullif(btrim(p_reason), ''), v_rule.reason);
  v_enabled := case when p_archive then false else coalesce(p_enabled, v_rule.enabled) end;
  v_expires_at := case
    when p_clear_expires_at then null
    when p_expires_at is null then v_rule.expires_at
    else p_expires_at
  end;

  if char_length(v_reason) not between 10 and 500
    or (v_label is not null and char_length(v_label) not between 2 and 80)
    or (
      v_enabled
      and v_expires_at is not null
      and v_expires_at <= clock_timestamp()
    ) then
    raise exception using errcode = '22023', message = 'IP 차단 수정값이 올바르지 않습니다.';
  end if;
  if v_enabled then
    perform app_private.assert_request_ip_not_in_security_network(p_request_ip, v_network);
    perform app_private.assert_owner_not_in_security_network(v_network);
  end if;
  perform set_config('app.security_ip_change_reason', btrim(p_change_reason), true);

  update public.security_ip_block_rules
  set
    network = v_network,
    label = v_label,
    reason = v_reason,
    enabled = v_enabled,
    expires_at = v_expires_at,
    archived_at = case when p_archive then clock_timestamp() else null end,
    updated_by = auth.uid(),
    updated_at = clock_timestamp()
  where id = p_rule_id;
end;
$$;

revoke all on function public.owner_update_ip_block_rule(
  uuid, text, text, text, text, boolean, text, boolean, timestamptz, boolean, boolean
) from public, anon, service_role;
grant execute on function public.owner_update_ip_block_rule(
  uuid, text, text, text, text, boolean, text, boolean, timestamptz, boolean, boolean
) to authenticated;

create or replace function public.owner_list_ip_block_rules(
  p_reason text,
  p_include_archived boolean default false
)
returns table (
  rule_id uuid,
  network text,
  label text,
  reason text,
  enabled boolean,
  expires_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'IP 차단 규칙 조회 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = 'IP 규칙 조회 사유를 10자 이상 입력해 주세요.';
  end if;

  return query
  select rules.id, rules.network::text, rules.label, rules.reason,
    rules.enabled, rules.expires_at, rules.archived_at, rules.created_by,
    rules.updated_by, rules.created_at, rules.updated_at
  from public.security_ip_block_rules as rules
  where p_include_archived or rules.archived_at is null
  order by rules.enabled desc, rules.created_at desc, rules.id;

  get diagnostics v_count = row_count;
  perform app_private.write_security_activity(
    auth.uid(), null, 'security', 'owner.ip_block_rules.viewed', 'viewed',
    'owner_list_ip_block_rules', 'ip_block_rule', null, 'notice', null, null,
    jsonb_build_object(
      'access_reason', btrim(p_reason),
      'include_archived', p_include_archived,
      'row_count', v_count
    )
  );
end;
$$;

revoke all on function public.owner_list_ip_block_rules(text, boolean)
from public, anon, service_role;
grant execute on function public.owner_list_ip_block_rules(text, boolean)
to authenticated;

create or replace function public.is_security_ip_blocked(p_ip text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ip inet;
begin
  begin
    v_ip := btrim(p_ip)::inet;
  exception when invalid_text_representation then
    return true;
  end;

  return exists (
    select 1
    from public.security_ip_block_rules as rules
    where rules.enabled
      and rules.archived_at is null
      and (rules.expires_at is null or rules.expires_at > clock_timestamp())
      and v_ip <<= rules.network
  );
end;
$$;

revoke all on function public.is_security_ip_blocked(text)
from public, anon, authenticated;
grant execute on function public.is_security_ip_blocked(text)
to service_role;

create or replace function public.record_security_session_event(
  p_user_id uuid,
  p_auth_session_id uuid,
  p_client_session_id uuid,
  p_ip text,
  p_user_agent text,
  p_event_type text
)
returns table (
  allowed boolean,
  session_record_id uuid,
  recorded boolean,
  matched_rule_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip inet;
  v_user_agent text := nullif(left(btrim(p_user_agent), 512), '');
  v_rule_id uuid;
  v_existing public.security_session_records%rowtype;
  v_record_id uuid;
  v_outcome text;
  v_meaningful boolean;
  v_is_new boolean;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null or p_client_session_id is null
    or p_event_type not in ('session_started', 'session_resumed', 'heartbeat') then
    raise exception using errcode = '22023', message = '세션 기록값이 올바르지 않습니다.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception using errcode = 'P0002', message = '회원 정보를 찾을 수 없습니다.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'security-session:' || p_user_id::text || ':' || coalesce(p_auth_session_id::text, 'legacy'),
      0
    )
  );
  begin
    v_ip := btrim(p_ip)::inet;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = '접속 IP 형식이 올바르지 않습니다.';
  end;

  select rules.id into v_rule_id
  from public.security_ip_block_rules as rules
  where rules.enabled
    and rules.archived_at is null
    and (rules.expires_at is null or rules.expires_at > v_now)
    and v_ip <<= rules.network
  order by masklen(rules.network) desc, rules.created_at
  limit 1;
  v_outcome := case when v_rule_id is null then 'allowed' else 'blocked' end;

  select * into v_existing
  from public.security_session_records as sessions
  where sessions.user_id = p_user_id
    and sessions.browser_tab_session_id = p_client_session_id
  for update;

  v_is_new := not found;
  if v_is_new and (
    select count(*)
    from public.security_session_records as recent
    where recent.user_id = p_user_id
      and recent.last_seen_at > v_now - interval '24 hours'
      and (
        p_auth_session_id is null
        or recent.auth_session_id = p_auth_session_id
      )
  ) >= 20 then
    raise exception using errcode = '42900', message = '활성 브라우저 세션 수를 초과했습니다.';
  end if;

  v_meaningful := v_is_new
    or v_existing.latest_ip is distinct from v_ip
    or v_existing.last_outcome is distinct from v_outcome
    or v_existing.matched_rule_id is distinct from v_rule_id
    or (
      v_existing.latest_user_agent is distinct from v_user_agent
      and v_existing.last_seen_at < v_now - interval '1 hour'
    )
    or (
      p_event_type in ('session_started', 'session_resumed')
      and v_existing.last_seen_at < v_now - interval '15 minutes'
    );

  insert into public.security_session_records (
    user_id, auth_session_id, browser_tab_session_id, first_seen_at, last_seen_at, latest_ip,
    latest_user_agent, last_event, last_outcome, matched_rule_id
  ) values (
    p_user_id, p_auth_session_id, p_client_session_id, v_now, v_now, v_ip,
    v_user_agent, p_event_type, v_outcome, v_rule_id
  )
  on conflict (user_id, browser_tab_session_id) do update
  set
    last_seen_at = excluded.last_seen_at,
    auth_session_id = excluded.auth_session_id,
    latest_ip = excluded.latest_ip,
    latest_user_agent = excluded.latest_user_agent,
    last_event = excluded.last_event,
    last_outcome = excluded.last_outcome,
    matched_rule_id = excluded.matched_rule_id
  returning id into v_record_id;

  -- Heartbeats only advance last_seen_at. History and the central activity
  -- feed grow only for a new/resumed session or a material IP/UA/outcome change.
  if v_meaningful then
    insert into public.security_session_ip_history (
      session_record_id, user_id, ip_address, user_agent, event_type,
      outcome, matched_rule_id, observed_at
    ) values (
      v_record_id, p_user_id, v_ip, v_user_agent, p_event_type,
      v_outcome, v_rule_id, v_now
    );

    perform app_private.write_security_activity(
      p_user_id,
      p_user_id,
      'session',
      'security.session.' || v_outcome,
      v_outcome,
      'record_security_session_event',
      'security_session',
      v_record_id::text,
      case when v_outcome = 'blocked' then 'warning' else 'info' end,
      v_ip,
      v_user_agent,
      jsonb_build_object(
        'outcome', v_outcome,
        'event', p_event_type,
        'reference', v_record_id::text
      ),
      v_now
    );
  end if;

  return query select v_rule_id is null, v_record_id, v_meaningful, v_rule_id;
end;
$$;

revoke all on function public.record_security_session_event(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_security_session_event(
  uuid, uuid, uuid, text, text, text
) to service_role;

create or replace function public.owner_list_security_sessions(
  p_reason text,
  p_user_id uuid default null,
  p_ip text default null,
  p_outcome text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  session_record_id uuid,
  user_id uuid,
  display_name text,
  auth_session_id uuid,
  browser_tab_session_id uuid,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  latest_ip text,
  latest_user_agent text,
  last_event text,
  last_outcome text,
  matched_rule_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '세션 원문 조회 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = '세션 조회 사유를 10자 이상 입력해 주세요.';
  end if;
  if p_outcome is not null and p_outcome not in ('allowed', 'blocked') then
    raise exception using errcode = '22023', message = '세션 결과 필터가 올바르지 않습니다.';
  end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 100000 then
    raise exception using errcode = '22023', message = '페이지 범위가 올바르지 않습니다.';
  end if;

  return query
  select sessions.id, sessions.user_id, profiles.display_name,
    sessions.auth_session_id, sessions.browser_tab_session_id,
    sessions.first_seen_at, sessions.last_seen_at,
    host(sessions.latest_ip), sessions.latest_user_agent, sessions.last_event,
    sessions.last_outcome, sessions.matched_rule_id
  from public.security_session_records as sessions
  left join public.profiles on profiles.id = sessions.user_id
  where (p_user_id is null or sessions.user_id = p_user_id)
    and (p_ip is null or host(sessions.latest_ip) = btrim(p_ip))
    and (p_outcome is null or sessions.last_outcome = p_outcome)
  order by sessions.last_seen_at desc, sessions.id
  limit p_limit offset p_offset;

  get diagnostics v_count = row_count;
  perform app_private.write_security_activity(
    auth.uid(), p_user_id, 'privacy', 'owner.raw_sessions.viewed', 'viewed',
    'owner_list_security_sessions', 'profile', p_user_id::text, 'notice',
    null, null,
    jsonb_build_object(
      'access_reason', btrim(p_reason),
      'ip_filter_used', p_ip is not null,
      'outcome', p_outcome,
      'row_count', v_count
    )
  );
end;
$$;

revoke all on function public.owner_list_security_sessions(
  text, uuid, text, text, integer, integer
) from public, anon, service_role;
grant execute on function public.owner_list_security_sessions(
  text, uuid, text, text, integer, integer
) to authenticated;

create or replace function public.owner_list_security_session_history(
  p_session_record_id uuid,
  p_reason text,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  history_id bigint,
  session_record_id uuid,
  user_id uuid,
  display_name text,
  ip_address text,
  user_agent text,
  event_type text,
  outcome text,
  matched_rule_id uuid,
  observed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject uuid;
  v_count integer;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '세션 IP 이력 조회 권한이 없습니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception using errcode = '22023', message = 'IP 이력 조회 사유를 10자 이상 입력해 주세요.';
  end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 100000 then
    raise exception using errcode = '22023', message = '페이지 범위가 올바르지 않습니다.';
  end if;

  select sessions.user_id into v_subject
  from public.security_session_records as sessions
  where sessions.id = p_session_record_id;
  if v_subject is null then
    raise exception using errcode = 'P0002', message = '세션을 찾을 수 없습니다.';
  end if;

  return query
  select history.id, history.session_record_id, history.user_id,
    profiles.display_name, host(history.ip_address), history.user_agent,
    history.event_type, history.outcome, history.matched_rule_id,
    history.observed_at
  from public.security_session_ip_history as history
  left join public.profiles on profiles.id = history.user_id
  where history.session_record_id = p_session_record_id
  order by history.observed_at desc, history.id desc
  limit p_limit offset p_offset;

  get diagnostics v_count = row_count;
  perform app_private.write_security_activity(
    auth.uid(), v_subject, 'privacy', 'owner.raw_session_history.viewed',
    'viewed', 'owner_list_security_session_history', 'security_session',
    p_session_record_id::text, 'notice', null, null,
    jsonb_build_object('access_reason', btrim(p_reason), 'row_count', v_count)
  );
end;
$$;

revoke all on function public.owner_list_security_session_history(
  uuid, text, integer, integer
) from public, anon, service_role;
grant execute on function public.owner_list_security_session_history(
  uuid, text, integer, integer
) to authenticated;

create or replace function app_private.safe_security_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(p_value), '') is null then return null; end if;
  return btrim(p_value)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function app_private.safe_security_uuid(text)
from public, anon, authenticated, service_role;

-- A deliberately metadata-only trigger for high-value business actions.
-- It never copies chat bodies, nicknames being requested, addresses, phone
-- numbers, bank details, payment identifiers, tokens, or image URLs.
create or replace function app_private.capture_business_security_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_actor uuid := auth.uid();
  v_subject uuid;
  v_category text;
  v_event text;
  v_action text := lower(tg_op);
  v_entity_type text := tg_table_name;
  v_entity_id text := v_row ->> 'id';
  v_severity text := 'info';
  v_metadata jsonb := '{}'::jsonb;
  v_conversation_member uuid;
begin
  case tg_table_name
    when 'profiles' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'id');
      v_actor := coalesce(v_actor, v_subject);
      v_category := 'account';
      v_event := case when tg_op = 'DELETE'
        then 'account.profile.deleted' else 'account.profile.updated' end;
      v_metadata := jsonb_build_object(
        'changed_fields', to_jsonb(array_remove(array[
          case when v_old ->> 'display_name' is distinct from v_new ->> 'display_name'
            then 'display_name' end,
          case when v_old ->> 'avatar_url' is distinct from v_new ->> 'avatar_url'
            then 'avatar_url' end
        ]::text[], null))
      );
    when 'member_accounts' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'member_id');
      v_category := 'account';
      v_event := 'account.status.updated';
      v_entity_id := v_row ->> 'member_id';
      v_metadata := jsonb_build_object(
        'previous_status', v_old ->> 'account_status',
        'status', v_new ->> 'account_status',
        'changed_fields', to_jsonb(array_remove(array[
          case when v_old ->> 'account_status' is distinct from v_new ->> 'account_status'
            then 'account_status' end,
          case when v_old ->> 'shipping_credit_count' is distinct from v_new ->> 'shipping_credit_count'
            then 'shipping_credit_count' end
        ]::text[], null))
      );
    when 'account_access_roles' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'user_id');
      v_category := 'authorization';
      v_event := 'authorization.role.' || v_action;
      v_entity_id := v_row ->> 'user_id';
      v_severity := 'notice';
      v_metadata := jsonb_build_object(
        'previous_role', v_old ->> 'role_code',
        'role', v_new ->> 'role_code',
        'changed_fields', jsonb_build_array('role_code')
      );
    when 'products' then
      v_actor := coalesce(
        v_actor,
        app_private.safe_security_uuid(v_row ->> 'updated_by'),
        app_private.safe_security_uuid(v_row ->> 'created_by')
      );
      v_subject := app_private.safe_security_uuid(v_row ->> 'created_by');
      v_category := 'product';
      v_event := 'product.' || v_action;
      v_metadata := jsonb_build_object(
        'previous_status', v_old ->> 'status',
        'status', v_new ->> 'status',
        'previous_amount', case when v_old ? 'current_price' then (v_old ->> 'current_price')::bigint end,
        'new_amount', case when v_new ? 'current_price' then (v_new ->> 'current_price')::bigint end
      );
    when 'auction_bids' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'bidder_id');
      v_actor := coalesce(v_actor, v_subject);
      v_category := 'auction';
      v_event := case when tg_op = 'INSERT'
        then 'auction.bid.placed' else 'auction.bid.removed' end;
      v_entity_type := 'product';
      v_entity_id := v_row ->> 'product_id';
      v_metadata := jsonb_build_object('amount', (v_row ->> 'amount')::bigint);
    when 'cancelled_auction_bids' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'bidder_id');
      v_category := 'sanction';
      v_event := 'auction.bid.cancelled_by_sanction';
      v_entity_type := 'product';
      v_entity_id := v_row ->> 'product_id';
      v_severity := 'warning';
      v_metadata := jsonb_build_object('amount', (v_row ->> 'amount')::bigint, 'status', 'cancelled');
    when 'support_messages' then
      v_actor := coalesce(v_actor, app_private.safe_security_uuid(v_row ->> 'sender_id'));
      select conversations.member_id into v_conversation_member
      from public.support_conversations as conversations
      where conversations.id = app_private.safe_security_uuid(v_row ->> 'conversation_id');
      v_subject := v_conversation_member;
      v_category := 'support';
      v_event := case when (
        select count(*) from public.support_messages as messages
        where messages.conversation_id = app_private.safe_security_uuid(v_row ->> 'conversation_id')
      ) = 1 then 'support.conversation.started' else 'support.message.sent' end;
      v_entity_type := 'support_conversation';
      v_entity_id := v_row ->> 'conversation_id';
      v_metadata := jsonb_build_object('status', 'message_recorded');
    when 'support_conversations' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'member_id');
      v_category := 'support';
      v_event := 'support.conversation.status_changed';
      v_metadata := jsonb_build_object(
        'previous_status', v_old ->> 'status',
        'status', v_new ->> 'status'
      );
    when 'payment_orders' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'buyer_id');
      v_category := 'payment';
      v_event := 'payment.order.' || v_action;
      v_metadata := jsonb_build_object(
        'previous_status', v_old ->> 'payment_status',
        'payment_status', v_new ->> 'payment_status',
        'amount', (v_row ->> 'expected_amount')::bigint
      );
    when 'shipping_requests' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'member_id');
      v_actor := coalesce(v_actor, v_subject);
      v_category := 'shipping';
      v_event := 'shipping.request.' || v_action;
      v_metadata := jsonb_build_object(
        'previous_status', v_old ->> 'status',
        'shipping_status', v_new ->> 'status'
      );
    when 'shipping_addresses' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'member_id');
      v_actor := coalesce(v_actor, v_subject);
      v_category := 'shipping';
      v_event := 'shipping.address.' || v_action;
      v_metadata := jsonb_build_object('changed_fields', jsonb_build_array('shipping_address'));
    when 'member_warnings' then
      v_actor := coalesce(v_actor, app_private.safe_security_uuid(v_row ->> 'created_by'));
      v_subject := app_private.safe_security_uuid(v_row ->> 'member_id');
      v_category := 'sanction';
      v_event := 'sanction.warning.created';
      v_severity := 'warning';
      v_metadata := jsonb_build_object(
        'warning_number', (v_row ->> 'warning_number')::integer,
        'status', v_row ->> 'category'
      );
    when 'member_bid_sanctions' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'member_id');
      v_category := 'sanction';
      v_event := 'sanction.bid_restriction.created';
      v_severity := 'warning';
      v_metadata := jsonb_build_object(
        'sanction_round', (v_row ->> 'sanction_round')::integer,
        'status', 'active'
      );
    when 'nickname_change_requests' then
      v_subject := app_private.safe_security_uuid(v_row ->> 'member_id');
      v_actor := coalesce(v_actor, v_subject);
      v_category := 'account';
      v_event := 'account.nickname_request.' || v_action;
      v_metadata := jsonb_build_object(
        'previous_status', v_old ->> 'status',
        'status', v_new ->> 'status'
      );
    else
      if tg_op = 'DELETE' then return old; end if;
      return new;
  end case;

  perform app_private.write_security_activity(
    v_actor, v_subject, v_category, v_event, v_action, tg_table_name,
    v_entity_type, v_entity_id, v_severity, null, null,
    jsonb_strip_nulls(v_metadata)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function app_private.capture_business_security_activity()
from public, anon, authenticated, service_role;

create trigger profiles_update_security_activity
after update on public.profiles
for each row when (
  old.display_name is distinct from new.display_name
  or old.avatar_url is distinct from new.avatar_url
)
execute function app_private.capture_business_security_activity();
create trigger profiles_delete_security_activity
after delete on public.profiles
for each row
execute function app_private.capture_business_security_activity();
create trigger member_accounts_security_activity
after update on public.member_accounts
for each row execute function app_private.capture_business_security_activity();
create trigger account_access_roles_security_activity
after insert or update on public.account_access_roles
for each row execute function app_private.capture_business_security_activity();
create trigger products_security_activity
after insert or update or delete on public.products
for each row execute function app_private.capture_business_security_activity();
create trigger auction_bids_security_activity
after insert or delete on public.auction_bids
for each row execute function app_private.capture_business_security_activity();
create trigger cancelled_auction_bids_security_activity
after insert on public.cancelled_auction_bids
for each row execute function app_private.capture_business_security_activity();
create trigger support_messages_security_activity
after insert on public.support_messages
for each row execute function app_private.capture_business_security_activity();
create trigger support_conversations_security_activity
after update of status on public.support_conversations
for each row when (old.status is distinct from new.status)
execute function app_private.capture_business_security_activity();
create trigger payment_orders_security_activity
after insert or update on public.payment_orders
for each row execute function app_private.capture_business_security_activity();
create trigger shipping_requests_security_activity
after insert or update on public.shipping_requests
for each row execute function app_private.capture_business_security_activity();
create trigger shipping_addresses_security_activity
after insert or update or delete on public.shipping_addresses
for each row execute function app_private.capture_business_security_activity();
create trigger member_warnings_security_activity
after insert on public.member_warnings
for each row execute function app_private.capture_business_security_activity();
create trigger member_bid_sanctions_security_activity
after insert on public.member_bid_sanctions
for each row execute function app_private.capture_business_security_activity();
create trigger nickname_change_requests_security_activity
after insert or update on public.nickname_change_requests
for each row execute function app_private.capture_business_security_activity();

-- Close the one legacy raw-table bypass. Existing owner UI reads this source
-- through a SECURITY DEFINER RPC and the normalized feed above.
revoke select on public.owner_auction_action_audit from authenticated;

create or replace function public.reject_append_only_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.security_retention_cleanup', true) = 'authorized' then
    return null;
  end if;
  raise exception using errcode = '42501', message = '감사 로그는 수정하거나 삭제할 수 없습니다.';
end;
$$;

create or replace function public.prevent_owner_auction_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.security_retention_cleanup', true) = 'authorized' then
    return null;
  end if;
  raise exception using errcode = '42501', message = '경매 조작 감사 기록은 변경할 수 없습니다.';
end;
$$;

-- Retention is deterministic and narrow: raw session/IP/UA data is kept for
-- 90 days; business/security activity and access-control audit is kept for at
-- least one year. The only deletion exception is this private scheduled job,
-- and every run writes an append-only aggregate receipt without personal data.
create table public.security_retention_runs (
  id bigint generated always as identity primary key,
  session_history_deleted integer not null default 0,
  session_records_deleted integer not null default 0,
  activity_logs_deleted integer not null default 0,
  access_decisions_deleted integer not null default 0,
  access_requests_deleted integer not null default 0,
  ip_rule_audit_deleted integer not null default 0,
  archived_ip_rules_deleted integer not null default 0,
  legacy_owner_audit_deleted integer not null default 0,
  legacy_delegation_sessions_deleted integer not null default 0,
  occurred_at timestamptz not null default clock_timestamp()
);

alter table public.security_retention_runs enable row level security;
alter table public.security_retention_runs force row level security;
revoke all on public.security_retention_runs
from public, anon, authenticated, service_role;
create trigger security_retention_runs_append_only
before update or delete or truncate on public.security_retention_runs
for each statement execute function app_private.reject_security_history_mutation();

create or replace function app_private.reject_security_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.security_retention_cleanup', true) = 'authorized' then
    return null;
  end if;
  raise exception using
    errcode = '42501',
    message = '보안 및 개인정보 감사 기록은 수정하거나 삭제할 수 없습니다.';
end;
$$;

create or replace function app_private.run_security_retention_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_history integer := 0;
  v_session_records integer := 0;
  v_activity integer := 0;
  v_decisions integer := 0;
  v_requests integer := 0;
  v_rule_audit integer := 0;
  v_rules integer := 0;
  v_legacy_audit integer := 0;
  v_legacy_part integer := 0;
  v_delegation_sessions integer := 0;
  v_now timestamptz := clock_timestamp();
  v_session_cutoff timestamptz := v_now - interval '90 days';
  v_audit_cutoff timestamptz := v_now - interval '1 year';
begin
  perform set_config('app.security_retention_cleanup', 'authorized', true);

  delete from public.security_session_ip_history
  where observed_at < v_session_cutoff;
  get diagnostics v_session_history = row_count;

  delete from public.security_session_records
  where last_seen_at < v_session_cutoff;
  get diagnostics v_session_records = row_count;

  delete from public.security_activity_logs
  where (
    category = 'session'
    and occurred_at < v_session_cutoff
  ) or (
    category <> 'session'
    and occurred_at < v_audit_cutoff
  );
  get diagnostics v_activity = row_count;

  delete from public.security_log_access_decisions as decisions
  using public.security_log_access_requests as requests
  where decisions.request_id = requests.id
    and requests.created_at < v_audit_cutoff;
  get diagnostics v_decisions = row_count;

  delete from public.security_log_access_requests
  where created_at < v_audit_cutoff;
  get diagnostics v_requests = row_count;

  delete from public.security_ip_block_rule_audit
  where occurred_at < v_audit_cutoff;
  get diagnostics v_rule_audit = row_count;

  delete from public.security_ip_block_rules
  where archived_at < v_audit_cutoff;
  get diagnostics v_rules = row_count;

  delete from public.owner_operator_delegation_audit
  where occurred_at < v_audit_cutoff;
  get diagnostics v_legacy_part = row_count;
  v_legacy_audit := v_legacy_audit + v_legacy_part;

  delete from public.owner_hidden_test_member_audit
  where occurred_at < v_audit_cutoff;
  get diagnostics v_legacy_part = row_count;
  v_legacy_audit := v_legacy_audit + v_legacy_part;

  delete from public.owner_auction_action_audit
  where occurred_at < v_audit_cutoff;
  get diagnostics v_legacy_part = row_count;
  v_legacy_audit := v_legacy_audit + v_legacy_part;

  delete from public.owner_operator_delegation_sessions
  where coalesce(ended_at, expires_at) < v_audit_cutoff;
  get diagnostics v_delegation_sessions = row_count;

  insert into public.security_retention_runs (
    session_history_deleted,
    session_records_deleted,
    activity_logs_deleted,
    access_decisions_deleted,
    access_requests_deleted,
    ip_rule_audit_deleted,
    archived_ip_rules_deleted,
    legacy_owner_audit_deleted,
    legacy_delegation_sessions_deleted
  ) values (
    v_session_history,
    v_session_records,
    v_activity,
    v_decisions,
    v_requests,
    v_rule_audit,
    v_rules,
    v_legacy_audit,
    v_delegation_sessions
  );
end;
$$;

revoke all on function app_private.run_security_retention_cleanup()
from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'security-retention-cleanup'
  ) then
    perform cron.schedule(
      'security-retention-cleanup',
      '23 18 * * *',
      $job$select app_private.run_security_retention_cleanup();$job$
    );
  end if;
end;
$$;
