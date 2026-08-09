begin;

alter table public.multi_provider_records add column object_size_bytes bigint
  check (object_size_bytes is null or object_size_bytes>=0);

create table public.storage_provider_runtime_states (
  provider_id text primary key check (provider_id in ('supabase','r2','google_drive')),
  priority integer not null unique check (priority between 1 and 3),
  enabled boolean not null default false,
  capacity_bytes bigint not null check (capacity_bytes>0),
  safe_threshold numeric not null default 0.9 check (safe_threshold>0 and safe_threshold<1),
  restore_threshold numeric not null default 0.4 check (restore_threshold>=0 and restore_threshold<safe_threshold),
  usage_bytes bigint check (usage_bytes is null or usage_bytes>=0),
  usage_measured_at timestamptz,
  credentials_verified_at timestamptz,
  canary_verified_at timestamptz,
  canary_rollback_verified_at timestamptz,
  last_error text,
  version bigint not null default 0 check (version>=0),
  updated_at timestamptz not null default clock_timestamp(),
  check (provider_id<>'google_drive' or capacity_bytes<=3298534883328),
  check (not enabled or provider_id='supabase' or (usage_bytes is not null and usage_measured_at is not null
    and credentials_verified_at is not null and canary_verified_at is not null
    and canary_rollback_verified_at is not null))
);

create table public.storage_routing_policy (
  singleton boolean primary key default true check (singleton),
  active_provider_id text not null references public.storage_provider_runtime_states(provider_id),
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid references public.profiles(id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  version bigint not null default 0 check (version>=0)
);
create table public.storage_routing_events (
  id uuid primary key default gen_random_uuid(),
  previous_provider_id text not null,
  next_provider_id text not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  policy_version bigint not null,
  occurred_at timestamptz not null default clock_timestamp()
);

insert into public.storage_provider_runtime_states(provider_id,priority,enabled,capacity_bytes,
  usage_bytes,usage_measured_at,credentials_verified_at,canary_verified_at,canary_rollback_verified_at)
values('supabase',1,true,1073741824,null,null,null,null,null),
  ('r2',2,false,10737418240,null,null,null,null,null),
  ('google_drive',3,false,3298534883328,null,null,null,null,null);
insert into public.storage_routing_policy(active_provider_id,reason) values('supabase','initial canonical provider');

alter table public.storage_provider_runtime_states enable row level security;
alter table public.storage_provider_runtime_states force row level security;
alter table public.storage_routing_policy enable row level security;
alter table public.storage_routing_policy force row level security;
alter table public.storage_routing_events enable row level security;
alter table public.storage_routing_events force row level security;
revoke all on table public.storage_provider_runtime_states,public.storage_routing_policy,public.storage_routing_events
  from public,anon,authenticated,service_role;

drop function if exists public.get_multicloud_storage_usage();
create function public.get_multicloud_storage_usage()
returns table(storage_provider_id text,total_bytes bigint,record_count bigint,usage_known boolean)
language sql stable security definer set search_path='' as $$
  select states.provider_id,coalesce(sum(records.object_size_bytes),0)::bigint,count(records.id)::bigint,
    count(records.id) filter(where records.object_size_bytes is null)=0
  from public.storage_provider_runtime_states states
  left join public.multi_provider_records records on records.storage_provider_id=states.provider_id
  group by states.provider_id,states.priority order by states.priority;
$$;
revoke all on function public.get_multicloud_storage_usage() from public,anon,authenticated,service_role;
grant execute on function public.get_multicloud_storage_usage() to service_role;

create function public.get_storage_routing_policy()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('activeProviderId',policy.active_provider_id,'version',policy.version,
    'providers',jsonb_agg(jsonb_build_object('providerId',states.provider_id,'priority',states.priority,
      'enabled',states.enabled,'capacityBytes',states.capacity_bytes,'usageBytes',states.usage_bytes,
      'usageMeasuredAt',states.usage_measured_at,'safeThreshold',states.safe_threshold,
      'restoreThreshold',states.restore_threshold,'credentialsVerifiedAt',states.credentials_verified_at,
      'canaryVerifiedAt',states.canary_verified_at,'rollbackVerifiedAt',states.canary_rollback_verified_at,
      'version',states.version)
      order by states.priority))
  from public.storage_routing_policy policy cross join public.storage_provider_runtime_states states
  group by policy.active_provider_id,policy.version;
$$;
revoke all on function public.get_storage_routing_policy() from public,anon,authenticated,service_role;
grant execute on function public.get_storage_routing_policy() to service_role;

create function public.update_storage_provider_runtime_state(p_provider_id text,p_enabled boolean,
  p_capacity_bytes bigint,p_usage_bytes bigint,p_usage_measured_at timestamptz,
  p_credentials_verified_at timestamptz,p_canary_verified_at timestamptz,
  p_rollback_verified_at timestamptz,p_last_error text,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state public.storage_provider_runtime_states%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='service role required'; end if;
  update public.storage_provider_runtime_states set enabled=p_enabled,capacity_bytes=p_capacity_bytes,
    usage_bytes=p_usage_bytes,usage_measured_at=p_usage_measured_at,
    credentials_verified_at=p_credentials_verified_at,canary_verified_at=p_canary_verified_at,
    canary_rollback_verified_at=p_rollback_verified_at,last_error=nullif(btrim(p_last_error),''),
    version=version+1,updated_at=clock_timestamp()
  where provider_id=p_provider_id and version=p_expected_version returning * into v_state;
  if not found then raise exception using errcode='40001',message='storage provider state changed'; end if;
  return to_jsonb(v_state);
end; $$;
revoke all on function public.update_storage_provider_runtime_state(text,boolean,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,text,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.update_storage_provider_runtime_state(text,boolean,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,text,bigint) to service_role;

create function public.set_storage_active_provider(p_provider_id text,p_reason text,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_policy public.storage_routing_policy%rowtype; v_current public.storage_provider_runtime_states%rowtype;
  v_target public.storage_provider_runtime_states%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='service role required'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 3 and 300
  then raise exception using errcode='22023',message='storage routing reason required'; end if;
  select * into v_policy from public.storage_routing_policy where singleton for update;
  if v_policy.version<>p_expected_version then raise exception using errcode='40001',message='storage routing policy changed'; end if;
  select * into v_current from public.storage_provider_runtime_states where provider_id=v_policy.active_provider_id;
  select * into v_target from public.storage_provider_runtime_states where provider_id=p_provider_id;
  if not found or not v_target.enabled or v_target.usage_bytes is null
    or v_target.usage_measured_at<clock_timestamp()-interval '24 hours'
    or (v_target.provider_id<>'supabase' and (v_target.credentials_verified_at is null
      or v_target.canary_verified_at is null or v_target.canary_rollback_verified_at is null))
  then raise exception using errcode='55000',message='target storage provider is not verified'; end if;
  if v_target.priority>v_current.priority and (v_current.usage_bytes is null
    or v_current.usage_bytes::numeric/v_current.capacity_bytes<v_current.safe_threshold)
  then raise exception using errcode='55000',message='current storage has not reached rollover threshold'; end if;
  if v_target.priority<v_current.priority and
    v_target.usage_bytes::numeric/v_target.capacity_bytes>v_target.restore_threshold
  then raise exception using errcode='55000',message='preferred storage has not reached restore threshold'; end if;
  update public.storage_routing_policy set active_provider_id=p_provider_id,changed_at=clock_timestamp(),
    changed_by=auth.uid(),reason=btrim(p_reason),version=version+1 where singleton returning * into v_policy;
  insert into public.storage_routing_events(previous_provider_id,next_provider_id,reason,policy_version)
  values(v_current.provider_id,p_provider_id,btrim(p_reason),v_policy.version);
  return jsonb_build_object('activeProviderId',v_policy.active_provider_id,'version',v_policy.version);
end; $$;
revoke all on function public.set_storage_active_provider(text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.set_storage_active_provider(text,text,bigint) to service_role;

commit;
