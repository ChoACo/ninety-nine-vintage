-- Extend the existing PortOne V2 ledger to fixed-price, multi-item commerce
-- orders. The provider ledger remains the source of truth for payment state;
-- commerce_orders only receives idempotent fulfilment projections from it.

alter table public.payment_orders
  alter column product_id drop not null,
  add column commerce_order_id uuid;

alter table public.payment_orders
  add constraint payment_orders_commerce_order_id_fkey
    foreign key (commerce_order_id)
    references public.commerce_orders (id)
    on delete restrict,
  add constraint payment_orders_commerce_order_id_key
    unique (commerce_order_id),
  add constraint payment_orders_exactly_one_source_check check (
    (product_id is not null and commerce_order_id is null)
    or (product_id is null and commerce_order_id is not null)
  );

comment on column public.payment_orders.commerce_order_id is
  'Fixed-price multi-item order source. Exactly one of product_id and commerce_order_id is present.';

-- Fixed-price inventory is closed as soon as an order is reserved, so the
-- public active-product policy no longer exposes it. Preserve order-history
-- product details for the member who owns the immutable commerce item.
drop policy if exists "Members read products in their commerce orders"
on public.products;
create policy "Members read products in their commerce orders"
on public.products
for select
to authenticated
using (
  exists (
    select 1
    from public.commerce_order_items as commerce_items
    join public.commerce_orders as commerce_orders
      on commerce_orders.id = commerce_items.order_id
    where commerce_items.product_id = products.id
      and commerce_orders.member_id = (select auth.uid())
  )
);

-- Enforce provider exclusivity at the database boundary. The commerce order
-- row is locked by both prepare paths, while these triggers close any gap left
-- by an older caller that reaches the tables through a SECURITY DEFINER RPC.
create or replace function app_private.reject_portone_manual_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_id is not null
    and exists (
      select 1
      from public.manual_transfer_orders as manual_orders
      where manual_orders.product_id = new.product_id
        and manual_orders.status in ('awaiting_manual_transfer', 'confirmed')
    )
  then
    raise exception using
      errcode = '55000',
      message = '수동 계좌이체가 진행 중이거나 완료된 상품입니다.';
  end if;

  if new.commerce_order_id is not null
    and exists (
      select 1
      from public.commerce_order_transfers as transfers
      where transfers.order_id = new.commerce_order_id
    )
  then
    raise exception using
      errcode = '55000',
      message = '수동 계좌이체가 진행 중이거나 완료된 주문입니다.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.reject_portone_manual_overlap()
from public, anon, authenticated, service_role;

create or replace function app_private.reject_commerce_manual_portone_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.payment_orders as payment_orders
    where payment_orders.commerce_order_id = new.order_id
  )
  then
    raise exception using
      errcode = '55000',
      message = '포트원 결제가 진행 중이거나 완료된 주문입니다.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.reject_commerce_manual_portone_overlap()
from public, anon, authenticated, service_role;

drop trigger if exists commerce_order_transfers_reject_portone_overlap
on public.commerce_order_transfers;
create trigger commerce_order_transfers_reject_portone_overlap
before insert or update of order_id
on public.commerce_order_transfers
for each row execute function app_private.reject_commerce_manual_portone_overlap();

-- A payment confirmation can arrive through the browser sync or a webhook.
-- The unique notification key and coalesced fulfilment timestamps make both
-- delivery paths safe to replay without extending the member's storage term.
create unique index if not exists notifications_commerce_portone_paid_once_idx
  on public.notifications (member_id, href)
  where kind = 'commerce_portone_paid';

create or replace function app_private.fulfil_paid_commerce_portone_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_item_count integer;
  v_item_total bigint;
  v_paid_at timestamptz := coalesce(
    new.paid_at,
    new.portone_status_changed_at,
    clock_timestamp()
  );
begin
  select orders.*
  into v_order
  from public.commerce_orders as orders
  where orders.id = new.commerce_order_id
  for update;

  if not found
    or v_order.member_id is distinct from new.buyer_id
    or v_order.total is distinct from new.expected_amount
  then
    raise exception using
      errcode = '22000',
      message = '결제 원장과 고정가 주문 정보가 일치하지 않습니다.';
  end if;

  select count(*), coalesce(sum(items.unit_price), 0)
  into v_item_count, v_item_total
  from public.commerce_order_items as items
  where items.order_id = v_order.id;

  if v_item_count < 1
    or v_item_total is distinct from v_order.subtotal
    or v_order.total is distinct from v_order.subtotal + v_order.shipping_fee
  then
    raise exception using
      errcode = '22000',
      message = '고정가 주문의 상품 금액을 검증할 수 없습니다.';
  end if;

  update public.commerce_order_items as items
  set
    payment_status = 'paid',
    paid_at = coalesce(items.paid_at, v_paid_at),
    storage_expires_at = coalesce(
      items.storage_expires_at,
      v_paid_at + case
        when products.storage_class = 'large' then interval '7 days'
        else interval '14 days'
      end
    )
  from public.products as products
  where items.order_id = v_order.id
    and products.id = items.product_id;

  update public.commerce_orders as orders
  set
    status = case when orders.status = 'shipped' then 'shipped' else 'paid' end,
    updated_at = clock_timestamp()
  where orders.id = v_order.id;

  insert into public.notifications (
    member_id,
    audience_role,
    kind,
    title,
    body,
    href
  )
  values (
    v_order.member_id,
    'member',
    'commerce_portone_paid',
    '결제가 완료되었습니다.',
    '주문 상품이 보관 목록에 추가되었습니다.',
    '/account?order=' || v_order.id::text || '#storage'
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function app_private.fulfil_paid_commerce_portone_order()
from public, anon, authenticated, service_role;

drop trigger if exists payment_orders_fulfil_paid_commerce_order
on public.payment_orders;
create trigger payment_orders_fulfil_paid_commerce_order
after update of portone_status, payment_id, paid_at
on public.payment_orders
for each row
when (
  new.commerce_order_id is not null
  and new.portone_status = 'PAID'
  and old.portone_status is distinct from 'PAID'
)
execute function app_private.fulfil_paid_commerce_portone_order();

-- Service-only atomic fixed-price checkout. The member, runtime mode, stock,
-- item set, amount, order and PortOne attempt are all verified or created in
-- one database transaction. Client-supplied prices are never accepted.
create or replace function public.prepare_commerce_portone_checkout(
  p_member_id uuid,
  p_product_ids uuid[],
  p_idempotency_key text,
  p_payment_id text,
  p_requested_method text,
  p_store_id text
)
returns table (
  payment_id text,
  commerce_order_id uuid,
  order_name text,
  expected_amount bigint,
  payment_status text,
  portone_status text,
  can_retry_payment boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_store_id text := btrim(coalesce(p_store_id, ''));
  v_requested_ids uuid[];
  v_existing_ids uuid[];
  v_requested_count integer;
  v_distinct_count integer;
  v_locked_count integer := 0;
  v_item_count integer;
  v_subtotal bigint := 0;
  v_first_title text;
  v_order_name text;
  v_requires_verified_profile boolean;
  v_settings public.payment_runtime_settings%rowtype;
  v_product public.products%rowtype;
  v_commerce_order public.commerce_orders%rowtype;
  v_payment_order public.payment_orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_existing_order boolean := false;
  v_payment_order_found boolean := false;
  v_attempt_locked boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = '서버 권한이 필요합니다.';
  end if;
  if p_member_id is null then
    raise exception using errcode = '22023', message = '결제 회원 정보가 필요합니다.';
  end if;
  if p_product_ids is null
    or cardinality(p_product_ids) not between 1 and 50
  then
    raise exception using errcode = '22023', message = '상품 목록이 올바르지 않습니다.';
  end if;
  if char_length(v_idempotency_key) not between 1 and 128 then
    raise exception using errcode = '22023', message = '주문 요청 키가 올바르지 않습니다.';
  end if;
  if char_length(coalesce(p_payment_id, '')) not between 6 and 40
    or p_payment_id !~ '^[A-Za-z0-9]+$'
  then
    raise exception using errcode = '22023', message = '결제 고유번호 형식을 확인해 주세요.';
  end if;
  if p_requested_method not in ('CARD', 'EASY_PAY', 'VIRTUAL_ACCOUNT') then
    raise exception using errcode = '22023', message = '지원하지 않는 결제수단입니다.';
  end if;
  if char_length(v_store_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = '포트원 상점 정보를 확인해 주세요.';
  end if;

  select
    array_agg(selected.product_id order by selected.product_id),
    count(*),
    count(distinct selected.product_id)
  into v_requested_ids, v_requested_count, v_distinct_count
  from unnest(p_product_ids) as selected(product_id);

  if v_distinct_count <> v_requested_count
    or array_position(v_requested_ids, null) is not null
  then
    raise exception using errcode = '22023', message = '상품 목록에 중복 또는 빈 값이 있습니다.';
  end if;

  select coalesce(requirements.enforce_verified_profile, false)
  into v_requires_verified_profile
  from public.kakao_profile_requirements as requirements
  where requirements.singleton;
  v_requires_verified_profile := coalesce(v_requires_verified_profile, false);

  if public.access_role_for_user(p_member_id) not in ('band_member', 'member')
    or not public.auth_user_has_kakao_identity(p_member_id)
    or not exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = p_member_id
        and accounts.account_status = 'active'
    )
    or (
      v_requires_verified_profile
      and not exists (
        select 1
        from public.kakao_member_profiles as kakao_profiles
        where kakao_profiles.member_id = p_member_id
          and kakao_profiles.profile_complete
      )
    )
  then
    raise exception using errcode = '42501', message = '결제할 수 있는 카카오 회원 계정이 아닙니다.';
  end if;

  -- Serialize the same member/key before reading the unique order row. This
  -- makes concurrent HTTP retries observe the order produced by the winner.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_member_id::text || ':' || v_idempotency_key, 0)
  );

  -- Keep the settings row locked until the payment attempt is durable. A mode
  -- switch waits, then the mode guard observes this attempt and rejects it.
  select settings.*
  into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for update;

  -- PT409 is reserved for this pre-ledger mode race so the HTTP layer can
  -- require a fresh shopper confirmation without conflating other conflicts.
  if not found or v_settings.active_mode <> 'portone' then
    raise exception using errcode = 'PT409', message = '현재 포트원 결제를 이용할 수 없습니다.';
  end if;

  select orders.*
  into v_commerce_order
  from public.commerce_orders as orders
  where orders.member_id = p_member_id
    and orders.idempotency_key = v_idempotency_key;

  v_existing_order := found;

  if v_existing_order then
    -- Match sync_portone_payment's attempt -> payment order -> commerce order
    -- lock order. The first reads are only identifiers; the rows are refreshed
    -- after their locks are acquired. Commerce payment_id is immutable.
    select payment_orders.*
    into v_payment_order
    from public.payment_orders as payment_orders
    where payment_orders.commerce_order_id = v_commerce_order.id;

    if found then
      select attempts.*
      into v_attempt
      from public.payment_attempts as attempts
      where attempts.payment_id = v_payment_order.payment_id
        and attempts.order_id = v_payment_order.id
      for update;

      if not found then
        raise exception using errcode = '22000', message = '현재 결제 시도 원장을 찾을 수 없습니다.';
      end if;
      v_attempt_locked := true;

      select payment_orders.*
      into v_payment_order
      from public.payment_orders as payment_orders
      where payment_orders.id = v_attempt.order_id
      for update;

      if not found
        or v_payment_order.commerce_order_id is distinct from v_commerce_order.id
        or v_payment_order.payment_id is distinct from v_attempt.payment_id
      then
        raise exception using errcode = '22000', message = '현재 결제 주문 원장을 잠글 수 없습니다.';
      end if;
      v_payment_order_found := true;
    end if;

    select orders.*
    into v_commerce_order
    from public.commerce_orders as orders
    where orders.id = v_commerce_order.id
      and orders.member_id = p_member_id
      and orders.idempotency_key = v_idempotency_key
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = '기존 주문을 다시 확인할 수 없습니다.';
    end if;
  end if;

  if v_existing_order then
    select
      array_agg(items.product_id order by items.product_id),
      count(*),
      coalesce(sum(items.unit_price), 0)
    into v_existing_ids, v_item_count, v_subtotal
    from public.commerce_order_items as items
    where items.order_id = v_commerce_order.id;

    if v_item_count <> v_requested_count
      or v_existing_ids is distinct from v_requested_ids
    then
      raise exception using
        errcode = '22000',
        message = '같은 주문 요청 키에 다른 상품 목록을 사용할 수 없습니다.';
    end if;
    if v_item_count < 1
      or v_subtotal is distinct from v_commerce_order.subtotal
      or v_commerce_order.total is distinct from
        v_commerce_order.subtotal + v_commerce_order.shipping_fee
      or v_commerce_order.total not between 1 and 1000000000
    then
      raise exception using errcode = '22000', message = '저장된 주문 금액을 검증할 수 없습니다.';
    end if;
    for v_product in
      select products.*
      from public.products as products
      join public.commerce_order_items as items
        on items.product_id = products.id
       and items.order_id = v_commerce_order.id
      order by products.id
      for update of products
    loop
      v_locked_count := v_locked_count + 1;
      if v_product.sale_type <> 'fixed' then
        raise exception using errcode = '22000', message = '정가 상품 주문이 아닙니다.';
      end if;
      if v_first_title is null then
        v_first_title := nullif(btrim(v_product.title), '');
      end if;
    end loop;

    if v_locked_count <> v_requested_count then
      raise exception using errcode = 'P0002', message = '주문 상품을 찾을 수 없습니다.';
    end if;
  else
    for v_product in
      select products.*
      from public.products as products
      where products.id = any(v_requested_ids)
      order by products.id
      for update
    loop
      v_locked_count := v_locked_count + 1;
      if v_product.sale_type <> 'fixed'
        or v_product.fixed_price is null
        or v_product.status <> 'active'
        or v_product.publish_at > clock_timestamp()
      then
        raise exception using errcode = '23505', message = '구매할 수 없는 상품이 포함되어 있습니다.';
      end if;
      v_subtotal := v_subtotal + v_product.fixed_price;
      if v_first_title is null then
        v_first_title := nullif(btrim(v_product.title), '');
      end if;
    end loop;

    if v_locked_count <> v_requested_count then
      raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
    end if;
    if v_subtotal not between 1 and 1000000000 then
      raise exception using errcode = '22000', message = '주문 금액의 허용 범위를 초과했습니다.';
    end if;

    insert into public.commerce_orders (
      member_id,
      status,
      subtotal,
      shipping_fee,
      total,
      shipping_credit_applied,
      idempotency_key
    )
    values (
      p_member_id,
      'awaiting_payment',
      v_subtotal,
      0,
      v_subtotal,
      false,
      v_idempotency_key
    )
    returning * into v_commerce_order;

    insert into public.commerce_order_items (
      order_id,
      product_id,
      store_id,
      unit_price,
      payment_status
    )
    select
      v_commerce_order.id,
      products.id,
      products.store_id,
      products.fixed_price,
      'awaiting_payment'
    from public.products as products
    where products.id = any(v_requested_ids);

    update public.products as products
    set status = 'closed', updated_at = clock_timestamp()
    where products.id = any(v_requested_ids);

    delete from public.cart_items as cart_items
    where cart_items.member_id = p_member_id
      and cart_items.product_id = any(v_requested_ids);
  end if;

  if exists (
      select 1
      from public.commerce_order_transfers as transfers
      where transfers.order_id = v_commerce_order.id
    )
    or exists (
      select 1
      from public.manual_transfer_orders as manual_orders
      where manual_orders.product_id = any(v_requested_ids)
        and manual_orders.status in ('awaiting_manual_transfer', 'confirmed')
    )
  then
    raise exception using
      errcode = '55000',
      message = '수동 계좌이체가 진행 중이거나 완료된 주문입니다.';
  end if;

  v_order_name := left(coalesce(v_first_title, '고정가 상품'), 140);
  if v_requested_count > 1 then
    v_order_name := v_order_name || ' 외 ' || (v_requested_count - 1)::text || '건';
  end if;
  v_order_name := left(v_order_name, 160);

  if not v_payment_order_found then
    select payment_orders.*
    into v_payment_order
    from public.payment_orders as payment_orders
    where payment_orders.commerce_order_id = v_commerce_order.id
    for update;

    v_payment_order_found := found;
  end if;

  if not v_payment_order_found then
    if exists (
      select 1
      from public.payment_attempts as attempts
      where attempts.payment_id = p_payment_id
    )
    then
      raise exception using errcode = '23505', message = '이미 사용된 결제 고유번호입니다.';
    end if;

    insert into public.payment_orders (
      product_id,
      commerce_order_id,
      buyer_id,
      order_name,
      expected_amount,
      currency,
      payment_id,
      requested_method,
      store_id
    )
    values (
      null,
      v_commerce_order.id,
      p_member_id,
      v_order_name,
      v_commerce_order.total,
      'KRW',
      p_payment_id,
      p_requested_method,
      v_store_id
    )
    returning * into v_payment_order;

    insert into public.payment_attempts (
      payment_id,
      order_id,
      requested_method,
      store_id,
      expected_amount,
      currency
    )
    values (
      p_payment_id,
      v_payment_order.id,
      p_requested_method,
      v_store_id,
      v_payment_order.expected_amount,
      v_payment_order.currency
    );
  else
    if v_payment_order.buyer_id is null
      or v_payment_order.buyer_id <> p_member_id
      or v_payment_order.expected_amount <> v_commerce_order.total
    then
      raise exception using errcode = '22000', message = '저장된 결제 주문 정보가 일치하지 않습니다.';
    end if;

    if not v_attempt_locked then
      select attempts.*
      into v_attempt
      from public.payment_attempts as attempts
      where attempts.payment_id = v_payment_order.payment_id
        and attempts.order_id = v_payment_order.id
      for update;

      if not found then
        raise exception using errcode = '22000', message = '현재 결제 시도 원장을 찾을 수 없습니다.';
      end if;
      v_attempt_locked := true;
    end if;

    -- PortOne V2 permits multiple payment attempts under one paymentId while
    -- guaranteeing at most one successful payment. Never rotate the commerce
    -- paymentId: an HTTP retry may propose a new ID, but the persisted ID and
    -- its single attempt row remain authoritative for every provider retry.
    if v_attempt.requested_method <> p_requested_method
      or v_payment_order.requested_method <> v_attempt.requested_method
      or v_attempt.store_id <> v_store_id
      or v_payment_order.store_id <> v_store_id
      or v_attempt.expected_amount <> v_payment_order.expected_amount
      or v_attempt.currency <> v_payment_order.currency
    then
      raise exception using errcode = '22000', message = '결제 재요청 정보가 기존 주문과 일치하지 않습니다.';
    end if;
  end if;

  return query
  select
    v_payment_order.payment_id,
    v_commerce_order.id,
    v_payment_order.order_name,
    v_payment_order.expected_amount,
    v_payment_order.payment_status,
    v_payment_order.portone_status,
    coalesce(
      v_payment_order.paid_at is null
        and v_payment_order.portone_status in ('FAILED', 'CANCELLED'),
      false
    );
end;
$$;

revoke all on function public.prepare_commerce_portone_checkout(
  uuid, uuid[], text, text, text, text
)
from public, anon, authenticated, service_role;
grant execute on function public.prepare_commerce_portone_checkout(
  uuid, uuid[], text, text, text, text
)
to service_role;

-- Payment mode changes must wait for both legacy auction obligations and the
-- newly supported commerce obligations. Historical auction attempts do not
-- pin the mode, but every unresolved commerce order does, including a current
-- provider attempt that ended FAILED/CANCELLED and needs operator resolution.
create or replace function app_private.guard_payment_mode_with_live_offers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active_mode is not distinct from old.active_mode then
    return new;
  end if;

  if exists (
    select 1
    from public.auction_purchase_offers as offers
    where offers.status in ('payment_due', 'offered', 'accepted')
  )
  then
    raise exception using
      errcode = '55000',
      message = '진행 중인 낙찰 결제 또는 차순위 구매 기회가 있어 결제 모드를 전환할 수 없습니다.';
  end if;

  if new.active_mode = 'portone'
    and (
      exists (
        select 1
        from public.manual_transfer_orders as manual_orders
        where manual_orders.status = 'awaiting_manual_transfer'
      )
      or exists (
        select 1
        from public.commerce_order_transfers as transfers
        where transfers.status in ('awaiting_transfer', 'partially_paid')
      )
      or exists (
        select 1
        from public.commerce_orders as commerce_orders
        where commerce_orders.status in ('awaiting_payment', 'partially_paid')
          and not exists (
            select 1
            from public.payment_orders as payment_orders
            where payment_orders.commerce_order_id = commerce_orders.id
          )
      )
    )
  then
    raise exception using
      errcode = '55000',
      message = '입금 확인 대기 주문을 모두 처리한 뒤 포트원 결제로 전환해 주세요.';
  end if;

  if new.active_mode = 'manual_transfer'
    and (
      exists (
        select 1
        from public.payment_orders as payment_orders
        join public.payment_attempts as attempts
          on attempts.order_id = payment_orders.id
         and attempts.payment_id = payment_orders.payment_id
        where attempts.portone_status is null
          or attempts.portone_status in (
            'READY',
            'PAY_PENDING',
            'VIRTUAL_ACCOUNT_ISSUED'
          )
      )
      or exists (
        select 1
        from public.payment_orders as payment_orders
        join public.commerce_orders as commerce_orders
          on commerce_orders.id = payment_orders.commerce_order_id
        where commerce_orders.status in ('awaiting_payment', 'partially_paid')
      )
    )
  then
    raise exception using
      errcode = '55000',
      message = '진행 중인 포트원 결제를 모두 처리한 뒤 수동 계좌이체로 전환해 주세요.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_payment_mode_with_live_offers()
from public, anon, authenticated, service_role;

-- Environment-owned bank details may be refreshed in either runtime mode.
-- Synchronizing those details must never silently switch the payment provider.
create or replace function public.sync_manual_transfer_runtime_settings(
  p_bank_name text,
  p_account_number text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_name text := btrim(coalesce(p_bank_name, ''));
  v_account_number text := btrim(coalesce(p_account_number, ''));
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = '서버 권한이 필요합니다.';
  end if;
  if char_length(v_bank_name) not between 2 and 40
    or char_length(v_account_number) not between 5 and 50
    or v_account_number !~ '^[0-9 -]+$'
  then
    raise exception using errcode = '22023', message = '은행명과 계좌번호를 확인해 주세요.';
  end if;

  update public.payment_runtime_settings
  set
    bank_name = v_bank_name,
    account_number = v_account_number
  where singleton;

  if not found then
    raise exception using errcode = 'P0002', message = '결제 설정을 찾지 못했습니다.';
  end if;

  return true;
end;
$$;

revoke all on function public.sync_manual_transfer_runtime_settings(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.sync_manual_transfer_runtime_settings(text, text)
to service_role;

-- Refund reconciliation needs a terminal pre-shipment state. Existing shipped
-- facts remain immutable, while cancelled requests are excluded naturally from
-- the requested/shipped work queue.
alter table public.shipping_requests
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.shipping_requests
  drop constraint if exists shipping_requests_status_check,
  drop constraint if exists shipping_requests_status_details_check,
  drop constraint if exists shipping_requests_cancellation_reason_check;

alter table public.shipping_requests
  add constraint shipping_requests_status_check check (
    status in ('requested', 'shipped', 'cancelled')
  ),
  add constraint shipping_requests_cancellation_reason_check check (
    cancellation_reason is null
    or char_length(btrim(cancellation_reason)) between 1 and 500
  ),
  add constraint shipping_requests_status_details_check check (
    (
      status = 'requested'
      and courier is null
      and tracking_number is null
      and shipped_at is null
      and cancelled_at is null
      and cancellation_reason is null
    )
    or (
      status = 'shipped'
      and courier is not null
      and tracking_number is not null
      and char_length(btrim(courier)) between 1 and 80
      and char_length(btrim(tracking_number)) between 1 and 120
      and shipped_at is not null
      and cancelled_at is null
      and cancellation_reason is null
    )
    or (
      status = 'cancelled'
      and courier is null
      and tracking_number is null
      and shipped_at is null
      and cancelled_at is not null
      and cancellation_reason is not null
    )
  );

create or replace function app_private.guard_cancelled_shipping_request_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'cancelled'
    and new.status is distinct from old.status
  then
    raise exception using
      errcode = '55000',
      message = '취소된 배송 요청은 출고 상태로 되돌릴 수 없습니다.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_cancelled_shipping_request_terminal()
from public, anon, authenticated, service_role;

drop trigger if exists shipping_requests_guard_cancelled_terminal
on public.shipping_requests;
create trigger shipping_requests_guard_cancelled_terminal
before update of status
on public.shipping_requests
for each row execute function app_private.guard_cancelled_shipping_request_terminal();

create unique index if not exists notifications_commerce_refund_shipping_review_once_idx
  on public.notifications (href)
  where kind = 'commerce_portone_refund_shipping_review';

-- A provider refund must immediately revoke fixed-price storage and shipping
-- eligibility. A partial cancellation cannot be allocated safely across
-- multiple unique items, so every item is fail-closed as cancelled while the
-- order records the compatible partially_paid financial state. Products stay
-- closed until an operator performs an explicit reconciliation.
create or replace function app_private.revoke_refunded_commerce_portone_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_order_status text;
  v_refunded_at timestamptz := coalesce(
    new.portone_status_changed_at,
    clock_timestamp()
  );
begin
  select orders.*
  into v_order
  from public.commerce_orders as orders
  where orders.id = new.commerce_order_id
  for update;

  if not found
    or v_order.member_id is distinct from new.buyer_id
    or v_order.total is distinct from new.expected_amount
  then
    raise exception using
      errcode = '22000',
      message = '환불 결제 원장과 고정가 주문 정보가 일치하지 않습니다.';
  end if;

  -- request_product_shipping locks products in ascending order before it
  -- verifies paid storage. Take the same locks and order here so either the
  -- shipping request commits first and is cancelled below, or the request
  -- waits and then observes the refunded item state. The commerce order lock
  -- is acquired first consistently with PortOne checkout/fulfilment.
  perform products.id
  from public.products as products
  join public.commerce_order_items as commerce_items
    on commerce_items.product_id = products.id
   and commerce_items.order_id = v_order.id
  order by products.id
  for update of products;

  v_order_status := case new.portone_status
    when 'PARTIAL_CANCELLED' then 'partially_paid'
    else 'cancelled'
  end;

  -- Serialize refund projection with both individual and batch shipping
  -- updates. If shipping wins the lock first, its shipped fact is preserved;
  -- otherwise requested work is terminally cancelled before it can ship.
  perform requests.id
  from public.shipping_requests as requests
  join public.shipping_request_items as shipping_items
    on shipping_items.request_id = requests.id
  join public.commerce_order_items as commerce_items
    on commerce_items.product_id = shipping_items.product_id
   and commerce_items.order_id = v_order.id
  order by requests.id
  for update of requests;

  update public.shipping_requests as requests
  set
    status = 'cancelled',
    cancelled_at = v_refunded_at,
    cancellation_reason = 'portone_refund'
  where requests.status = 'requested'
    and exists (
      select 1
      from public.shipping_request_items as shipping_items
      join public.commerce_order_items as commerce_items
        on commerce_items.product_id = shipping_items.product_id
       and commerce_items.order_id = v_order.id
      where shipping_items.request_id = requests.id
    );

  -- Both a cancelled pre-shipment request and an already shipped
  -- request require operator reconciliation (including combined-shipping
  -- companions and any shipping-credit adjustment). Shipped facts are never
  -- rewritten as cancelled.
  insert into public.notifications (
    member_id,
    audience_role,
    kind,
    title,
    body,
    href
  )
  select distinct
    null,
    'operator',
    'commerce_portone_refund_shipping_review',
    '환불 주문의 배송 조정이 필요합니다.',
    case
      when requests.status = 'cancelled'
        then '출고 전 배송 요청을 취소했습니다. 합배송 상품과 배송 이용권을 확인해 주세요.'
      else '이미 출고된 주문에서 환불이 확인되었습니다. 배송 및 환불 후속 조정을 확인해 주세요.'
    end,
    '/admin/operator/shipping?order=' || v_order.id::text
      || '&request=' || requests.id::text
  from public.shipping_requests as requests
  join public.shipping_request_items as shipping_items
    on shipping_items.request_id = requests.id
  join public.commerce_order_items as commerce_items
    on commerce_items.product_id = shipping_items.product_id
   and commerce_items.order_id = v_order.id
  where requests.status in ('cancelled', 'shipped')
  on conflict do nothing;

  -- Keep paid_at as the immutable timestamp of the original successful
  -- payment. payment_status revokes fulfilment eligibility, while paid_at
  -- preserves the financial audit trail across a later refund.
  update public.commerce_order_items as items
  set
    payment_status = 'cancelled',
    storage_expires_at = null
  where items.order_id = v_order.id;

  update public.commerce_orders as orders
  set
    status = v_order_status,
    updated_at = clock_timestamp()
  where orders.id = v_order.id
    and orders.status is distinct from v_order_status;

  return new;
end;
$$;

revoke all on function app_private.revoke_refunded_commerce_portone_order()
from public, anon, authenticated, service_role;

drop trigger if exists payment_orders_revoke_refunded_commerce_order
on public.payment_orders;
create trigger payment_orders_revoke_refunded_commerce_order
after update of portone_status, paid_at
on public.payment_orders
for each row
when (
  new.commerce_order_id is not null
  and (
    new.portone_status = 'PARTIAL_CANCELLED'
    or (
      new.portone_status = 'CANCELLED'
      and new.paid_at is not null
    )
  )
)
execute function app_private.revoke_refunded_commerce_portone_order();

-- Replace the shared synchronizer and return paid_at from the same locked
-- snapshot. Callers must never combine a newly synchronized terminal status
-- with a paid_at value read before a concurrent webhook. The auction path
-- retains its prior late-attempt winner behavior. Commerce is stricter: a
-- non-current attempt can never become a paid/refunded settlement, and the
-- provider's actual method category must match that attempt's request.
drop function if exists public.sync_portone_payment(
  text, text, text, bigint, text, text, text, text,
  timestamptz, timestamptz, timestamptz
);

create function public.sync_portone_payment(
  p_payment_id text,
  p_portone_status text,
  p_store_id text,
  p_amount bigint,
  p_currency text,
  p_payment_method text,
  p_vbank_num text,
  p_vbank_bank text,
  p_vbank_due timestamptz,
  p_status_changed_at timestamptz,
  p_paid_at timestamptz
)
returns table (
  payment_status text,
  portone_status text,
  paid_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.payment_orders%rowtype;
  v_payment_status text;
  v_trimmed_method text := nullif(btrim(coalesce(p_payment_method, '')), '');
  v_method_base text;
  v_trimmed_vbank_num text := nullif(btrim(coalesce(p_vbank_num, '')), '');
  v_trimmed_vbank_bank text := nullif(btrim(coalesce(p_vbank_bank, '')), '');
begin
  v_payment_status := public.portone_payment_status_label(p_portone_status);
  if v_payment_status is null then
    raise exception using errcode = '22023', message = '알 수 없는 포트원 결제 상태입니다.';
  end if;
  if p_status_changed_at is null then
    raise exception using errcode = '22023', message = '포트원 상태 변경 시각이 필요합니다.';
  end if;
  if p_amount is null or p_amount <= 0 or p_currency is distinct from 'KRW' then
    raise exception using errcode = '22023', message = '결제 금액 또는 통화가 올바르지 않습니다.';
  end if;
  if v_trimmed_method is not null
    and (
      char_length(v_trimmed_method) > 120
      or v_trimmed_method !~ '^[A-Z0-9_]+(:[A-Z0-9_]+)?$'
    )
  then
    raise exception using errcode = '22023', message = '포트원 결제수단이 올바르지 않습니다.';
  end if;
  v_method_base := split_part(coalesce(v_trimmed_method, ''), ':', 1);

  select attempts.*
  into v_attempt
  from public.payment_attempts as attempts
  where attempts.payment_id = p_payment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '등록되지 않은 결제 고유번호입니다.';
  end if;

  select orders.*
  into v_order
  from public.payment_orders as orders
  where orders.id = v_attempt.order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '결제 주문을 찾지 못했습니다.';
  end if;
  if v_attempt.store_id <> btrim(coalesce(p_store_id, ''))
    or v_order.store_id <> btrim(coalesce(p_store_id, ''))
  then
    raise exception using errcode = '42501', message = '포트원 상점 ID가 주문과 일치하지 않습니다.';
  end if;
  if v_attempt.expected_amount <> p_amount
    or v_order.expected_amount <> p_amount
    or v_attempt.currency <> p_currency
    or v_order.currency <> p_currency
  then
    raise exception using errcode = '22000', message = '포트원 결제 금액이 저장된 주문 금액과 일치하지 않습니다.';
  end if;
  if v_trimmed_method is not null
    and v_method_base not in ('CARD', 'EASY_PAY', 'VIRTUAL_ACCOUNT')
  then
    raise exception using errcode = '22000', message = '지원하지 않는 포트원 결제수단입니다.';
  end if;
  if v_order.commerce_order_id is not null
    and v_trimmed_method is not null
    and v_method_base is distinct from v_attempt.requested_method
  then
    raise exception using
      errcode = '22000',
      message = '실제 포트원 결제수단이 요청한 결제수단과 일치하지 않습니다.';
  end if;
  if v_order.commerce_order_id is not null
    and p_portone_status = 'PAID'
    and v_trimmed_method is null
  then
    raise exception using errcode = '22000', message = '결제완료 결제수단을 확인할 수 없습니다.';
  end if;
  if p_portone_status = 'VIRTUAL_ACCOUNT_ISSUED'
    and (
      v_method_base <> 'VIRTUAL_ACCOUNT'
      or v_trimmed_vbank_num is null
    )
  then
    raise exception using errcode = '22000', message = '가상계좌 발급 정보가 완전하지 않습니다.';
  end if;
  if v_method_base is distinct from 'VIRTUAL_ACCOUNT'
    and (
      v_trimmed_vbank_num is not null
      or v_trimmed_vbank_bank is not null
      or p_vbank_due is not null
    )
  then
    raise exception using errcode = '22000', message = '가상계좌가 아닌 결제에 계좌 정보가 포함되었습니다.';
  end if;
  if p_portone_status = 'PAID' and p_paid_at is null then
    raise exception using errcode = '22000', message = '결제완료 시각을 확인할 수 없습니다.';
  end if;

  -- Duplicate delivery and browser/webhook races are harmless. Older provider
  -- snapshots can refresh verified_at but cannot overwrite a newer state.
  if v_attempt.portone_status_changed_at is not null
    and p_status_changed_at < v_attempt.portone_status_changed_at
  then
    update public.payment_attempts as attempts
    set verified_at = clock_timestamp()
    where attempts.payment_id = p_payment_id;

    return query
    select v_order.payment_status, v_order.portone_status, v_order.paid_at;
    return;
  end if;

  if v_attempt.portone_status_changed_at = p_status_changed_at
    and v_attempt.portone_status is distinct from p_portone_status
    and public.portone_payment_status_rank(v_attempt.portone_status)
      > public.portone_payment_status_rank(p_portone_status)
  then
    update public.payment_attempts as attempts
    set verified_at = clock_timestamp()
    where attempts.payment_id = p_payment_id;

    return query
    select v_order.payment_status, v_order.portone_status, v_order.paid_at;
    return;
  end if;

  -- Commerce now keeps one paymentId permanently. Treat any historical row as
  -- legacy/corrupt state and stop a newer paid or partial-refund snapshot from
  -- replacing or settling alongside the current attempt. Auction behavior
  -- remains unchanged.
  if v_order.commerce_order_id is not null
    and v_order.payment_id <> p_payment_id
    and p_portone_status in ('PAID', 'PARTIAL_CANCELLED')
  then
    raise exception using
      errcode = '55000',
      message = '과거 고정가 결제 시도에서 충돌 상태가 확인되어 자동 정산을 중단했습니다.';
  end if;

  -- Completed/cancelled states cannot be downgraded even if an external
  -- timestamp is malformed.
  if (
      v_attempt.portone_status = 'CANCELLED'
      and p_portone_status <> 'CANCELLED'
      and not (
        v_order.commerce_order_id is not null
        and v_order.payment_id = p_payment_id
        and v_attempt.paid_at is null
        and p_portone_status in (
          'READY',
          'PAY_PENDING',
          'VIRTUAL_ACCOUNT_ISSUED',
          'FAILED',
          'PAID'
        )
      )
    )
    or (
      v_attempt.portone_status = 'PARTIAL_CANCELLED'
      and p_portone_status not in ('PARTIAL_CANCELLED', 'CANCELLED')
    )
    or (
      v_attempt.portone_status = 'PAID'
      and p_portone_status not in ('PAID', 'PARTIAL_CANCELLED', 'CANCELLED')
    )
  then
    update public.payment_attempts as attempts
    set verified_at = clock_timestamp()
    where attempts.payment_id = p_payment_id;

    return query
    select v_order.payment_status, v_order.portone_status, v_order.paid_at;
    return;
  end if;

  update public.payment_attempts as attempts
  set
    payment_method = coalesce(v_trimmed_method, attempts.payment_method),
    vbank_num = case
      when split_part(
        coalesce(v_trimmed_method, attempts.payment_method, ''), ':', 1
      ) = 'VIRTUAL_ACCOUNT'
        then coalesce(v_trimmed_vbank_num, attempts.vbank_num)
      else null
    end,
    vbank_bank = case
      when split_part(
        coalesce(v_trimmed_method, attempts.payment_method, ''), ':', 1
      ) = 'VIRTUAL_ACCOUNT'
        then coalesce(v_trimmed_vbank_bank, attempts.vbank_bank)
      else null
    end,
    vbank_due = case
      when split_part(
        coalesce(v_trimmed_method, attempts.payment_method, ''), ':', 1
      ) = 'VIRTUAL_ACCOUNT'
        then coalesce(p_vbank_due, attempts.vbank_due)
      else null
    end,
    payment_status = v_payment_status,
    portone_status = p_portone_status,
    portone_status_changed_at = p_status_changed_at,
    paid_at = coalesce(p_paid_at, attempts.paid_at),
    verified_at = clock_timestamp()
  where attempts.payment_id = p_payment_id
  returning * into v_attempt;

  if v_order.payment_id = p_payment_id then
    update public.payment_orders as orders
    set
      requested_method = v_attempt.requested_method,
      store_id = v_attempt.store_id,
      payment_method = v_attempt.payment_method,
      vbank_num = v_attempt.vbank_num,
      vbank_bank = v_attempt.vbank_bank,
      vbank_due = v_attempt.vbank_due,
      payment_status = v_attempt.payment_status,
      portone_status = v_attempt.portone_status,
      portone_status_changed_at = v_attempt.portone_status_changed_at,
      paid_at = v_attempt.paid_at
    where orders.id = v_order.id
    returning * into v_order;
  elsif p_portone_status = 'PAID'
    and (
      v_order.portone_status is null
      or v_order.portone_status not in ('PAID', 'PARTIAL_CANCELLED', 'CANCELLED')
    )
  then
    -- Preserve the legacy auction rule: if an earlier failed auction attempt
    -- settles after a retry was prepared, its first authoritative PAID state
    -- wins that auction order. Commerce was rejected above and cannot enter.
    update public.payment_orders as orders
    set
      payment_id = v_attempt.payment_id,
      requested_method = v_attempt.requested_method,
      store_id = v_attempt.store_id,
      payment_method = v_attempt.payment_method,
      vbank_num = v_attempt.vbank_num,
      vbank_bank = v_attempt.vbank_bank,
      vbank_due = v_attempt.vbank_due,
      payment_status = v_attempt.payment_status,
      portone_status = v_attempt.portone_status,
      portone_status_changed_at = v_attempt.portone_status_changed_at,
      paid_at = v_attempt.paid_at
    where orders.id = v_order.id
    returning * into v_order;
  end if;

  return query
  select v_order.payment_status, v_order.portone_status, v_order.paid_at;
end;
$$;

revoke all on function public.sync_portone_payment(
  text, text, text, bigint, text, text, text, text,
  timestamptz, timestamptz, timestamptz
)
from public, anon, authenticated, service_role;
grant execute on function public.sync_portone_payment(
  text, text, text, bigint, text, text, text, text,
  timestamptz, timestamptz, timestamptz
)
to service_role;

-- Preserve the authenticated manual-transfer contract, but make the runtime
-- mode check part of the same stock-locking transaction. PortOne checkout must
-- use prepare_commerce_portone_checkout so it cannot reserve inventory without
-- a payment_orders/payment_attempts ledger.
create or replace function public.create_commerce_order(
  p_product_ids uuid[],
  p_idempotency_key text,
  p_apply_shipping_credit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_product public.products%rowtype;
  v_settings public.payment_runtime_settings%rowtype;
  v_requires_verified_profile boolean;
  v_requested_ids uuid[];
  v_existing_ids uuid[];
  v_requested_count integer;
  v_existing_count integer;
  v_locked_count integer := 0;
  v_subtotal bigint := 0;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if coalesce(array_length(p_product_ids, 1), 0) = 0
    or array_length(p_product_ids, 1) > 50
  then
    raise exception using errcode = '22023', message = '상품 목록이 올바르지 않습니다.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
    or char_length(p_idempotency_key) > 128
  then
    raise exception using errcode = '22023', message = '주문 요청 키가 올바르지 않습니다.';
  end if;

  select coalesce(requirements.enforce_verified_profile, false)
  into v_requires_verified_profile
  from public.kakao_profile_requirements as requirements
  where requirements.singleton;
  v_requires_verified_profile := coalesce(v_requires_verified_profile, false);

  if public.access_role_for_user(v_user_id) not in ('band_member', 'member')
    or not public.auth_user_has_kakao_identity(v_user_id)
    or not exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = v_user_id
        and accounts.account_status = 'active'
    )
    or (
      v_requires_verified_profile
      and not exists (
        select 1
        from public.kakao_member_profiles as kakao_profiles
        where kakao_profiles.member_id = v_user_id
          and kakao_profiles.profile_complete
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = '주문할 수 있는 카카오 회원 계정이 아닙니다.';
  end if;

  -- Serializes with owner mode changes. The mode trigger then observes the
  -- resulting awaiting commerce order and blocks a switch until its manual
  -- transfer is settled or explicitly cancelled by an operator.
  select settings.*
  into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for update;

  -- Match PortOne prepare's pre-ledger race signal. Any exception rolls this
  -- transaction back before inventory or order rows can be changed.
  if not found or v_settings.active_mode <> 'manual_transfer' then
    raise exception using
      errcode = 'PT409',
      message = '수동 계좌이체 모드에서만 이 주문 경로를 사용할 수 있습니다.';
  end if;
  if v_settings.bank_name is null or v_settings.account_number is null then
    raise exception using
      errcode = 'P0001',
      message = '운영자가 입금 계좌를 설정한 후 주문할 수 있습니다.';
  end if;

  select
    array_agg(ids.id order by ids.id),
    count(*)
  into v_requested_ids, v_requested_count
  from (
    select distinct unnest(p_product_ids) as id
  ) as ids;

  if v_requested_count <> array_length(p_product_ids, 1)
    or array_position(v_requested_ids, null) is not null
  then
    raise exception using
      errcode = '22023',
      message = '상품 목록에 중복 또는 빈 값이 있습니다.';
  end if;

  select
    orders.id,
    jsonb_build_object(
      'id', orders.id,
      'status', orders.status,
      'subtotal', orders.subtotal,
      'shipping_fee', orders.shipping_fee,
      'total', orders.total,
      'shipping_credit_applied', orders.shipping_credit_applied
    )
  into v_order_id, v_result
  from public.commerce_orders as orders
  where orders.member_id = v_user_id
    and orders.idempotency_key = btrim(p_idempotency_key)
  for update;

  if v_result is not null then
    select
      array_agg(items.product_id order by items.product_id),
      count(*)
    into v_existing_ids, v_existing_count
    from public.commerce_order_items as items
    where items.order_id = v_order_id;

    if v_existing_count <> v_requested_count
      or v_existing_ids is distinct from v_requested_ids
    then
      raise exception using
        errcode = '22000',
        message = '같은 주문 요청 키에 다른 상품 목록을 사용할 수 없습니다.';
    end if;
    return v_result;
  end if;

  for v_product in
    select products.*
    from public.products as products
    where products.id = any(v_requested_ids)
    order by products.id
    for update
  loop
    v_locked_count := v_locked_count + 1;
    if v_product.sale_type <> 'fixed'
      or v_product.fixed_price is null
      or v_product.status <> 'active'
      or v_product.publish_at > clock_timestamp()
    then
      raise exception using errcode = '23505', message = '구매할 수 없는 상품이 포함되어 있습니다.';
    end if;
    v_subtotal := v_subtotal + v_product.fixed_price;
  end loop;

  if v_locked_count <> v_requested_count then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;

  insert into public.commerce_orders (
    member_id,
    status,
    subtotal,
    shipping_fee,
    total,
    shipping_credit_applied,
    idempotency_key
  )
  values (
    v_user_id,
    'awaiting_payment',
    v_subtotal,
    0,
    v_subtotal,
    false,
    btrim(p_idempotency_key)
  )
  returning id into v_order_id;

  insert into public.commerce_order_items (
    order_id,
    product_id,
    store_id,
    unit_price,
    payment_status
  )
  select
    v_order_id,
    products.id,
    products.store_id,
    products.fixed_price,
    'awaiting_payment'
  from public.products as products
  where products.id = any(v_requested_ids);

  update public.products as products
  set status = 'closed', updated_at = clock_timestamp()
  where products.id = any(v_requested_ids);

  delete from public.cart_items as cart_items
  where cart_items.member_id = v_user_id
    and cart_items.product_id = any(v_requested_ids);

  return jsonb_build_object(
    'id', v_order_id,
    'status', 'awaiting_payment',
    'subtotal', v_subtotal,
    'shipping_fee', 0,
    'total', v_subtotal,
    'shipping_credit_applied', false
  );
end;
$$;

revoke all on function public.create_commerce_order(uuid[], text, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_order(uuid[], text, boolean)
to authenticated;

-- Keep the existing authenticated transfer response while taking the runtime
-- settings lock before the order lock. This matches PortOne prepare's lock
-- order and prevents a mode switch or opposite-provider prepare from racing an
-- idempotent transfer return.
create or replace function public.create_commerce_order_transfer(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_settings public.payment_runtime_settings%rowtype;
  v_requires_verified_profile boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if p_order_id is null then
    raise exception using errcode = '22023', message = '주문을 확인해 주세요.';
  end if;

  select coalesce(requirements.enforce_verified_profile, false)
  into v_requires_verified_profile
  from public.kakao_profile_requirements as requirements
  where requirements.singleton;
  v_requires_verified_profile := coalesce(v_requires_verified_profile, false);

  if public.access_role_for_user(v_user_id) not in ('band_member', 'member')
    or not public.auth_user_has_kakao_identity(v_user_id)
    or not exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = v_user_id
        and accounts.account_status = 'active'
    )
    or (
      v_requires_verified_profile
      and not exists (
        select 1
        from public.kakao_member_profiles as kakao_profiles
        where kakao_profiles.member_id = v_user_id
          and kakao_profiles.profile_complete
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = '입금 요청을 만들 수 있는 카카오 회원 계정이 아닙니다.';
  end if;

  select settings.*
  into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for update;

  if not found
    or v_settings.active_mode <> 'manual_transfer'
    or v_settings.bank_name is null
    or v_settings.account_number is null
  then
    raise exception using
      errcode = 'P0001',
      message = '운영자가 입금 계좌를 설정한 후 주문할 수 있습니다.';
  end if;

  select orders.*
  into v_order
  from public.commerce_orders as orders
  where orders.id = p_order_id
    and orders.member_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '주문을 찾을 수 없습니다.';
  end if;
  if v_order.status <> 'awaiting_payment' then
    raise exception using errcode = '55000', message = '입금 대기 중인 주문이 아닙니다.';
  end if;

  select transfers.*
  into v_transfer
  from public.commerce_order_transfers as transfers
  where transfers.order_id = p_order_id
  for update;

  if found then
    if v_transfer.status = 'cancelled' then
      raise exception using errcode = '55000', message = '취소된 입금 요청입니다.';
    end if;
    return to_jsonb(v_transfer);
  end if;

  insert into public.commerce_order_transfers (
    order_id,
    member_id,
    expected_amount,
    bank_name_snapshot,
    account_number_snapshot
  )
  values (
    v_order.id,
    v_user_id,
    v_order.total,
    v_settings.bank_name,
    v_settings.account_number
  )
  returning * into v_transfer;

  return to_jsonb(v_transfer);
end;
$$;

revoke all on function public.create_commerce_order_transfer(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_order_transfer(uuid)
to authenticated;
