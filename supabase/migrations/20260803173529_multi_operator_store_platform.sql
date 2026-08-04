begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- 다중 운영자 전환의 보안 경계는 store입니다. 공개 스키마의 신규 테이블은
-- 모두 RLS를 강제하고, 실제 변경은 검증된 RPC/트리거를 통해서만 수행합니다.

alter table public.products
  add column if not exists category_id text
    check (category_id is null or category_id ~ '^[0-9]{6,9}$');

create table public.store_service_subscriptions (
  store_id uuid primary key references public.stores(id) on delete restrict,
  plan_code text not null default 'basic'
    check (plan_code in ('basic', 'standard', 'pro')),
  requested_plan_code text
    check (requested_plan_code is null or requested_plan_code in ('standard', 'pro')),
  status text not null default 'active'
    check (status in ('active', 'pending_approval', 'delinquent', 'cancelled')),
  monthly_fee bigint not null default 0
    check (monthly_fee in (0, 30000, 50000)),
  billing_anchor_day integer check (billing_anchor_day between 1 and 31),
  started_at timestamptz,
  next_billing_at timestamptz,
  grace_until timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (plan_code = 'basic' and monthly_fee = 0)
    or (plan_code = 'standard' and monthly_fee = 30000)
    or (plan_code = 'pro' and monthly_fee = 50000)
  )
);

insert into public.store_service_subscriptions(store_id)
select id from public.stores
on conflict (store_id) do nothing;

create table public.store_daily_usage (
  store_id uuid not null references public.stores(id) on delete restrict,
  usage_date date not null,
  ai_request_count integer not null default 0 check (ai_request_count between 0 and 300),
  product_create_count integer not null default 0 check (product_create_count between 0 and 60),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (store_id, usage_date)
);

create index store_daily_usage_date_idx
  on public.store_daily_usage(usage_date, store_id);

create table public.commerce_buyer_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

-- 운영자는 같은 로그인으로 다른 센터 상품을 구매할 수 있습니다. 기존 회원은
-- 기존 구매 계약을 계속 사용하므로 별도 행을 만들 필요가 없습니다.
insert into public.commerce_buyer_accounts(user_id)
select user_id
from public.account_access_roles
where role_code = 'operator'
on conflict (user_id) do nothing;

create table public.store_fulfillment_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  shipping_charge_mode text not null default 'per_store'
    check (shipping_charge_mode in ('per_store', 'per_group')),
  group_shipping_fee_amount bigint
    check (group_shipping_fee_amount between 1 and 1000000),
  representative_store_id uuid references public.stores(id) on delete restrict,
  is_active boolean not null default true,
  version bigint not null default 0 check (version >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (shipping_charge_mode = 'per_store' and group_shipping_fee_amount is null)
    or (shipping_charge_mode = 'per_group' and group_shipping_fee_amount is not null
      and representative_store_id is not null)
  )
);

create table public.store_fulfillment_group_members (
  group_id uuid not null references public.store_fulfillment_groups(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (group_id, store_id),
  unique (store_id)
);

create index store_fulfillment_group_members_business_idx
  on public.store_fulfillment_group_members(business_id, group_id, store_id);

create table public.store_fulfillment_group_audits (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.store_fulfillment_groups(id) on delete restrict,
  origin_store_id uuid references public.stores(id) on delete restrict,
  processing_store_id uuid references public.stores(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);

create table public.store_payout_accounts (
  store_id uuid primary key references public.stores(id) on delete restrict,
  bank_name text not null check (char_length(btrim(bank_name)) between 2 and 80),
  account_holder text not null check (char_length(btrim(account_holder)) between 1 and 80),
  account_number_ciphertext text not null check (char_length(account_number_ciphertext) between 16 and 4096),
  account_number_masked text not null check (char_length(account_number_masked) between 4 and 40),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'approved' and approved_by is not null and approved_at is not null)
    or status <> 'approved')
);

create table public.store_payout_account_access_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 200),
  occurred_at timestamptz not null default clock_timestamp()
);

create table public.store_settlement_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  entry_kind text not null check (entry_kind in (
    'item_sale', 'shipping_fee', 'commission', 'item_refund',
    'shipping_fee_refund', 'subscription_fee', 'adjustment', 'payout'
  )),
  amount bigint not null check (amount <> 0),
  eligible_at timestamptz not null,
  source_kind text not null,
  source_id uuid,
  source_key text not null unique,
  settlement_batch_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

create index store_settlement_entries_open_idx
  on public.store_settlement_entries(store_id, eligible_at, id)
  where settlement_batch_id is null;

create table public.store_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  settlement_date date not null,
  cutoff_at timestamptz not null,
  gross_amount bigint not null,
  commission_amount bigint not null check (commission_amount >= 0),
  subscription_deduction bigint not null default 0 check (subscription_deduction >= 0),
  payout_amount bigint not null check (payout_amount >= 0),
  status text not null default 'draft' check (status in ('draft', 'paid', 'cancelled')),
  payout_account_snapshot jsonb not null check (jsonb_typeof(payout_account_snapshot) = 'object'),
  transfer_reference text,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (store_id, settlement_date),
  check ((status = 'paid' and paid_by is not null and paid_at is not null
      and nullif(btrim(transfer_reference), '') is not null)
    or status <> 'paid')
);

alter table public.store_settlement_entries
  add constraint store_settlement_entries_batch_fkey
  foreign key (settlement_batch_id) references public.store_settlement_batches(id) on delete restrict;

-- 공개 스키마 방어: 직접 CRUD는 모두 차단하고 최소 RPC만 노출합니다.
alter table public.store_service_subscriptions enable row level security;
alter table public.store_service_subscriptions force row level security;
alter table public.store_daily_usage enable row level security;
alter table public.store_daily_usage force row level security;
alter table public.commerce_buyer_accounts enable row level security;
alter table public.commerce_buyer_accounts force row level security;
alter table public.store_fulfillment_groups enable row level security;
alter table public.store_fulfillment_groups force row level security;
alter table public.store_fulfillment_group_members enable row level security;
alter table public.store_fulfillment_group_members force row level security;
alter table public.store_fulfillment_group_audits enable row level security;
alter table public.store_fulfillment_group_audits force row level security;
alter table public.store_payout_accounts enable row level security;
alter table public.store_payout_accounts force row level security;
alter table public.store_payout_account_access_events enable row level security;
alter table public.store_payout_account_access_events force row level security;
alter table public.store_settlement_entries enable row level security;
alter table public.store_settlement_entries force row level security;
alter table public.store_settlement_batches enable row level security;
alter table public.store_settlement_batches force row level security;

revoke all on table
  public.store_service_subscriptions,
  public.store_daily_usage,
  public.commerce_buyer_accounts,
  public.store_fulfillment_groups,
  public.store_fulfillment_group_members,
  public.store_fulfillment_group_audits,
  public.store_payout_accounts,
  public.store_payout_account_access_events,
  public.store_settlement_entries,
  public.store_settlement_batches
from public, anon, authenticated;

create or replace function app_private.store_plan_limits(p_store_id uuid)
returns table(plan_code text, ai_daily_limit integer, product_daily_limit integer, bulk_import_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when subscriptions.status = 'delinquent'
        and subscriptions.grace_until is not null
        and subscriptions.grace_until < clock_timestamp()
      then 'basic'
      else coalesce(subscriptions.plan_code, 'basic')
    end as effective_plan,
    case
      when subscriptions.status = 'delinquent'
        and subscriptions.grace_until is not null
        and subscriptions.grace_until < clock_timestamp() then 10
      when subscriptions.plan_code = 'pro' then 30
      when subscriptions.plan_code = 'standard' then 20
      else 10
    end,
    case
      when subscriptions.status = 'delinquent'
        and subscriptions.grace_until is not null
        and subscriptions.grace_until < clock_timestamp() then 20
      when subscriptions.plan_code = 'pro' then 60
      when subscriptions.plan_code = 'standard' then 40
      else 20
    end,
    subscriptions.plan_code = 'pro'
      and not (subscriptions.status = 'delinquent'
        and subscriptions.grace_until is not null
        and subscriptions.grace_until < clock_timestamp())
  from (select p_store_id as store_id) input
  left join public.store_service_subscriptions subscriptions
    on subscriptions.store_id = input.store_id;
$$;

revoke all on function app_private.store_plan_limits(uuid)
from public, anon, authenticated;

create or replace function public.get_store_daily_entitlements(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan record;
  v_usage public.store_daily_usage%rowtype;
  v_role text := public.access_role_for_user(auth.uid());
begin
  if auth.uid() is null or not (
    public.is_owner() or public.has_store_permission(p_store_id, 'manage_products')
  ) then
    raise exception using errcode = '42501', message = '센터 사용량 조회 권한이 없습니다.';
  end if;
  select * into v_plan from app_private.store_plan_limits(p_store_id);
  select * into v_usage from public.store_daily_usage
  where store_id = p_store_id
    and usage_date = timezone('Asia/Seoul', statement_timestamp())::date;
  return jsonb_build_object(
    'storeId', p_store_id,
    'planCode', case when v_role = 'owner' then 'owner' else v_plan.plan_code end,
    'aiDailyLimit', case when v_role = 'owner' then null else v_plan.ai_daily_limit end,
    'aiUsed', coalesce(v_usage.ai_request_count, 0),
    'productDailyLimit', case when v_role = 'owner' then null else v_plan.product_daily_limit end,
    'productsCreated', coalesce(v_usage.product_create_count, 0),
    'bulkImportEnabled', v_role = 'owner' or v_plan.bulk_import_enabled
  );
end;
$$;

revoke all on function public.get_store_daily_entitlements(uuid)
from public, anon;
grant execute on function public.get_store_daily_entitlements(uuid) to authenticated;

create or replace function public.reserve_store_ai_quota(p_store_id uuid)
returns table(allowed boolean, used integer, daily_limit integer, global_used integer, global_limit integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := timezone('Asia/Seoul', statement_timestamp())::date;
  v_role text := public.access_role_for_user(auth.uid());
  v_plan record;
  v_store_used integer;
  v_global_used integer;
begin
  if auth.uid() is null or v_role not in ('owner', 'operator')
    or not (public.is_owner() or public.has_store_permission(p_store_id, 'manage_products'))
  then
    raise exception using errcode = '42501', message = 'AI 자동 보정 권한이 없습니다.';
  end if;

  insert into app_private.gemini_product_enhancement_daily_usage as usage(
    usage_date, request_count, updated_at
  ) values (v_date, 1, statement_timestamp())
  on conflict (usage_date) do update
    set request_count = usage.request_count + 1,
        updated_at = statement_timestamp()
    where usage.request_count < 300
  returning request_count into v_global_used;

  if v_global_used is null then
    select request_count into v_global_used
    from app_private.gemini_product_enhancement_daily_usage
    where usage_date = v_date;
    return query select false, 0, case when v_role = 'owner' then null::integer else 0 end,
      coalesce(v_global_used, 300), 300;
    return;
  end if;

  if v_role = 'owner' then
    return query select true, v_global_used, null::integer, v_global_used, 300;
    return;
  end if;

  select * into v_plan from app_private.store_plan_limits(p_store_id);
  insert into public.store_daily_usage as usage(
    store_id, usage_date, ai_request_count, updated_at
  ) values (p_store_id, v_date, 1, statement_timestamp())
  on conflict (store_id, usage_date) do update
    set ai_request_count = usage.ai_request_count + 1,
        updated_at = statement_timestamp()
    where usage.ai_request_count < v_plan.ai_daily_limit
  returning ai_request_count into v_store_used;

  if v_store_used is null then
    -- 센터 한도를 넘은 요청은 Gemini를 호출하지 않으므로 전역 예약을 반환합니다.
    update app_private.gemini_product_enhancement_daily_usage
    set request_count = request_count - 1, updated_at = statement_timestamp()
    where usage_date = v_date and request_count > 0;
    select ai_request_count into v_store_used from public.store_daily_usage
    where store_id = p_store_id and usage_date = v_date;
    return query select false, coalesce(v_store_used, v_plan.ai_daily_limit),
      v_plan.ai_daily_limit, v_global_used - 1, 300;
    return;
  end if;

  return query select true, v_store_used, v_plan.ai_daily_limit, v_global_used, 300;
end;
$$;

revoke all on function public.reserve_store_ai_quota(uuid) from public, anon;
grant execute on function public.reserve_store_ai_quota(uuid) to authenticated;

create or replace function app_private.enforce_store_product_daily_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.access_role_for_user(auth.uid());
  v_plan record;
  v_used integer;
  v_date date := timezone('Asia/Seoul', statement_timestamp())::date;
begin
  if auth.uid() is null or v_role = 'owner' then return new; end if;
  if v_role <> 'operator'
    or new.store_id is null
    or not public.has_store_permission(new.store_id, 'manage_products')
  then
    raise exception using errcode = '42501', message = '센터 상품 등록 권한이 없습니다.';
  end if;
  select * into v_plan from app_private.store_plan_limits(new.store_id);
  insert into public.store_daily_usage as usage(
    store_id, usage_date, product_create_count, updated_at
  ) values (new.store_id, v_date, 1, statement_timestamp())
  on conflict (store_id, usage_date) do update
    set product_create_count = usage.product_create_count + 1,
        updated_at = statement_timestamp()
    where usage.product_create_count < v_plan.product_daily_limit
  returning product_create_count into v_used;
  if v_used is null then
    raise exception using errcode = 'P0001',
      message = format('오늘 이 센터의 상품 등록 한도 %s건을 모두 사용했습니다.', v_plan.product_daily_limit);
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_store_product_daily_quota()
from public, anon, authenticated;
drop trigger if exists products_enforce_store_daily_quota on public.products;
create trigger products_enforce_store_daily_quota
before insert on public.products
for each row execute function app_private.enforce_store_product_daily_quota();

create or replace function public.can_purchase_product(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and (
      public.access_role_for_user(auth.uid()) in ('member', 'band_member')
      or exists (
        select 1 from public.commerce_buyer_accounts buyers
        where buyers.user_id = auth.uid() and buyers.status = 'active'
      )
    )
    and not exists (
      select 1
      from public.products products
      join public.stores stores on stores.id = products.store_id
      where products.id = p_product_id
        and stores.operator_id = auth.uid()
    ), false
  );
$$;

revoke all on function public.can_purchase_product(uuid) from public, anon;
grant execute on function public.can_purchase_product(uuid) to authenticated;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce(
    (
      public.current_access_role() in ('band_member','member')
      or exists(select 1 from public.commerce_buyer_accounts buyers
        where buyers.user_id=auth.uid() and buyers.status='active')
    )
    and exists(select 1 from public.member_accounts accounts
      where accounts.member_id=auth.uid()
        and public.effective_member_account_status(accounts.member_id)='active')
    and public.has_required_kakao_profile(), false
  );
$$;
revoke all on function public.is_member() from public,anon;
grant execute on function public.is_member() to authenticated;

-- 기존 고정가 주문 구현은 access role이 member인지 직접 검사했습니다.
-- 역할과 구매 자격을 분리하고, 잠근 각 상품에 자기 센터 차단을 다시 적용합니다.
create or replace function app_private.create_commerce_order(
  p_product_ids uuid[],
  p_idempotency_key text,
  p_apply_shipping_credit boolean default false
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid(); v_order_id uuid; v_product public.products%rowtype;
  v_settings public.payment_runtime_settings%rowtype; v_requested_ids uuid[];
  v_existing_ids uuid[]; v_requested_count integer; v_existing_count integer;
  v_locked_count integer:=0; v_subtotal bigint:=0; v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode='42501',message='로그인이 필요합니다.'; end if;
  if coalesce(array_length(p_product_ids,1),0)=0 or array_length(p_product_ids,1)>50
  then raise exception using errcode='22023',message='상품 목록이 올바르지 않습니다.'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or char_length(p_idempotency_key)>128
  then raise exception using errcode='22023',message='주문 요청 키가 올바르지 않습니다.'; end if;
  if not public.is_member() then
    raise exception using errcode='42501',message='주문할 수 있는 카카오 구매 계정이 아닙니다.';
  end if;
  select * into v_settings from public.payment_runtime_settings where singleton for update;
  if not found or v_settings.active_mode<>'manual_transfer'
  then raise exception using errcode='PT409',message='수동 계좌이체 모드에서만 이 주문 경로를 사용할 수 있습니다.'; end if;
  if v_settings.bank_name is null or v_settings.account_number is null
  then raise exception using errcode='P0001',message='소유자가 입금 계좌를 설정한 후 주문할 수 있습니다.'; end if;
  select array_agg(ids.id order by ids.id),count(*) into v_requested_ids,v_requested_count
  from (select distinct unnest(p_product_ids) id) ids;
  if v_requested_count<>array_length(p_product_ids,1) or array_position(v_requested_ids,null) is not null
  then raise exception using errcode='22023',message='상품 목록에 중복 또는 빈 값이 있습니다.'; end if;
  select orders.id,jsonb_build_object('id',orders.id,'status',orders.status,'subtotal',orders.subtotal,
    'shipping_fee',orders.shipping_fee,'total',orders.total,'shipping_credit_applied',orders.shipping_credit_applied)
  into v_order_id,v_result from public.commerce_orders orders
  where orders.member_id=v_user_id and orders.idempotency_key=btrim(p_idempotency_key) for update;
  if v_result is not null then
    select array_agg(items.product_id order by items.product_id),count(*) into v_existing_ids,v_existing_count
    from public.commerce_order_items items where items.order_id=v_order_id;
    if v_existing_count<>v_requested_count or v_existing_ids is distinct from v_requested_ids
    then raise exception using errcode='22000',message='같은 주문 요청 키에 다른 상품 목록을 사용할 수 없습니다.'; end if;
    return v_result;
  end if;
  for v_product in select products.* from public.products products
    where products.id=any(v_requested_ids) order by products.id for update
  loop
    v_locked_count:=v_locked_count+1;
    if v_product.sale_type<>'fixed' or v_product.fixed_price is null or v_product.status<>'active'
      or v_product.publish_at>clock_timestamp() or not public.can_purchase_product(v_product.id)
    then raise exception using errcode='42501',message='구매할 수 없는 센터 상품이 포함되어 있습니다.'; end if;
    v_subtotal:=v_subtotal+v_product.fixed_price;
  end loop;
  if v_locked_count<>v_requested_count
  then raise exception using errcode='P0002',message='상품을 찾을 수 없습니다.'; end if;
  insert into public.commerce_orders(member_id,status,subtotal,shipping_fee,total,shipping_credit_applied,idempotency_key)
  values(v_user_id,'awaiting_payment',v_subtotal,0,v_subtotal,false,btrim(p_idempotency_key)) returning id into v_order_id;
  insert into public.commerce_order_items(order_id,product_id,store_id,unit_price,payment_status)
  select v_order_id,products.id,products.store_id,products.fixed_price,'awaiting_payment'
  from public.products products where products.id=any(v_requested_ids);
  update public.products set status='closed',updated_at=clock_timestamp() where id=any(v_requested_ids);
  delete from public.cart_items where member_id=v_user_id and product_id=any(v_requested_ids);
  return jsonb_build_object('id',v_order_id,'status','awaiting_payment','subtotal',v_subtotal,
    'shipping_fee',0,'total',v_subtotal,'shipping_credit_applied',false);
end;
$$;
revoke all on function app_private.create_commerce_order(uuid[],text,boolean)
from public,anon,authenticated,service_role;

create or replace function app_private.reject_own_store_bid()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists(
    select 1 from public.products products
    join public.stores stores on stores.id=products.store_id
    where products.id=new.product_id and stores.operator_id=new.bidder_id
  ) then raise exception using errcode='42501',message='본인이 운영하는 센터의 상품에는 입찰할 수 없습니다.'; end if;
  return new;
end; $$;
revoke all on function app_private.reject_own_store_bid() from public,anon,authenticated;
drop trigger if exists auction_bids_reject_own_store on public.auction_bids;
create trigger auction_bids_reject_own_store before insert on public.auction_bids
for each row execute function app_private.reject_own_store_bid();

create or replace function app_private.reject_own_store_purchase()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_buyer uuid; v_store uuid;
begin
  if tg_table_name='cart_items' then v_buyer:=new.member_id;
  else select member_id into v_buyer from public.commerce_orders where id=new.order_id; end if;
  select store_id into v_store from public.products where id=new.product_id;
  if exists(select 1 from public.stores where id=v_store and operator_id=v_buyer)
  then raise exception using errcode='42501',message='본인이 운영하는 센터의 상품은 구매할 수 없습니다.'; end if;
  return new;
end; $$;
revoke all on function app_private.reject_own_store_purchase() from public,anon,authenticated;
drop trigger if exists cart_items_reject_own_store on public.cart_items;
create trigger cart_items_reject_own_store before insert on public.cart_items
for each row execute function app_private.reject_own_store_purchase();
drop trigger if exists commerce_order_items_reject_own_store on public.commerce_order_items;
create trigger commerce_order_items_reject_own_store before insert on public.commerce_order_items
for each row execute function app_private.reject_own_store_purchase();

create or replace function app_private.can_process_group_store(p_store_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.store_fulfillment_group_members target
    join public.store_fulfillment_groups groups
      on groups.id = target.group_id and groups.is_active
    join public.store_fulfillment_group_members actor_store
      on actor_store.group_id = target.group_id
    join public.store_memberships memberships
      on memberships.store_id = actor_store.store_id
      and memberships.user_id = p_user_id
      and memberships.status = 'active'
      and (memberships.prepare_orders or memberships.create_shipments)
    where target.store_id = p_store_id
  ), false);
$$;

revoke all on function app_private.can_process_group_store(uuid, uuid)
from public, anon, authenticated;

-- 기존 상품/회원/매출 권한은 그대로 유지하고 출고 관련 권한만 그룹으로 확장합니다.
create or replace function public.has_store_permission(p_store_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(exists(
    select 1 from public.stores s join public.businesses b on b.id=s.business_id and b.status='active'
    where s.id=p_store_id and s.is_active and (
      public.is_owner()
      or exists(select 1 from public.store_memberships m where m.store_id=s.id and m.business_id=s.business_id and m.user_id=auth.uid() and m.status='active' and
        case lower(btrim(coalesce(p_permission,'')))
          when 'manage_products' then m.manage_products when 'publish_products' then m.publish_products
          when 'prepare_orders' then m.prepare_orders when 'confirm_payments' then false
          when 'receive_at_center' then m.receive_at_center when 'create_shipments' then m.create_shipments
          when 'manage_staff' then m.manage_staff when 'view_reports' then m.view_reports else false end)
      or (
        lower(btrim(coalesce(p_permission,''))) in ('prepare_orders','receive_at_center','create_shipments')
        and app_private.can_process_group_store(s.id, auth.uid())
      )
    )
  ),false);
$$;

revoke all on function public.has_store_permission(uuid,text) from public,anon;
grant execute on function public.has_store_permission(uuid,text) to authenticated;

-- 수동 입금 확정은 소유자만 수행합니다.
create or replace function app_private.can_confirm_shared_payment(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_business_id is not null and public.is_owner(), false);
$$;

revoke all on function app_private.can_confirm_shared_payment(uuid)
from public, anon, authenticated, service_role;

-- 주문 배송비를 사업체 1건에서 센터/출고그룹 스냅샷으로 확장합니다.
alter table public.commerce_order_shipping_fee_allocations
  drop constraint commerce_order_shipping_fee_allocations_pkey;
alter table public.commerce_order_shipping_fee_allocations
  add column id uuid not null default gen_random_uuid(),
  add column charge_key text,
  add column charge_mode text check (charge_mode is null or charge_mode in ('per_store','per_group')),
  add column origin_store_id uuid references public.stores(id) on delete restrict,
  add column fulfillment_group_id uuid references public.store_fulfillment_groups(id) on delete restrict,
  add column billing_store_id uuid references public.stores(id) on delete restrict,
  add column policy_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(policy_snapshot)='object');
alter table public.commerce_order_shipping_fee_allocations
  add primary key (id);

update public.commerce_order_shipping_fee_allocations allocations
set charge_key = 'legacy-business:' || allocations.business_id::text,
    charge_mode = 'per_store',
    origin_store_id = stores.id,
    billing_store_id = stores.id,
    policy_snapshot = jsonb_build_object('legacyBusinessAllocation', true)
from (
  select legacy.id as allocation_id, min(items.store_id::text)::uuid as id
  from public.commerce_order_shipping_fee_allocations legacy
  join public.commerce_order_items items on items.order_id=legacy.order_id
  join public.stores candidate
    on candidate.id=items.store_id
   and candidate.business_id=legacy.business_id
  group by legacy.id
) stores
where allocations.id=stores.allocation_id
  and allocations.charge_key is null;

alter table public.commerce_order_shipping_fee_allocations
  alter column charge_key set not null,
  alter column charge_mode set not null,
  alter column billing_store_id set not null;
create unique index commerce_order_shipping_fee_charge_key_idx
  on public.commerce_order_shipping_fee_allocations(order_id, charge_key);
create index commerce_order_shipping_fee_billing_store_idx
  on public.commerce_order_shipping_fee_allocations(billing_store_id, order_id);

create or replace function app_private.apply_commerce_checkout_shipping_fee(
  p_order_id uuid,
  p_include_shipping_fee boolean,
  p_allow_zero_fee_upgrade boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_shipping_fee bigint;
  v_allocated_fee bigint;
  v_groups jsonb;
  v_missing_shipping_setting boolean;
begin
  select * into v_order from public.commerce_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='배송비를 적용할 주문을 찾지 못했습니다.'; end if;

  with store_scopes as (
    select distinct stores.id store_id, stores.name store_name, stores.business_id,
      groups.id group_id, groups.name group_name, groups.shipping_charge_mode,
      groups.group_shipping_fee_amount, groups.representative_store_id,
      settings.shipping_fee_amount
    from public.commerce_order_items items
    join public.stores stores on stores.id=items.store_id
    left join public.store_fulfillment_group_members members on members.store_id=stores.id
    left join public.store_fulfillment_groups groups on groups.id=members.group_id and groups.is_active
    left join public.inventory_fulfillment_rollout_settings settings on settings.business_id=stores.business_id
    where items.order_id=p_order_id
  ), charges as (
    select
      case when shipping_charge_mode='per_group' then 'group:'||group_id::text else 'store:'||store_id::text end charge_key,
      min(business_id::text)::uuid business_id,
      case when shipping_charge_mode='per_group' then 'per_group' else 'per_store' end charge_mode,
      case when shipping_charge_mode='per_group' then null else min(store_id::text)::uuid end origin_store_id,
      case when shipping_charge_mode='per_group' then group_id else null end fulfillment_group_id,
      case when shipping_charge_mode='per_group' then representative_store_id else min(store_id::text)::uuid end billing_store_id,
      case when shipping_charge_mode='per_group' then max(group_shipping_fee_amount) else max(shipping_fee_amount) end amount,
      jsonb_build_object(
        'mode', case when shipping_charge_mode='per_group' then 'per_group' else 'per_store' end,
        'groupId', case when shipping_charge_mode='per_group' then group_id else null end,
        'groupName', case when shipping_charge_mode='per_group' then max(group_name) else null end,
        'storeIds', jsonb_agg(store_id order by store_id),
        'storeNames', jsonb_agg(store_name order by store_id)
      ) snapshot
    from store_scopes
    group by case when shipping_charge_mode='per_group' then 'group:'||group_id::text else 'store:'||store_id::text end,
      case when shipping_charge_mode='per_group' then 'per_group' else 'per_store' end,
      case when shipping_charge_mode='per_group' then group_id else null end,
      case when shipping_charge_mode='per_group' then representative_store_id else store_id end,
      group_id, representative_store_id, shipping_charge_mode
  )
  select coalesce(sum(amount),0), coalesce(jsonb_agg(snapshot || jsonb_build_object(
    'chargeKey',charge_key,'billingStoreId',billing_store_id,'amount',amount
  ) order by charge_key),'[]'::jsonb),coalesce(bool_or(amount is null),true)
  into v_shipping_fee,v_groups,v_missing_shipping_setting from charges;

  if p_include_shipping_fee then
    if v_missing_shipping_setting or v_shipping_fee < 1 then raise exception using errcode='55000',message='센터·출고 그룹 배송비 설정을 확인해 주세요.'; end if;
    if v_order.shipping_fee=0 then
      if not p_allow_zero_fee_upgrade then raise exception using errcode='22000',message='같은 주문 요청 키의 배송비 선택이 다릅니다.'; end if;
      with store_scopes as (
        select distinct stores.id store_id, stores.name store_name, stores.business_id,
          groups.id group_id, groups.name group_name, groups.shipping_charge_mode,
          groups.group_shipping_fee_amount, groups.representative_store_id,
          settings.shipping_fee_amount
        from public.commerce_order_items items join public.stores stores on stores.id=items.store_id
        left join public.store_fulfillment_group_members members on members.store_id=stores.id
        left join public.store_fulfillment_groups groups on groups.id=members.group_id and groups.is_active
        left join public.inventory_fulfillment_rollout_settings settings on settings.business_id=stores.business_id
        where items.order_id=p_order_id
      ), charges as (
        select
          case when shipping_charge_mode='per_group' then 'group:'||group_id::text else 'store:'||store_id::text end charge_key,
          min(business_id::text)::uuid business_id,
          case when shipping_charge_mode='per_group' then 'per_group' else 'per_store' end charge_mode,
          case when shipping_charge_mode='per_group' then null else min(store_id::text)::uuid end origin_store_id,
          case when shipping_charge_mode='per_group' then group_id else null end fulfillment_group_id,
          case when shipping_charge_mode='per_group' then representative_store_id else min(store_id::text)::uuid end billing_store_id,
          case when shipping_charge_mode='per_group' then max(group_shipping_fee_amount) else max(shipping_fee_amount) end amount,
          jsonb_build_object('mode',case when shipping_charge_mode='per_group' then 'per_group' else 'per_store' end,
            'groupId',case when shipping_charge_mode='per_group' then group_id else null end,
            'storeIds',jsonb_agg(store_id order by store_id),'storeNames',jsonb_agg(store_name order by store_id)) snapshot
        from store_scopes
        group by case when shipping_charge_mode='per_group' then 'group:'||group_id::text else 'store:'||store_id::text end,
          case when shipping_charge_mode='per_group' then 'per_group' else 'per_store' end,
          case when shipping_charge_mode='per_group' then group_id else null end,
          case when shipping_charge_mode='per_group' then representative_store_id else store_id end,
          group_id,representative_store_id,shipping_charge_mode
      )
      insert into public.commerce_order_shipping_fee_allocations(
        order_id,business_id,amount,charge_key,charge_mode,origin_store_id,
        fulfillment_group_id,billing_store_id,policy_snapshot
      ) select p_order_id,business_id,amount,charge_key,charge_mode,origin_store_id,
        fulfillment_group_id,billing_store_id,snapshot from charges;
      update public.commerce_orders set shipping_fee=v_shipping_fee,total=subtotal+v_shipping_fee,
        updated_at=clock_timestamp() where id=p_order_id returning * into v_order;
    else
      select coalesce(sum(amount),0) into v_allocated_fee
      from public.commerce_order_shipping_fee_allocations where order_id=p_order_id;
      if v_allocated_fee<>v_order.shipping_fee then raise exception using errcode='22000',message='저장된 배송비 스냅샷을 검증할 수 없습니다.'; end if;
    end if;
  elsif v_order.shipping_fee<>0 or exists(select 1 from public.commerce_order_shipping_fee_allocations where order_id=p_order_id) then
    raise exception using errcode='22000',message='같은 주문 요청 키의 배송비 선택이 다릅니다.';
  end if;
  return jsonb_build_object('id',v_order.id,'status',v_order.status,'subtotal',v_order.subtotal,
    'shipping_fee',v_order.shipping_fee,'total',v_order.total,
    'shipping_credit_applied',v_order.shipping_credit_applied,'storeGroups',v_groups);
end;
$$;

revoke all on function app_private.apply_commerce_checkout_shipping_fee(uuid,boolean,boolean)
from public,anon,authenticated,service_role;

-- 장바구니 화면도 주문 생성과 완전히 같은 출고 그룹 규칙으로 견적을 냅니다.
create or replace function public.quote_commerce_shipping_fee(p_product_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_requested_count integer;
  v_valid_count integer;
  v_total bigint;
  v_charges jsonb;
  v_missing_shipping_setting boolean;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='로그인이 필요합니다.';
  end if;
  v_requested_count:=coalesce(array_length(p_product_ids,1),0);
  if v_requested_count=0 or v_requested_count>50 then
    raise exception using errcode='22023',message='배송비 견적 상품을 확인해 주세요.';
  end if;
  select count(distinct products.id)::integer into v_valid_count
  from public.products
  where products.id=any(p_product_ids)
    and products.sale_type='fixed'
    and products.status='active'
    and products.publish_at<=clock_timestamp()
    and public.can_purchase_product(products.id);
  if v_valid_count<>v_requested_count then
    raise exception using errcode='42501',message='구매할 수 없는 센터 상품이 포함되어 있습니다.';
  end if;

  with store_scopes as (
    select distinct stores.id store_id,stores.name store_name,stores.business_id,
      groups.id group_id,groups.name group_name,groups.shipping_charge_mode,
      groups.group_shipping_fee_amount,groups.representative_store_id,
      settings.shipping_fee_amount
    from public.products
    join public.stores on stores.id=products.store_id
    left join public.store_fulfillment_group_members members on members.store_id=stores.id
    left join public.store_fulfillment_groups groups on groups.id=members.group_id and groups.is_active
    left join public.inventory_fulfillment_rollout_settings settings on settings.business_id=stores.business_id
    where products.id=any(p_product_ids)
  ), charges as (
    select
      case when shipping_charge_mode='per_group' then 'group:'||group_id::text else 'store:'||store_id::text end charge_key,
      case when shipping_charge_mode='per_group' then 'per_group' else 'per_store' end charge_mode,
      case when shipping_charge_mode='per_group' then group_id else null end group_id,
      case when shipping_charge_mode='per_group' then max(group_name) else null end group_name,
      case when shipping_charge_mode='per_group' then representative_store_id else min(store_id::text)::uuid end billing_store_id,
      case when shipping_charge_mode='per_group' then max(group_shipping_fee_amount) else max(shipping_fee_amount) end amount,
      jsonb_agg(store_id order by store_id) store_ids,
      jsonb_agg(store_name order by store_id) store_names
    from store_scopes
    group by case when shipping_charge_mode='per_group' then 'group:'||group_id::text else 'store:'||store_id::text end,
      case when shipping_charge_mode='per_group' then 'per_group' else 'per_store' end,
      case when shipping_charge_mode='per_group' then group_id else null end,
      case when shipping_charge_mode='per_group' then representative_store_id else store_id end,
      group_id,representative_store_id,shipping_charge_mode
  )
  select coalesce(sum(amount),0),coalesce(jsonb_agg(jsonb_build_object(
    'chargeKey',charge_key,'mode',charge_mode,'groupId',group_id,'groupName',group_name,
    'billingStoreId',billing_store_id,'amount',amount,'storeIds',store_ids,'storeNames',store_names
  ) order by charge_key),'[]'::jsonb),coalesce(bool_or(amount is null),true)
  into v_total,v_charges,v_missing_shipping_setting from charges;
  if v_missing_shipping_setting or v_total<1 then
    raise exception using errcode='55000',message='센터·출고 그룹 배송비 설정을 확인해 주세요.';
  end if;
  return jsonb_build_object('shippingFee',v_total,'chargeCount',jsonb_array_length(v_charges),'charges',v_charges);
end;
$$;
revoke all on function public.quote_commerce_shipping_fee(uuid[]) from public,anon;
grant execute on function public.quote_commerce_shipping_fee(uuid[]) to authenticated;

create or replace function public.request_store_service_plan(p_store_id uuid,p_plan_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row public.store_service_subscriptions%rowtype;
begin
  if p_plan_code not in ('standard','pro') or not public.has_store_permission(p_store_id,'manage_products')
  then raise exception using errcode='42501',message='센터 등급 신청 권한이 없습니다.'; end if;
  insert into public.store_service_subscriptions(store_id,requested_plan_code,status,updated_at)
  values(p_store_id,p_plan_code,'pending_approval',clock_timestamp())
  on conflict(store_id) do update set requested_plan_code=excluded.requested_plan_code,
    status='pending_approval',version=public.store_service_subscriptions.version+1,
    updated_at=clock_timestamp()
  returning * into v_row;
  return jsonb_build_object('storeId',v_row.store_id,'requestedPlanCode',v_row.requested_plan_code,'status',v_row.status,'version',v_row.version);
end; $$;
revoke all on function public.request_store_service_plan(uuid,text) from public,anon;
grant execute on function public.request_store_service_plan(uuid,text) to authenticated;

create or replace function public.approve_owner_store_service_plan(
  p_store_id uuid,p_plan_code text,p_start_at timestamptz,p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row public.store_service_subscriptions%rowtype; v_fee bigint;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if p_plan_code not in ('basic','standard','pro') or p_start_at is null
  then raise exception using errcode='22023',message='센터 등급과 시작일을 확인해 주세요.'; end if;
  v_fee:=case p_plan_code when 'standard' then 30000 when 'pro' then 50000 else 0 end;
  select * into v_row from public.store_service_subscriptions where store_id=p_store_id for update;
  if not found or v_row.version is distinct from p_expected_version
  then raise exception using errcode='40001',message='센터 등급 상태가 변경되었습니다.'; end if;
  update public.store_service_subscriptions set plan_code=p_plan_code,requested_plan_code=null,
    status='active',monthly_fee=v_fee,billing_anchor_day=extract(day from p_start_at at time zone 'Asia/Seoul')::integer,
    started_at=p_start_at,next_billing_at=case when v_fee>0 then p_start_at+interval '1 month' else null end,
    grace_until=null,approved_by=auth.uid(),version=version+1,updated_at=clock_timestamp()
  where store_id=p_store_id returning * into v_row;
  if v_fee>0 then
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_key,metadata)
    values(p_store_id,'subscription_fee',-v_fee,p_start_at,'subscription',
      'subscription:'||p_store_id::text||':'||p_start_at::date::text,
      jsonb_build_object('planCode',p_plan_code,'billingPeriodStart',p_start_at))
    on conflict(source_key) do nothing;
  end if;
  return jsonb_build_object('storeId',v_row.store_id,'planCode',v_row.plan_code,'status',v_row.status,'version',v_row.version);
end; $$;
revoke all on function public.approve_owner_store_service_plan(uuid,text,timestamptz,bigint) from public,anon;
grant execute on function public.approve_owner_store_service_plan(uuid,text,timestamptz,bigint) to authenticated;

create or replace function public.submit_store_payout_account(
  p_store_id uuid,p_bank_name text,p_account_holder text,
  p_account_number_ciphertext text,p_account_number_masked text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row public.store_payout_accounts%rowtype;
begin
  if not public.has_store_permission(p_store_id,'manage_store')
    or nullif(btrim(p_bank_name),'') is null or nullif(btrim(p_account_holder),'') is null
    or char_length(p_account_number_ciphertext)<16 or char_length(p_account_number_masked)<4
  then raise exception using errcode='42501',message='정산계좌 등록 권한 또는 입력값을 확인해 주세요.'; end if;
  insert into public.store_payout_accounts(store_id,bank_name,account_holder,
    account_number_ciphertext,account_number_masked,status,submitted_by)
  values(p_store_id,btrim(p_bank_name),btrim(p_account_holder),p_account_number_ciphertext,
    p_account_number_masked,'pending',auth.uid())
  on conflict(store_id) do update set bank_name=excluded.bank_name,account_holder=excluded.account_holder,
    account_number_ciphertext=excluded.account_number_ciphertext,account_number_masked=excluded.account_number_masked,
    status='pending',submitted_by=auth.uid(),approved_by=null,approved_at=null,
    version=public.store_payout_accounts.version+1,updated_at=clock_timestamp()
  returning * into v_row;
  return jsonb_build_object('storeId',v_row.store_id,'status',v_row.status,
    'accountNumberMasked',v_row.account_number_masked,'version',v_row.version);
end; $$;
revoke all on function public.submit_store_payout_account(uuid,text,text,text,text) from public,anon;
grant execute on function public.submit_store_payout_account(uuid,text,text,text,text) to authenticated;

create or replace function public.approve_owner_store_payout_account(
  p_store_id uuid,p_approved boolean,p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row public.store_payout_accounts%rowtype;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  update public.store_payout_accounts set status=case when p_approved then 'approved' else 'rejected' end,
    approved_by=case when p_approved then auth.uid() else null end,
    approved_at=case when p_approved then clock_timestamp() else null end,
    version=version+1,updated_at=clock_timestamp()
  where store_id=p_store_id and version=p_expected_version returning * into v_row;
  if not found then raise exception using errcode='40001',message='정산계좌 상태가 변경되었습니다.'; end if;
  return jsonb_build_object('storeId',v_row.store_id,'status',v_row.status,'version',v_row.version);
end; $$;
revoke all on function public.approve_owner_store_payout_account(uuid,boolean,bigint) from public,anon;
grant execute on function public.approve_owner_store_payout_account(uuid,boolean,bigint) to authenticated;

create or replace function public.reveal_owner_store_payout_account(p_store_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row public.store_payout_accounts%rowtype;
begin
  if not public.is_owner() or nullif(btrim(p_reason),'') is null
  then raise exception using errcode='42501',message='소유자 계좌 열람 사유가 필요합니다.'; end if;
  select * into v_row from public.store_payout_accounts where store_id=p_store_id and status='approved';
  if not found then raise exception using errcode='P0002',message='승인된 정산계좌를 찾지 못했습니다.'; end if;
  insert into public.store_payout_account_access_events(store_id,actor_user_id,reason)
  values(p_store_id,auth.uid(),btrim(p_reason));
  return jsonb_build_object('storeId',v_row.store_id,'bankName',v_row.bank_name,
    'accountHolder',v_row.account_holder,'ciphertext',v_row.account_number_ciphertext,
    'accountNumberMasked',v_row.account_number_masked);
end; $$;
revoke all on function public.reveal_owner_store_payout_account(uuid,text) from public,anon;
grant execute on function public.reveal_owner_store_payout_account(uuid,text) to authenticated;

-- 월 이용료를 승인일 기준으로 부과하고 존재하지 않는 날짜는 해당 월 말일로 맞춥니다.
create or replace function public.accrue_store_subscription_fees(p_as_of timestamptz default clock_timestamp())
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_subscription public.store_service_subscriptions%rowtype; v_due timestamptz;
  v_next_month date; v_next_date date; v_count integer:=0;
begin
  if not (public.is_owner() or auth.role()='service_role')
  then raise exception using errcode='42501',message='이용료 부과 권한이 없습니다.'; end if;
  for v_subscription in select * from public.store_service_subscriptions
    where monthly_fee>0 and status in ('active','delinquent') and next_billing_at<=p_as_of for update
  loop
    v_due:=v_subscription.next_billing_at;
    while v_due<=p_as_of loop
      insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_key,metadata)
      values(v_subscription.store_id,'subscription_fee',-v_subscription.monthly_fee,v_due,'subscription',
        'subscription:'||v_subscription.store_id::text||':'||(v_due at time zone 'Asia/Seoul')::date::text,
        jsonb_build_object('planCode',v_subscription.plan_code,'billingPeriodStart',v_due))
      on conflict(source_key) do nothing;
      v_count:=v_count+1;
      v_next_month:=(date_trunc('month',(v_due at time zone 'Asia/Seoul')::date)+interval '1 month')::date;
      v_next_date:=v_next_month+least(v_subscription.billing_anchor_day,
        extract(day from (v_next_month+interval '1 month' - interval '1 day'))::integer)-1;
      v_due:=(v_next_date::text||' 00:00:00 Asia/Seoul')::timestamptz;
    end loop;
    update public.store_service_subscriptions set next_billing_at=v_due,status='delinquent',
      grace_until=coalesce(grace_until,p_as_of+interval '7 days'),version=version+1,updated_at=clock_timestamp()
    where store_id=v_subscription.store_id;
  end loop;
  return jsonb_build_object('accruedCount',v_count,'asOf',p_as_of);
end; $$;
revoke all on function public.accrue_store_subscription_fees(timestamptz) from public,anon,authenticated;
grant execute on function public.accrue_store_subscription_fees(timestamptz) to service_role;

create or replace function app_private.project_shipped_store_settlement()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status='shipped' and old.status is distinct from 'shipped' then
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select items.origin_store_id,'item_sale',inventory.paid_amount,new.shipped_at,'inventory_item',inventory.id,
      'item-sale:'||inventory.id::text,jsonb_build_object('shipmentId',new.id,'productId',inventory.product_id)
    from public.inventory_shipment_items items
    join public.customer_inventory_items inventory on inventory.id=items.inventory_item_id
    where items.shipment_id=new.id and items.line_status in ('packed','shipped','ready')
    on conflict(source_key) do nothing;

    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select items.origin_store_id,'commission',-ceil(inventory.paid_amount*0.05)::bigint,new.shipped_at,'inventory_item',inventory.id,
      'item-commission:'||inventory.id::text,jsonb_build_object('rate',0.05,'rounding','ceil','shipmentId',new.id)
    from public.inventory_shipment_items items
    join public.customer_inventory_items inventory on inventory.id=items.inventory_item_id
    where items.shipment_id=new.id and items.line_status in ('packed','shipped','ready')
    on conflict(source_key) do nothing;

    -- 선결제 배송비는 주문 스냅샷의 대표 정산센터에 한 번만 귀속합니다.
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select allocations.billing_store_id,'shipping_fee',allocations.amount,new.shipped_at,'shipping_allocation',allocations.id,
      'shipping-fee:'||allocations.id::text,allocations.policy_snapshot||jsonb_build_object('shipmentId',new.id)
    from public.inventory_shipment_items shipment_items
    join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
      and (allocations.charge_mode='per_group' or allocations.origin_store_id=shipment_items.origin_store_id)
    where shipment_items.shipment_id=new.id
    on conflict(source_key) do nothing;

    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select allocations.billing_store_id,'commission',-ceil(allocations.amount*0.05)::bigint,new.shipped_at,'shipping_allocation',allocations.id,
      'shipping-commission:'||allocations.id::text,jsonb_build_object('rate',0.05,'rounding','ceil','shipmentId',new.id)
    from public.inventory_shipment_items shipment_items
    join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
      and (allocations.charge_mode='per_group' or allocations.origin_store_id=shipment_items.origin_store_id)
    where shipment_items.shipment_id=new.id
    on conflict(source_key) do nothing;
  end if;
  return new;
end; $$;
revoke all on function app_private.project_shipped_store_settlement() from public,anon,authenticated;
drop trigger if exists inventory_shipments_project_store_settlement on public.inventory_shipments;
create trigger inventory_shipments_project_store_settlement after update of status on public.inventory_shipments
for each row execute function app_private.project_shipped_store_settlement();

-- 환불 원장은 원 판매센터/주문 당시 배송비 귀속센터를 기준으로 반대 분개합니다.
create or replace function app_private.project_store_refund_settlement()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.entry_kind='item_refund' and new.origin_store_id is not null then
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    values(new.origin_store_id,'item_refund',new.amount,new.occurred_at,'store_financial_entry',new.id,
      'item-refund:'||new.id::text,new.metadata) on conflict(source_key) do nothing;
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    values(new.origin_store_id,'commission',ceil(abs(new.amount)*0.05)::bigint,new.occurred_at,'store_financial_entry',new.id,
      'item-refund-commission:'||new.id::text,new.metadata||jsonb_build_object('rate',0.05,'reversal',true))
    on conflict(source_key) do nothing;
  elsif new.entry_kind='shipping_fee_refund' and new.inventory_shipment_id is not null then
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select allocations.billing_store_id,'shipping_fee_refund',-allocations.amount,new.occurred_at,
      'shipping_allocation',allocations.id,'shipping-refund:'||new.id::text||':'||allocations.id::text,
      allocations.policy_snapshot||jsonb_build_object('financialEntryId',new.id)
    from public.inventory_shipment_items shipment_items
    join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
    where shipment_items.shipment_id=new.inventory_shipment_id
    group by allocations.id
    on conflict(source_key) do nothing;
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select allocations.billing_store_id,'commission',ceil(allocations.amount*0.05)::bigint,new.occurred_at,
      'shipping_allocation',allocations.id,'shipping-refund-commission:'||new.id::text||':'||allocations.id::text,
      jsonb_build_object('financialEntryId',new.id,'rate',0.05,'reversal',true)
    from public.inventory_shipment_items shipment_items
    join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
    where shipment_items.shipment_id=new.inventory_shipment_id
    group by allocations.id
    on conflict(source_key) do nothing;
  end if;
  return new;
end; $$;
revoke all on function app_private.project_store_refund_settlement() from public,anon,authenticated;
drop trigger if exists store_financial_entries_project_settlement_refund on public.store_financial_entries;
create trigger store_financial_entries_project_settlement_refund after insert on public.store_financial_entries
for each row execute function app_private.project_store_refund_settlement();

create or replace function app_private.audit_group_fulfillment_proxy()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_origin uuid; v_processing uuid; v_group uuid;
begin
  if new.actor_kind<>'user' or new.actor_user_id is null then return new; end if;
  for v_origin in select distinct origin_store_id from public.inventory_shipment_items where shipment_id=new.shipment_id
  loop
    if exists(select 1 from public.store_memberships where store_id=v_origin and user_id=new.actor_user_id
      and status='active' and (prepare_orders or create_shipments)) then continue; end if;
    select origin_member.group_id,processing_member.store_id into v_group,v_processing
    from public.store_fulfillment_group_members origin_member
    join public.store_fulfillment_group_members processing_member on processing_member.group_id=origin_member.group_id
    join public.store_memberships memberships on memberships.store_id=processing_member.store_id
      and memberships.user_id=new.actor_user_id and memberships.status='active'
      and (memberships.prepare_orders or memberships.create_shipments)
    where origin_member.store_id=v_origin order by processing_member.store_id limit 1;
    if v_processing is not null then
      insert into public.store_fulfillment_group_audits(group_id,origin_store_id,processing_store_id,
        actor_user_id,action,target_id,metadata,occurred_at)
      values(v_group,v_origin,v_processing,new.actor_user_id,new.event_type,new.shipment_id,
        jsonb_build_object('shipmentEventId',new.id,'sequenceNo',new.sequence_no),new.occurred_at);
    end if;
  end loop;
  return new;
end; $$;
revoke all on function app_private.audit_group_fulfillment_proxy() from public,anon,authenticated;
drop trigger if exists inventory_shipment_events_audit_group_proxy on public.inventory_shipment_events;
create trigger inventory_shipment_events_audit_group_proxy after insert on public.inventory_shipment_events
for each row execute function app_private.audit_group_fulfillment_proxy();

create or replace function public.create_owner_settlement_batches(p_settlement_date date)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_cutoff timestamptz; v_created integer:=0;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if extract(isodow from p_settlement_date) not in (1,4)
  then raise exception using errcode='22023',message='정산일은 월요일 또는 목요일이어야 합니다.'; end if;
  v_cutoff:=((p_settlement_date-1)::text||' 23:59:59 Asia/Seoul')::timestamptz;
  with candidates as (
    select entries.store_id,sum(entries.amount)::bigint net,
      sum(case when entries.entry_kind='commission' then -entries.amount else 0 end)::bigint commission,
      sum(case when entries.entry_kind='subscription_fee' then -entries.amount else 0 end)::bigint subscription
    from public.store_settlement_entries entries
    where entries.settlement_batch_id is null and entries.eligible_at<=v_cutoff
    group by entries.store_id having sum(entries.amount)>0
  ), inserted as (
    insert into public.store_settlement_batches(store_id,settlement_date,cutoff_at,gross_amount,
      commission_amount,subscription_deduction,payout_amount,payout_account_snapshot)
    select candidates.store_id,p_settlement_date,v_cutoff,
      candidates.net+candidates.commission+candidates.subscription,candidates.commission,candidates.subscription,
      candidates.net,jsonb_build_object('bankName',accounts.bank_name,'accountHolder',accounts.account_holder,
        'accountNumberMasked',accounts.account_number_masked,'accountVersion',accounts.version)
    from candidates join public.store_payout_accounts accounts on accounts.store_id=candidates.store_id and accounts.status='approved'
    on conflict(store_id,settlement_date) do nothing returning id,store_id
  )
  update public.store_settlement_entries entries set settlement_batch_id=inserted.id
  from inserted where entries.store_id=inserted.store_id and entries.settlement_batch_id is null and entries.eligible_at<=v_cutoff;
  get diagnostics v_created=row_count;
  return jsonb_build_object('settlementDate',p_settlement_date,'cutoffAt',v_cutoff,'assignedEntryCount',v_created);
end; $$;
revoke all on function public.create_owner_settlement_batches(date) from public,anon;
grant execute on function public.create_owner_settlement_batches(date) to authenticated;

create or replace function public.complete_owner_settlement_batch(
  p_batch_id uuid,p_transfer_reference text,p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_batch public.store_settlement_batches%rowtype;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if nullif(btrim(p_transfer_reference),'') is null or char_length(p_transfer_reference)>160
  then raise exception using errcode='22023',message='송금 참조번호를 확인해 주세요.'; end if;
  update public.store_settlement_batches set status='paid',transfer_reference=btrim(p_transfer_reference),
    paid_by=auth.uid(),paid_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
  where id=p_batch_id and status='draft' and version=p_expected_version returning * into v_batch;
  if not found then raise exception using errcode='40001',message='정산 배치 상태가 변경되었습니다.'; end if;
  if not exists(select 1 from public.store_settlement_entries
    where store_id=v_batch.store_id and settlement_batch_id is null and entry_kind='subscription_fee')
  then update public.store_service_subscriptions set status='active',grace_until=null,
    version=version+1,updated_at=clock_timestamp()
    where store_id=v_batch.store_id and status='delinquent';
  end if;
  return jsonb_build_object('id',v_batch.id,'status',v_batch.status,'paidAt',v_batch.paid_at,'version',v_batch.version);
end; $$;
revoke all on function public.complete_owner_settlement_batch(uuid,text,bigint) from public,anon;
grant execute on function public.complete_owner_settlement_batch(uuid,text,bigint) to authenticated;

create or replace function public.get_operator_store_platform_management()
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object('stores',coalesce(jsonb_agg(jsonb_build_object(
    'id',stores.id,'name',stores.name,'planCode',coalesce(subscriptions.plan_code,'basic'),
    'requestedPlanCode',subscriptions.requested_plan_code,'subscriptionStatus',coalesce(subscriptions.status,'active'),
    'monthlyFee',coalesce(subscriptions.monthly_fee,0),'subscriptionVersion',coalesce(subscriptions.version,0),
    'aiUsed',coalesce(usage.ai_request_count,0),'productsCreated',coalesce(usage.product_create_count,0),
    'payoutAccount',case when accounts.store_id is null then null else jsonb_build_object(
      'bankName',accounts.bank_name,'accountHolder',accounts.account_holder,
      'accountNumberMasked',accounts.account_number_masked,'status',accounts.status,'version',accounts.version) end,
    'settlements',coalesce((select jsonb_agg(jsonb_build_object('id',batches.id,'settlementDate',batches.settlement_date,
      'grossAmount',batches.gross_amount,'commissionAmount',batches.commission_amount,
      'subscriptionDeduction',batches.subscription_deduction,'payoutAmount',batches.payout_amount,
      'status',batches.status,'paidAt',batches.paid_at) order by batches.settlement_date desc)
      from public.store_settlement_batches batches where batches.store_id=stores.id),'[]'::jsonb)
  ) order by stores.name),'[]'::jsonb))
  from public.stores stores
  join public.store_memberships memberships on memberships.store_id=stores.id and memberships.user_id=auth.uid()
    and memberships.status='active'
  left join public.store_service_subscriptions subscriptions on subscriptions.store_id=stores.id
  left join public.store_daily_usage usage on usage.store_id=stores.id
    and usage.usage_date=timezone('Asia/Seoul',statement_timestamp())::date
  left join public.store_payout_accounts accounts on accounts.store_id=stores.id
  where public.access_role_for_user(auth.uid()) in ('owner','operator');
$$;
revoke all on function public.get_operator_store_platform_management() from public,anon;
grant execute on function public.get_operator_store_platform_management() to authenticated;

create or replace function public.get_owner_store_platform_management()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_owner() then
    jsonb_build_object('stores','[]'::jsonb,'groups','[]'::jsonb)
  else jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object(
      'id', stores.id, 'name', stores.name, 'operatorId', stores.operator_id,
      'planCode', coalesce(subscriptions.plan_code, 'basic'),
      'subscriptionStatus', coalesce(subscriptions.status, 'active'),
      'subscriptionVersion', coalesce(subscriptions.version, 0),
      'aiUsed', coalesce(usage.ai_request_count, 0),
      'productsCreated', coalesce(usage.product_create_count, 0),
      'payoutAccount', case when accounts.store_id is null then null else jsonb_build_object(
        'bankName',accounts.bank_name,'accountHolder',accounts.account_holder,
        'accountNumberMasked',accounts.account_number_masked,'status',accounts.status,'version',accounts.version) end,
      'settlements', coalesce((select jsonb_agg(jsonb_build_object(
        'id',batches.id,'settlementDate',batches.settlement_date,'payoutAmount',batches.payout_amount,
        'status',batches.status,'version',batches.version) order by batches.settlement_date desc)
        from public.store_settlement_batches batches where batches.store_id=stores.id),'[]'::jsonb)
    ) order by stores.name, stores.id)
    from public.stores stores
    left join public.store_service_subscriptions subscriptions on subscriptions.store_id = stores.id
    left join public.store_daily_usage usage on usage.store_id = stores.id
      and usage.usage_date = timezone('Asia/Seoul', statement_timestamp())::date
    left join public.store_payout_accounts accounts on accounts.store_id=stores.id
    where stores.is_active), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'id', groups.id, 'name', groups.name,
      'shippingChargeMode', groups.shipping_charge_mode,
      'shippingFeeAmount', groups.group_shipping_fee_amount,
      'representativeStoreId', groups.representative_store_id,
      'version', groups.version,
      'storeIds', coalesce((select jsonb_agg(members.store_id order by members.store_id)
        from public.store_fulfillment_group_members members where members.group_id = groups.id), '[]'::jsonb)
    ) order by groups.name, groups.id)
    from public.store_fulfillment_groups groups where groups.is_active), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_owner_store_platform_management() from public,anon;
grant execute on function public.get_owner_store_platform_management() to authenticated;

create or replace function public.manage_owner_fulfillment_group(
  p_group_id uuid,
  p_name text,
  p_store_ids uuid[],
  p_shipping_charge_mode text,
  p_group_shipping_fee_amount bigint,
  p_representative_store_id uuid,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.store_fulfillment_groups%rowtype;
  v_business_id uuid;
begin
  if not public.is_owner() then raise exception using errcode='42501',message='소유자 권한이 필요합니다.'; end if;
  if nullif(btrim(p_name),'') is null or coalesce(cardinality(p_store_ids),0) < 1
    or cardinality(p_store_ids) <> cardinality(array(select distinct x from unnest(p_store_ids) x))
    or p_shipping_charge_mode not in ('per_store','per_group')
    or (p_shipping_charge_mode='per_group' and (p_group_shipping_fee_amount is null
      or p_representative_store_id is null or not p_representative_store_id=any(p_store_ids)))
  then raise exception using errcode='22023',message='출고 그룹 설정을 확인해 주세요.'; end if;
  select min(business_id::text)::uuid into v_business_id from public.stores where id=any(p_store_ids) and is_active;
  if (select count(*) from public.stores where id=any(p_store_ids) and is_active) <> cardinality(p_store_ids)
    or exists(select 1 from public.stores where id=any(p_store_ids) and business_id<>v_business_id)
  then raise exception using errcode='23514',message='같은 사업체의 활성 센터만 묶을 수 있습니다.'; end if;

  if p_group_id is null then
    insert into public.store_fulfillment_groups(
      business_id,name,shipping_charge_mode,group_shipping_fee_amount,
      representative_store_id,created_by,updated_by
    ) values (
      v_business_id,btrim(p_name),p_shipping_charge_mode,
      case when p_shipping_charge_mode='per_group' then p_group_shipping_fee_amount else null end,
      case when p_shipping_charge_mode='per_group' then p_representative_store_id else null end,
      auth.uid(),auth.uid()
    ) returning * into v_group;
  else
    select * into v_group from public.store_fulfillment_groups where id=p_group_id for update;
    if not found then raise exception using errcode='P0002',message='출고 그룹을 찾지 못했습니다.'; end if;
    if v_group.version is distinct from p_expected_version then
      raise exception using errcode='40001',message='출고 그룹 설정이 변경되었습니다.'; end if;
    update public.store_fulfillment_groups set
      name=btrim(p_name), shipping_charge_mode=p_shipping_charge_mode,
      group_shipping_fee_amount=case when p_shipping_charge_mode='per_group' then p_group_shipping_fee_amount else null end,
      representative_store_id=case when p_shipping_charge_mode='per_group' then p_representative_store_id else null end,
      version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where id=p_group_id returning * into v_group;
    delete from public.store_fulfillment_group_members where group_id=v_group.id;
  end if;
  insert into public.store_fulfillment_group_members(group_id,store_id,business_id)
  select v_group.id, ids.id, v_business_id from unnest(p_store_ids) ids(id);
  return jsonb_build_object('id',v_group.id,'version',v_group.version,'storeIds',to_jsonb(p_store_ids));
end;
$$;

revoke all on function public.manage_owner_fulfillment_group(uuid,text,uuid[],text,bigint,uuid,bigint)
from public,anon;
grant execute on function public.manage_owner_fulfillment_group(uuid,text,uuid[],text,bigint,uuid,bigint)
to authenticated;

commit;
