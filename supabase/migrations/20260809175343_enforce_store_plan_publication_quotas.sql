begin;

alter table public.store_service_subscriptions
  alter column plan_code set default 'standard';

update public.store_service_subscriptions
set plan_code = 'standard',
    monthly_fee = 30000,
    status = 'active',
    started_at = coalesce(started_at, created_at),
    next_billing_at = coalesce(next_billing_at, created_at + interval '1 month'),
    billing_anchor_day = coalesce(
      billing_anchor_day,
      extract(day from created_at at time zone 'Asia/Seoul')::integer
    ),
    version = version + 1,
    updated_at = clock_timestamp()
where plan_code = 'basic';

alter table public.store_service_subscriptions
  add column automation_client_id text,
  add column automation_version text,
  add column automation_enabled boolean not null default false,
  add column automation_linked_at timestamptz,
  add constraint store_service_subscriptions_automation_check check (
    (not automation_enabled and automation_client_id is null
      and automation_version is null and automation_linked_at is null)
    or (automation_enabled and plan_code = 'pro' and status = 'active'
      and char_length(btrim(automation_client_id)) between 3 and 120
      and char_length(btrim(automation_version)) between 1 and 80
      and automation_linked_at is not null)
  );

alter table public.store_daily_usage
  add column immediate_publish_count integer not null default 0
    check (immediate_publish_count between 0 and 60),
  add column scheduled_publish_count integer not null default 0
    check (scheduled_publish_count between 0 and 80);

create table public.store_service_subscription_audits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('requested','approved','rejected','changed','cancelled')),
  previous_plan_code text,
  requested_plan_code text,
  resulting_plan_code text,
  effective_at timestamptz,
  next_billing_at timestamptz,
  reason text check (reason is null or char_length(btrim(reason)) between 3 and 300),
  automation_client_id text,
  automation_version text,
  created_at timestamptz not null default clock_timestamp()
);

create index store_service_subscription_audits_store_idx
  on public.store_service_subscription_audits(store_id, created_at desc, id desc);

create table public.store_automation_upload_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  automation_client_id text not null,
  automation_version text not null,
  item_count integer not null check (item_count between 1 and 300),
  idempotency_key uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (store_id, idempotency_key)
);

create index store_automation_upload_events_rolling_idx
  on public.store_automation_upload_events(store_id, created_at desc);

alter table public.store_service_subscription_audits enable row level security;
alter table public.store_service_subscription_audits force row level security;
alter table public.store_automation_upload_events enable row level security;
alter table public.store_automation_upload_events force row level security;
revoke all on table public.store_service_subscription_audits,
  public.store_automation_upload_events from public, anon, authenticated, service_role;
grant select on table public.store_service_subscription_audits,
  public.store_automation_upload_events to authenticated, service_role;
create policy "Authorized stores read subscription audits"
  on public.store_service_subscription_audits for select to authenticated
  using (public.is_owner() or public.has_store_permission(store_id,'manage_store'));
create policy "Authorized stores read automation usage"
  on public.store_automation_upload_events for select to authenticated
  using (public.is_owner() or public.has_store_permission(store_id,'manage_products'));
create policy "Service reads subscription audits"
  on public.store_service_subscription_audits for select to service_role using (true);
create policy "Service reads automation usage"
  on public.store_automation_upload_events for select to service_role using (true);

create or replace function app_private.store_publication_limits(p_store_id uuid)
returns table(
  effective_plan text,
  immediate_daily_limit integer,
  scheduled_daily_limit integer,
  pending_inventory_limit integer,
  automation_rolling_limit integer
)
language sql stable security definer set search_path = ''
as $$
  select
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 'pro' else 'standard' end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 60 else 30 end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 80 else 40 end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      then 200 else 100 end,
    case when subscriptions.plan_code = 'pro' and subscriptions.status = 'active'
      and subscriptions.automation_enabled then 300 else 0 end
  from (select p_store_id as store_id) input
  left join public.store_service_subscriptions subscriptions
    on subscriptions.store_id = input.store_id;
$$;
revoke all on function app_private.store_publication_limits(uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.enforce_store_product_publication_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limits record;
  v_pending_count integer;
  v_used integer;
  v_date date := timezone('Asia/Seoul', statement_timestamp())::date;
  v_is_new_pending boolean := new.status = 'pending'
    and (tg_op = 'INSERT' or old.status is distinct from 'pending');
  v_is_publication boolean := new.status = 'active'
    and (tg_op = 'INSERT' or old.status is distinct from 'active');
  v_scheduled boolean;
begin
  if new.store_id is null then return new; end if;
  select * into v_limits from app_private.store_publication_limits(new.store_id);

  if v_is_new_pending then
    select count(*) into v_pending_count
    from public.products products
    where products.store_id = new.store_id and products.status = 'pending';
    if v_pending_count >= v_limits.pending_inventory_limit then
      raise exception using errcode='P0001', message=format(
        '초안과 예약 대기는 합계 %s개까지 저장할 수 있습니다.',
        v_limits.pending_inventory_limit
      );
    end if;
  end if;

  if v_is_publication then
    v_scheduled := new.publish_at is not null
      and new.publish_at > new.created_at + interval '1 minute';
    insert into public.store_daily_usage as usage(
      store_id, usage_date, immediate_publish_count,
      scheduled_publish_count, updated_at
    ) values (
      new.store_id, v_date,
      case when v_scheduled then 0 else 1 end,
      case when v_scheduled then 1 else 0 end,
      statement_timestamp()
    )
    on conflict(store_id,usage_date) do update set
      immediate_publish_count = usage.immediate_publish_count
        + case when v_scheduled then 0 else 1 end,
      scheduled_publish_count = usage.scheduled_publish_count
        + case when v_scheduled then 1 else 0 end,
      updated_at = statement_timestamp()
    where (v_scheduled and usage.scheduled_publish_count < v_limits.scheduled_daily_limit)
       or (not v_scheduled and usage.immediate_publish_count < v_limits.immediate_daily_limit)
    returning case when v_scheduled then scheduled_publish_count
      else immediate_publish_count end into v_used;
    if v_used is null then
      raise exception using errcode='P0001', message=case when v_scheduled
        then format('오늘 예약 공개 한도 %s건을 모두 사용했습니다.',v_limits.scheduled_daily_limit)
        else format('오늘 즉시 공개 한도 %s건을 모두 사용했습니다.',v_limits.immediate_daily_limit)
      end;
    end if;
  end if;
  return new;
end; $$;
revoke all on function app_private.enforce_store_product_publication_quota()
  from public, anon, authenticated, service_role;
drop trigger if exists products_enforce_store_daily_quota on public.products;
create trigger products_enforce_store_publication_quota
before insert or update of status,publish_at on public.products
for each row execute function app_private.enforce_store_product_publication_quota();

create or replace function public.reserve_store_automation_upload(
  p_store_id uuid,
  p_automation_client_id text,
  p_automation_version text,
  p_item_count integer,
  p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_subscription public.store_service_subscriptions%rowtype;
  v_used integer;
  v_existing public.store_automation_upload_events%rowtype;
begin
  if auth.uid() is null or p_item_count not between 1 and 300
    or p_idempotency_key is null
    or not public.has_store_permission(p_store_id,'manage_products') then
    raise exception using errcode='42501',message='자동화 업로드 권한 또는 입력값을 확인해 주세요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text,11));
  select * into v_existing from public.store_automation_upload_events
    where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.item_count<>p_item_count
      or v_existing.automation_client_id<>p_automation_client_id
      or v_existing.automation_version<>p_automation_version then
      raise exception using errcode='PT409',message='자동화 업로드 키를 다른 요청에 재사용할 수 없습니다.';
    end if;
    return jsonb_build_object('allowed',true,'idempotentReplay',true,'used',(
      select coalesce(sum(item_count),0) from public.store_automation_upload_events
      where store_id=p_store_id and created_at>=clock_timestamp()-interval '7 days'
    ),'limit',300);
  end if;
  select * into v_subscription from public.store_service_subscriptions
    where store_id=p_store_id for update;
  if not found or v_subscription.plan_code<>'pro' or v_subscription.status<>'active'
    or not v_subscription.automation_enabled
    or v_subscription.automation_client_id<>btrim(p_automation_client_id)
    or v_subscription.automation_version<>btrim(p_automation_version) then
    raise exception using errcode='42501',message='승인된 프리미엄 자동화 프로그램만 사용할 수 있습니다.';
  end if;
  select coalesce(sum(item_count),0)::integer into v_used
  from public.store_automation_upload_events
  where store_id=p_store_id and created_at>=clock_timestamp()-interval '7 days';
  if v_used+p_item_count>300 then
    raise exception using errcode='P0001',message='최근 7일 자동화 업로드 한도 300개를 초과합니다.';
  end if;
  insert into public.store_automation_upload_events(
    store_id,actor_user_id,automation_client_id,automation_version,item_count,idempotency_key
  ) values(p_store_id,auth.uid(),btrim(p_automation_client_id),btrim(p_automation_version),p_item_count,p_idempotency_key);
  return jsonb_build_object('allowed',true,'idempotentReplay',false,'used',v_used+p_item_count,'limit',300);
end; $$;
revoke all on function public.reserve_store_automation_upload(uuid,text,text,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_store_automation_upload(uuid,text,text,integer,uuid)
  to authenticated;

create or replace function public.reject_owner_store_service_plan(
  p_store_id uuid,p_reason text,p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.store_service_subscriptions%rowtype;
begin
  if not public.is_owner() or char_length(btrim(coalesce(p_reason,''))) not between 3 and 300
  then raise exception using errcode='42501',message='소유자 권한과 거절 사유를 확인해 주세요.'; end if;
  select * into v_row from public.store_service_subscriptions where store_id=p_store_id for update;
  if not found or v_row.version is distinct from p_expected_version
  then raise exception using errcode='40001',message='센터 등급 상태가 변경되었습니다.'; end if;
  insert into public.store_service_subscription_audits(
    store_id,actor_user_id,action,previous_plan_code,requested_plan_code,
    resulting_plan_code,effective_at,next_billing_at,reason
  ) values(p_store_id,auth.uid(),'rejected',v_row.plan_code,v_row.requested_plan_code,
    v_row.plan_code,clock_timestamp(),v_row.next_billing_at,btrim(p_reason));
  update public.store_service_subscriptions set requested_plan_code=null,status='active',
    version=version+1,updated_at=clock_timestamp() where store_id=p_store_id returning * into v_row;
  return jsonb_build_object('storeId',v_row.store_id,'status',v_row.status,'version',v_row.version);
end; $$;
revoke all on function public.reject_owner_store_service_plan(uuid,text,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.reject_owner_store_service_plan(uuid,text,bigint) to authenticated;

create or replace function app_private.audit_store_service_subscription_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text;
begin
  if auth.uid() is null then return new; end if;
  if new.status='pending_approval'
    and (old.status is distinct from new.status
      or old.requested_plan_code is distinct from new.requested_plan_code) then
    v_action:='requested';
  elsif old.status='pending_approval' and new.status='active' then
    return new;
  elsif new.status='cancelled' and old.status is distinct from new.status then
    v_action:='cancelled';
  elsif new.plan_code is distinct from old.plan_code
    or new.automation_enabled is distinct from old.automation_enabled
    or new.automation_client_id is distinct from old.automation_client_id
    or new.automation_version is distinct from old.automation_version then
    v_action:='changed';
  else return new;
  end if;
  insert into public.store_service_subscription_audits(
    store_id,actor_user_id,action,previous_plan_code,requested_plan_code,
    resulting_plan_code,effective_at,next_billing_at,automation_client_id,automation_version
  ) values(new.store_id,auth.uid(),v_action,old.plan_code,
    coalesce(old.requested_plan_code,new.requested_plan_code),new.plan_code,
    coalesce(new.started_at,clock_timestamp()),new.next_billing_at,
    new.automation_client_id,new.automation_version);
  return new;
end; $$;
revoke all on function app_private.audit_store_service_subscription_change()
  from public,anon,authenticated,service_role;
create trigger store_service_subscriptions_audit_change
after update on public.store_service_subscriptions
for each row execute function app_private.audit_store_service_subscription_change();

create or replace function public.configure_owner_store_automation(
  p_store_id uuid,p_enabled boolean,p_client_id text,p_version text,p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.store_service_subscriptions%rowtype;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  select * into v_row from public.store_service_subscriptions where store_id=p_store_id for update;
  if not found or v_row.version is distinct from p_expected_version
  then raise exception using errcode='40001',message='센터 구독 상태가 변경되었습니다.'; end if;
  if p_enabled and (v_row.plan_code<>'pro' or v_row.status<>'active'
    or char_length(btrim(coalesce(p_client_id,''))) not between 3 and 120
    or char_length(btrim(coalesce(p_version,''))) not between 1 and 80)
  then raise exception using errcode='22023',message='프리미엄 등급과 자동화 프로그램 정보를 확인해 주세요.'; end if;
  update public.store_service_subscriptions set
    automation_enabled=p_enabled,
    automation_client_id=case when p_enabled then btrim(p_client_id) else null end,
    automation_version=case when p_enabled then btrim(p_version) else null end,
    automation_linked_at=case when p_enabled then clock_timestamp() else null end,
    version=version+1,updated_at=clock_timestamp()
  where store_id=p_store_id returning * into v_row;
  return jsonb_build_object('storeId',v_row.store_id,'automationEnabled',v_row.automation_enabled,
    'automationClientId',v_row.automation_client_id,'automationVersion',v_row.automation_version,'version',v_row.version);
end; $$;
revoke all on function public.configure_owner_store_automation(uuid,boolean,text,text,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.configure_owner_store_automation(uuid,boolean,text,text,bigint) to authenticated;

create or replace function public.request_store_service_plan(p_store_id uuid,p_plan_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.store_service_subscriptions%rowtype;
begin
  if p_plan_code <> 'pro' or not public.has_store_permission(p_store_id,'manage_products')
  then raise exception using errcode='42501',message='프리미엄 등급 신청 권한을 확인해 주세요.'; end if;
  insert into public.store_service_subscriptions(store_id,requested_plan_code,status,updated_at)
  values(p_store_id,'pro','pending_approval',clock_timestamp())
  on conflict(store_id) do update set requested_plan_code='pro',
    status='pending_approval',version=public.store_service_subscriptions.version+1,
    updated_at=clock_timestamp()
  returning * into v_row;
  return jsonb_build_object('storeId',v_row.store_id,'requestedPlanCode',v_row.requested_plan_code,
    'status',v_row.status,'version',v_row.version);
end; $$;
revoke all on function public.request_store_service_plan(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.request_store_service_plan(uuid,text) to authenticated;

create or replace function public.approve_owner_store_service_plan(
  p_store_id uuid,p_plan_code text,p_start_at timestamptz,p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.store_service_subscriptions%rowtype; v_before public.store_service_subscriptions%rowtype; v_fee bigint;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if p_plan_code not in ('standard','pro') or p_start_at is null
  then raise exception using errcode='22023',message='센터 등급과 적용일을 확인해 주세요.'; end if;
  v_fee:=case p_plan_code when 'pro' then 50000 else 30000 end;
  select * into v_before from public.store_service_subscriptions where store_id=p_store_id for update;
  if not found or v_before.version is distinct from p_expected_version
  then raise exception using errcode='40001',message='센터 등급 상태가 변경되었습니다.'; end if;
  update public.store_service_subscriptions set plan_code=p_plan_code,requested_plan_code=null,
    status='active',monthly_fee=v_fee,billing_anchor_day=extract(day from p_start_at at time zone 'Asia/Seoul')::integer,
    started_at=p_start_at,next_billing_at=p_start_at+interval '1 month',grace_until=null,
    approved_by=auth.uid(),automation_enabled=case when p_plan_code='pro' then automation_enabled else false end,
    automation_client_id=case when p_plan_code='pro' then automation_client_id else null end,
    automation_version=case when p_plan_code='pro' then automation_version else null end,
    automation_linked_at=case when p_plan_code='pro' then automation_linked_at else null end,
    version=version+1,updated_at=clock_timestamp()
  where store_id=p_store_id returning * into v_row;
  insert into public.store_service_subscription_audits(
    store_id,actor_user_id,action,previous_plan_code,requested_plan_code,resulting_plan_code,
    effective_at,next_billing_at,automation_client_id,automation_version
  ) values(p_store_id,auth.uid(),case when v_before.plan_code=p_plan_code then 'approved' else 'changed' end,
    v_before.plan_code,v_before.requested_plan_code,v_row.plan_code,p_start_at,v_row.next_billing_at,
    v_row.automation_client_id,v_row.automation_version);
  insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_key,metadata)
  values(p_store_id,'subscription_fee',-v_fee,p_start_at,'subscription',
    'subscription:'||p_store_id::text||':'||p_start_at::date::text,
    jsonb_build_object('planCode',p_plan_code,'billingPeriodStart',p_start_at,'nextBillingAt',v_row.next_billing_at))
  on conflict(source_key) do nothing;
  return jsonb_build_object('storeId',v_row.store_id,'planCode',v_row.plan_code,'status',v_row.status,
    'nextBillingAt',v_row.next_billing_at,'version',v_row.version);
end; $$;
revoke all on function public.approve_owner_store_service_plan(uuid,text,timestamptz,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.approve_owner_store_service_plan(uuid,text,timestamptz,bigint) to authenticated;

create or replace function public.get_store_daily_entitlements(p_store_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_limits record; v_usage public.store_daily_usage%rowtype; v_pending integer; v_ai record;
begin
  if auth.uid() is null or not (public.is_owner() or public.has_store_permission(p_store_id,'manage_products'))
  then raise exception using errcode='42501',message='센터 사용량 조회 권한이 없습니다.'; end if;
  select * into v_limits from app_private.store_publication_limits(p_store_id);
  select * into v_usage from public.store_daily_usage where store_id=p_store_id
    and usage_date=timezone('Asia/Seoul',statement_timestamp())::date;
  select count(*) into v_pending from public.products where store_id=p_store_id and status='pending';
  select * into v_ai from app_private.store_plan_limits(p_store_id);
  return jsonb_build_object(
    'storeId',p_store_id,'planCode',v_limits.effective_plan,
    'aiDailyLimit',v_ai.ai_daily_limit,'aiUsed',coalesce(v_usage.ai_request_count,0),
    'productDailyLimit',v_limits.pending_inventory_limit,'productsCreated',v_pending,
    'immediateDailyLimit',v_limits.immediate_daily_limit,
    'immediatePublished',coalesce(v_usage.immediate_publish_count,0),
    'scheduledDailyLimit',v_limits.scheduled_daily_limit,
    'scheduledPublished',coalesce(v_usage.scheduled_publish_count,0),
    'pendingInventoryLimit',v_limits.pending_inventory_limit,'pendingInventoryUsed',v_pending,
    'automationRollingLimit',v_limits.automation_rolling_limit,
    'automationRollingUsed',coalesce((select sum(item_count) from public.store_automation_upload_events
      where store_id=p_store_id and created_at>=clock_timestamp()-interval '7 days'),0),
    'bulkImportEnabled',v_limits.effective_plan='pro'
  );
end; $$;
revoke all on function public.get_store_daily_entitlements(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_store_daily_entitlements(uuid) to authenticated;

commit;
