-- PortOne V2 payment ledger for closed-auction winners.
-- Payment data intentionally lives outside public.products because published
-- product rows are readable by anonymous users.

create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique
    references public.products (id) on delete restrict,
  buyer_id uuid references public.profiles (id) on delete set null,
  buyer_deleted_at timestamptz,
  order_name text not null
    check (char_length(btrim(order_name)) between 1 and 160),
  expected_amount bigint not null
    check (expected_amount between 1 and 1000000000),
  currency text not null default 'KRW' check (currency = 'KRW'),
  payment_id text not null unique
    check (
      char_length(payment_id) between 6 and 40
      and payment_id ~ '^[A-Za-z0-9]+$'
    ),
  requested_method text not null
    check (requested_method in ('CARD', 'EASY_PAY', 'VIRTUAL_ACCOUNT')),
  store_id text not null
    check (char_length(btrim(store_id)) between 1 and 200),
  payment_method text
    check (
      payment_method is null
      or char_length(btrim(payment_method)) between 1 and 120
    ),
  vbank_num text
    check (
      vbank_num is null
      or char_length(btrim(vbank_num)) between 1 and 100
    ),
  -- PortOne returns a standard bank code. The UI maps it to a Korean name.
  vbank_bank text
    check (
      vbank_bank is null
      or char_length(btrim(vbank_bank)) between 1 and 80
    ),
  vbank_due timestamptz,
  payment_status text not null default '대기중'
    check (
      payment_status in ('대기중', '가상계좌발급', '결제완료')
    ),
  portone_status text
    check (
      portone_status is null
      or portone_status in (
        'READY', 'PAY_PENDING', 'VIRTUAL_ACCOUNT_ISSUED', 'PAID',
        'FAILED', 'PARTIAL_CANCELLED', 'CANCELLED'
      )
    ),
  portone_status_changed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_orders_member_deletion_state_check check (
    (buyer_id is not null and buyer_deleted_at is null)
    or (buyer_id is null and buyer_deleted_at is not null)
  ),
  constraint payment_orders_status_mapping_check check (
    (portone_status is null and payment_status = '대기중')
    or (portone_status in ('READY', 'PAY_PENDING') and payment_status = '대기중')
    or (
      portone_status = 'VIRTUAL_ACCOUNT_ISSUED'
      and payment_status = '가상계좌발급'
    )
    or (portone_status = 'PAID' and payment_status = '결제완료')
    or (portone_status = 'FAILED' and payment_status = '대기중')
    or (
      portone_status = 'PARTIAL_CANCELLED'
      and payment_status = '결제완료'
    )
    or (portone_status = 'CANCELLED' and payment_status = '대기중')
  ),
  constraint payment_orders_virtual_account_check check (
    (
      payment_status <> '가상계좌발급'
      or (payment_method = 'VIRTUAL_ACCOUNT' and vbank_num is not null)
    )
    and (
      payment_method like 'VIRTUAL_ACCOUNT%'
      or (vbank_num is null and vbank_bank is null and vbank_due is null)
    )
  ),
  constraint payment_orders_paid_at_check check (
    paid_at is null
    or portone_status in ('PAID', 'PARTIAL_CANCELLED', 'CANCELLED')
  )
);

create table public.payment_attempts (
  payment_id text primary key
    check (
      char_length(payment_id) between 6 and 40
      and payment_id ~ '^[A-Za-z0-9]+$'
    ),
  order_id uuid not null
    references public.payment_orders (id) on delete restrict,
  requested_method text not null
    check (requested_method in ('CARD', 'EASY_PAY', 'VIRTUAL_ACCOUNT')),
  store_id text not null
    check (char_length(btrim(store_id)) between 1 and 200),
  expected_amount bigint not null
    check (expected_amount between 1 and 1000000000),
  currency text not null default 'KRW' check (currency = 'KRW'),
  payment_method text
    check (
      payment_method is null
      or char_length(btrim(payment_method)) between 1 and 120
    ),
  vbank_num text
    check (
      vbank_num is null
      or char_length(btrim(vbank_num)) between 1 and 100
    ),
  vbank_bank text
    check (
      vbank_bank is null
      or char_length(btrim(vbank_bank)) between 1 and 80
    ),
  vbank_due timestamptz,
  payment_status text not null default '대기중'
    check (
      payment_status in ('대기중', '가상계좌발급', '결제완료')
    ),
  portone_status text
    check (
      portone_status is null
      or portone_status in (
        'READY', 'PAY_PENDING', 'VIRTUAL_ACCOUNT_ISSUED', 'PAID',
        'FAILED', 'PARTIAL_CANCELLED', 'CANCELLED'
      )
    ),
  portone_status_changed_at timestamptz,
  paid_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, order_id),
  constraint payment_attempts_status_mapping_check check (
    (portone_status is null and payment_status = '대기중')
    or (portone_status in ('READY', 'PAY_PENDING') and payment_status = '대기중')
    or (
      portone_status = 'VIRTUAL_ACCOUNT_ISSUED'
      and payment_status = '가상계좌발급'
    )
    or (portone_status = 'PAID' and payment_status = '결제완료')
    or (portone_status = 'FAILED' and payment_status = '대기중')
    or (
      portone_status = 'PARTIAL_CANCELLED'
      and payment_status = '결제완료'
    )
    or (portone_status = 'CANCELLED' and payment_status = '대기중')
  ),
  constraint payment_attempts_virtual_account_check check (
    (
      payment_status <> '가상계좌발급'
      or (payment_method = 'VIRTUAL_ACCOUNT' and vbank_num is not null)
    )
    and (
      payment_method like 'VIRTUAL_ACCOUNT%'
      or (vbank_num is null and vbank_bank is null and vbank_due is null)
    )
  ),
  constraint payment_attempts_paid_at_check check (
    paid_at is null
    or portone_status in ('PAID', 'PARTIAL_CANCELLED', 'CANCELLED')
  )
);

-- Deferred so the first order and its first attempt can be inserted atomically.
alter table public.payment_orders
  add constraint payment_orders_current_attempt_fkey
  foreign key (payment_id, id)
  references public.payment_attempts (payment_id, order_id)
  on delete restrict
  deferrable initially deferred;

create index payment_orders_member_created_idx
  on public.payment_orders (buyer_id, created_at desc)
  where buyer_id is not null;
create index payment_attempts_order_created_idx
  on public.payment_attempts (order_id, created_at desc);

create or replace function public.set_payment_record_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_payment_record_updated_at() from public;

create trigger payment_orders_set_updated_at
before update on public.payment_orders
for each row execute function public.set_payment_record_updated_at();

create trigger payment_attempts_set_updated_at
before update on public.payment_attempts
for each row execute function public.set_payment_record_updated_at();

create or replace function public.anonymize_member_payment_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payment_orders
  set
    buyer_id = null,
    buyer_deleted_at = clock_timestamp()
  where buyer_id = old.id;
  return old;
end;
$$;

revoke all on function public.anonymize_member_payment_history() from public;

create trigger profiles_anonymize_payment_history
before delete on public.profiles
for each row execute function public.anonymize_member_payment_history();

alter table public.payment_orders enable row level security;
alter table public.payment_attempts enable row level security;

revoke all on public.payment_orders, public.payment_attempts
from anon, authenticated;
grant select on public.payment_orders, public.payment_attempts
to authenticated;

create policy "Members read their payment orders and operators read all"
on public.payment_orders
for select
to authenticated
using (
  (
    buyer_id = (select auth.uid())
    and (select public.is_member())
  )
  or (select public.can_manage_members())
);

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
        (
          orders.buyer_id = (select auth.uid())
          and (select public.is_member())
        )
        or (select public.can_manage_members())
      )
  )
);

-- Writes are deliberately available only through the SECURITY DEFINER RPCs.
revoke insert, update, delete on public.payment_orders, public.payment_attempts
from anon, authenticated, service_role;
grant select on public.payment_orders, public.payment_attempts to service_role;

create or replace function public.portone_payment_status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'READY' then '대기중'
    when 'PAY_PENDING' then '대기중'
    when 'VIRTUAL_ACCOUNT_ISSUED' then '가상계좌발급'
    when 'PAID' then '결제완료'
    when 'FAILED' then '대기중'
    when 'PARTIAL_CANCELLED' then '결제완료'
    when 'CANCELLED' then '대기중'
    else null
  end;
$$;

revoke all on function public.portone_payment_status_label(text) from public;

create or replace function public.portone_payment_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'READY' then 10
    when 'PAY_PENDING' then 20
    when 'VIRTUAL_ACCOUNT_ISSUED' then 30
    when 'FAILED' then 40
    when 'PAID' then 50
    when 'PARTIAL_CANCELLED' then 60
    when 'CANCELLED' then 70
    else 0
  end;
$$;

revoke all on function public.portone_payment_status_rank(text) from public;

create or replace function public.prepare_portone_payment(
  p_member_id uuid,
  p_product_id uuid,
  p_payment_id text,
  p_requested_method text,
  p_store_id text
)
returns table (
  payment_id text,
  product_id uuid,
  order_name text,
  expected_amount bigint,
  payment_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_order public.payment_orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_winner_id uuid;
  v_winning_amount bigint;
  v_requires_verified_profile boolean;
begin
  if p_member_id is null or p_product_id is null then
    raise exception using errcode = '22023', message = '결제 회원과 상품 정보가 필요합니다.';
  end if;
  if char_length(coalesce(p_payment_id, '')) not between 6 and 40
    or p_payment_id !~ '^[A-Za-z0-9]+$'
  then
    raise exception using errcode = '22023', message = '결제 고유번호 형식을 확인해 주세요.';
  end if;
  if p_requested_method not in ('CARD', 'EASY_PAY', 'VIRTUAL_ACCOUNT') then
    raise exception using errcode = '22023', message = '지원하지 않는 결제수단입니다.';
  end if;
  if char_length(btrim(coalesce(p_store_id, ''))) not between 1 and 200 then
    raise exception using errcode = '22023', message = '포트원 상점 정보를 확인해 주세요.';
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

  select products.*
  into v_product
  from public.products as products
  where products.id = p_product_id
  for update;

  if not found or v_product.status <> 'closed' then
    raise exception using errcode = 'P0002', message = '결제할 수 있는 마감 상품을 찾지 못했습니다.';
  end if;

  select bids.bidder_id, bids.amount
  into v_winner_id, v_winning_amount
  from public.auction_bids as bids
  where bids.product_id = p_product_id
  order by bids.amount desc, bids.created_at desc, bids.id desc
  limit 1;

  if v_winner_id is null or v_winner_id <> p_member_id then
    raise exception using errcode = '42501', message = '낙찰자만 해당 상품을 결제할 수 있습니다.';
  end if;
  if v_winning_amount is null or v_winning_amount <= 0 then
    raise exception using errcode = '22000', message = '낙찰 금액을 확정할 수 없습니다.';
  end if;

  select orders.*
  into v_order
  from public.payment_orders as orders
  where orders.product_id = p_product_id
  for update;

  if v_order.id is null then
    if exists (
      select 1
      from public.payment_attempts as attempts
      where attempts.payment_id = p_payment_id
    ) then
      raise exception using errcode = '23505', message = '이미 사용된 결제 고유번호입니다.';
    end if;

    insert into public.payment_orders (
      product_id,
      buyer_id,
      order_name,
      expected_amount,
      currency,
      payment_id,
      requested_method,
      store_id
    )
    values (
      p_product_id,
      p_member_id,
      v_product.title,
      v_winning_amount,
      'KRW',
      p_payment_id,
      p_requested_method,
      btrim(p_store_id)
    )
    returning * into v_order;

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
      v_order.id,
      p_requested_method,
      btrim(p_store_id),
      v_winning_amount,
      'KRW'
    );
  else
    if v_order.buyer_id is null or v_order.buyer_id <> p_member_id then
      raise exception using errcode = '42501', message = '해당 주문의 결제 권한이 없습니다.';
    end if;
    if v_order.expected_amount <> v_winning_amount then
      raise exception using errcode = '22000', message = '저장된 주문 금액과 낙찰 금액이 일치하지 않습니다.';
    end if;

    if v_order.payment_id = p_payment_id then
      select attempts.*
      into v_attempt
      from public.payment_attempts as attempts
      where attempts.payment_id = p_payment_id
        and attempts.order_id = v_order.id;

      if v_attempt.payment_id is null
        or v_attempt.requested_method <> p_requested_method
        or v_attempt.store_id <> btrim(p_store_id)
        or v_order.store_id <> btrim(p_store_id)
      then
        raise exception using errcode = '22000', message = '결제 재시도 정보가 기존 주문과 일치하지 않습니다.';
      end if;
    else
      -- A new ID is allowed only after an authoritative FAILED state.
      if v_order.portone_status is distinct from 'FAILED'
      then
        raise exception using errcode = '55000', message = '이미 진행 중이거나 종료된 결제가 있습니다.';
      end if;
      if exists (
        select 1
        from public.payment_attempts as attempts
        where attempts.payment_id = p_payment_id
      ) then
        raise exception using errcode = '23505', message = '이미 사용된 결제 고유번호입니다.';
      end if;

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
        v_order.id,
        p_requested_method,
        btrim(p_store_id),
        v_order.expected_amount,
        v_order.currency
      );

      update public.payment_orders as orders
      set
        payment_id = p_payment_id,
        requested_method = p_requested_method,
        store_id = btrim(p_store_id),
        payment_method = null,
        vbank_num = null,
        vbank_bank = null,
        vbank_due = null,
        payment_status = '대기중',
        portone_status = null,
        portone_status_changed_at = null,
        paid_at = null
      where orders.id = v_order.id
      returning * into v_order;
    end if;
  end if;

  return query
  select
    v_order.payment_id,
    v_order.product_id,
    v_order.order_name,
    v_order.expected_amount,
    v_order.payment_status;
end;
$$;

revoke all on function public.prepare_portone_payment(uuid, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.prepare_portone_payment(uuid, uuid, text, text, text)
to service_role;

create or replace function public.sync_portone_payment(
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
  portone_status text
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
    raise exception using errcode = '22000', message = '포트원 결제 금액이 저장된 낙찰가와 일치하지 않습니다.';
  end if;
  if v_trimmed_method is not null
    and v_method_base not in ('CARD', 'EASY_PAY', 'VIRTUAL_ACCOUNT')
  then
    raise exception using errcode = '22000', message = '지원하지 않는 포트원 결제수단입니다.';
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
    select v_order.payment_status, v_order.portone_status;
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
    select v_order.payment_status, v_order.portone_status;
    return;
  end if;

  -- Completed/cancelled states cannot be downgraded even if an external
  -- timestamp is malformed.
  if (
      v_attempt.portone_status = 'CANCELLED'
      and p_portone_status <> 'CANCELLED'
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
    select v_order.payment_status, v_order.portone_status;
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
    -- If an earlier failed attempt settles after a retry was prepared, the
    -- first authoritative PAID attempt wins the order. All attempts remain as
    -- an immutable audit trail for manual duplicate-payment reconciliation.
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
  select v_order.payment_status, v_order.portone_status;
end;
$$;

revoke all on function public.sync_portone_payment(
  text, text, text, bigint, text, text, text, text,
  timestamptz, timestamptz, timestamptz
)
from public, anon, authenticated;
grant execute on function public.sync_portone_payment(
  text, text, text, bigint, text, text, text, text,
  timestamptz, timestamptz, timestamptz
)
to service_role;

-- Extend the self-only winner RPC with the current payment projection.
drop function if exists public.get_my_won_products();
create function public.get_my_won_products()
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
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
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
   and orders.buyer_id = v_user_id
  where winner.bidder_id = v_user_id
    and products.status = 'closed'
  order by products.closes_at desc;
end;
$$;

revoke all on function public.get_my_won_products() from public, anon;
grant execute on function public.get_my_won_products() to authenticated;

-- Shipping requires an exact, currently PAID PortOne state. The grade 2.5
-- deadline exemption never waives payment itself.
create or replace function public.request_product_shipping(
  p_product_ids uuid[],
  p_address_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_credit_count integer;
  v_address public.shipping_addresses%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_valid_count integer;
  v_distinct_count integer;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;
  if p_product_ids is null
    or cardinality(p_product_ids) < 1
    or cardinality(p_product_ids) > 100
  then
    raise exception using errcode = '22023', message = '택배 접수할 상품을 선택해 주세요.';
  end if;

  select count(distinct product_id)
  into v_distinct_count
  from unnest(p_product_ids) as selected(product_id);
  if v_distinct_count <> cardinality(p_product_ids) then
    raise exception using errcode = '22023', message = '중복된 상품 선택이 있습니다.';
  end if;

  select accounts.shipping_credit_count
  into v_credit_count
  from public.member_accounts as accounts
  where accounts.member_id = v_user_id
  for update;
  if v_credit_count is null or v_credit_count < 1 then
    raise exception using errcode = 'P0001', message = '택배 가능 횟수가 부족합니다.';
  end if;

  select addresses.*
  into v_address
  from public.shipping_addresses as addresses
  where addresses.id = p_address_id
    and addresses.member_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 배송지를 찾을 수 없습니다.';
  end if;

  -- Serialize shipment acceptance with webhook status reconciliation. If a
  -- cancellation RPC already holds an order lock, this request waits and then
  -- observes the cancelled state instead of shipping an unpaid order.
  perform orders.id
  from public.payment_orders as orders
  where orders.product_id = any(p_product_ids)
    and orders.buyer_id = v_user_id
  order by orders.product_id
  for update;

  select count(*)
  into v_valid_count
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
   and orders.buyer_id = v_user_id
   and orders.payment_status = '결제완료'
   and orders.portone_status = 'PAID'
  where products.id = any(p_product_ids)
    and products.status = 'closed'
    and winner.bidder_id = v_user_id
    and not exists (
      select 1
      from public.shipping_request_items as items
      where items.product_id = products.id
    );
  if v_valid_count <> cardinality(p_product_ids) then
    raise exception using errcode = '42501', message = '결제가 완료되지 않았거나 접수할 수 없는 상품이 포함되었습니다.';
  end if;

  insert into public.shipping_requests (
    id, member_id, address_id, address_snapshot
  )
  values (
    v_request_id,
    v_user_id,
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
  where member_id = v_user_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_product_shipping(uuid[], uuid)
from public, anon;
grant execute on function public.request_product_shipping(uuid[], uuid)
to authenticated;
