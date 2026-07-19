-- Temporary manual bank-transfer settlement mode.
--
-- PortOne tables and functions remain intact for later restoration. Manual
-- transfers use a separate immutable-by-client ledger so a browser can never
-- mark its own order paid, and bank details are disclosed only by the
-- validated winner RPC after the user explicitly starts the transfer.

create table public.payment_runtime_settings (
  singleton boolean primary key default true check (singleton),
  active_mode text not null default 'manual_transfer'
    check (active_mode in ('manual_transfer', 'portone')),
  bank_name text
    check (
      bank_name is null
      or char_length(btrim(bank_name)) between 2 and 40
    ),
  account_number text
    check (
      account_number is null
      or (
        char_length(btrim(account_number)) between 5 and 50
        and btrim(account_number) ~ '^[0-9 -]+$'
      )
    ),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (bank_name is null and account_number is null)
    or (bank_name is not null and account_number is not null)
  )
);

insert into public.payment_runtime_settings (
  singleton, active_mode, bank_name, account_number
)
values (true, 'manual_transfer', null, null)
on conflict (singleton) do update
set active_mode = 'manual_transfer';

alter table public.payment_runtime_settings enable row level security;
alter table public.payment_runtime_settings force row level security;
revoke all on public.payment_runtime_settings from anon, authenticated;
revoke all on public.payment_runtime_settings from public, service_role;

create table public.manual_transfer_orders (
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
  bank_name_snapshot text not null
    check (char_length(btrim(bank_name_snapshot)) between 2 and 40),
  account_number_snapshot text not null
    check (
      char_length(btrim(account_number_snapshot)) between 5 and 50
      and btrim(account_number_snapshot) ~ '^[0-9 -]+$'
    ),
  status text not null default 'awaiting_manual_transfer'
    check (status in ('awaiting_manual_transfer', 'confirmed')),
  requested_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint manual_transfer_orders_buyer_deletion_check check (
    (buyer_id is not null and buyer_deleted_at is null)
    or (buyer_id is null and buyer_deleted_at is not null)
  ),
  constraint manual_transfer_orders_confirmation_check check (
    (
      status = 'awaiting_manual_transfer'
      and confirmed_at is null
      and confirmed_by is null
    )
    or (
      status = 'confirmed'
      and confirmed_at is not null
    )
  )
);

create index manual_transfer_orders_pending_time_idx
on public.manual_transfer_orders (requested_at, id)
where status = 'awaiting_manual_transfer';

create index manual_transfer_orders_buyer_time_idx
on public.manual_transfer_orders (buyer_id, requested_at desc)
where buyer_id is not null;

alter table public.manual_transfer_orders enable row level security;
alter table public.manual_transfer_orders force row level security;
revoke all on public.manual_transfer_orders from anon, authenticated;
revoke all on public.manual_transfer_orders from public, service_role;

create or replace function app_private.set_manual_payment_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function app_private.set_manual_payment_updated_at()
from public, anon, authenticated, service_role;

create trigger payment_runtime_settings_set_updated_at
before update on public.payment_runtime_settings
for each row execute function app_private.set_manual_payment_updated_at();

create trigger manual_transfer_orders_set_updated_at
before update on public.manual_transfer_orders
for each row execute function app_private.set_manual_payment_updated_at();

-- Keep the minimum settlement record while removing the direct member link.
create or replace function app_private.anonymize_manual_transfer_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An unconfirmed intent contains no completed financial history and would
  -- otherwise become an unresolvable blocker when PortOne is restored.
  delete from public.manual_transfer_orders
  where buyer_id = old.id
    and status = 'awaiting_manual_transfer';

  update public.manual_transfer_orders
  set
    buyer_id = null,
    buyer_deleted_at = clock_timestamp()
  where buyer_id = old.id
    and status = 'confirmed';
  return old;
end;
$$;

revoke all on function app_private.anonymize_manual_transfer_history()
from public, anon, authenticated, service_role;

create trigger profiles_anonymize_manual_transfer_history
before delete on public.profiles
for each row execute function app_private.anonymize_manual_transfer_history();

-- Apply the existing hidden-test mutation gate to the new ledger.
create trigger manual_transfer_orders_protect_hidden_test_write
before insert or update or delete on public.manual_transfer_orders
for each row execute function public.protect_owner_hidden_test_write('buyer_id');

-- Once either manual state exists, a PortOne ledger must not be created or
-- reconciled for the same product. This closes races beyond application-level
-- mode checks and prevents double settlement across providers.
create or replace function app_private.reject_portone_manual_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.manual_transfer_orders as manual_orders
    where manual_orders.product_id = new.product_id
  ) then
    raise exception using
      errcode = '55000',
      message = '수동 계좌이체가 진행 중이거나 완료된 상품입니다.';
  end if;
  return new;
end;
$$;

revoke all on function app_private.reject_portone_manual_overlap()
from public, anon, authenticated, service_role;

create trigger payment_orders_reject_manual_overlap
before insert or update of
  payment_status, portone_status, payment_id, requested_method, store_id
on public.payment_orders
for each row execute function app_private.reject_portone_manual_overlap();

create or replace function app_private.capture_manual_payment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_subject uuid;
  v_event text;
  v_entity_type text;
  v_entity_id text;
  v_metadata jsonb;
begin
  if tg_table_name = 'manual_transfer_orders' then
    v_subject := new.buyer_id;
    v_event := case
      when tg_op = 'INSERT' then 'payment.manual_transfer.requested'
      else 'payment.manual_transfer.status_changed'
    end;
    v_entity_type := 'manual_transfer_order';
    v_entity_id := new.id::text;
    v_metadata := jsonb_build_object(
      'previous_status', case when tg_op = 'UPDATE' then old.status end,
      'payment_status', new.status,
      'amount', new.expected_amount
    );
  else
    v_event := 'payment.runtime_settings.updated';
    v_entity_type := 'payment_runtime_settings';
    v_entity_id := 'singleton';
    v_metadata := jsonb_build_object(
      'previous_mode', old.active_mode,
      'active_mode', new.active_mode,
      'bank_changed', old.bank_name is distinct from new.bank_name,
      'account_changed', old.account_number is distinct from new.account_number
    );
  end if;

  perform app_private.write_security_activity(
    v_actor,
    v_subject,
    'payment',
    v_event,
    lower(tg_op),
    tg_table_name,
    v_entity_type,
    v_entity_id,
    case when tg_table_name = 'payment_runtime_settings'
      then 'notice' else 'info' end,
    null,
    null,
    jsonb_strip_nulls(v_metadata)
  );
  return new;
end;
$$;

revoke all on function app_private.capture_manual_payment_activity()
from public, anon, authenticated, service_role;

create trigger manual_transfer_orders_security_activity
after insert or update on public.manual_transfer_orders
for each row execute function app_private.capture_manual_payment_activity();

create trigger payment_runtime_settings_security_activity
after update on public.payment_runtime_settings
for each row execute function app_private.capture_manual_payment_activity();

create or replace function app_private.is_payment_settled(
  p_product_id uuid,
  p_buyer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.payment_orders as orders
      where orders.product_id = p_product_id
        and orders.buyer_id = p_buyer_id
        and orders.payment_status = '결제완료'
        and orders.portone_status = 'PAID'
    )
    or exists (
      select 1
      from public.manual_transfer_orders as manual_orders
      where manual_orders.product_id = p_product_id
        and manual_orders.buyer_id = p_buyer_id
        and manual_orders.status = 'confirmed'
    ),
    false
  );
$$;

revoke all on function app_private.is_payment_settled(uuid, uuid)
from public, anon, authenticated, service_role;

-- Named wrapper retained for shipping-policy readability and static audits.
create or replace function app_private.is_product_payment_settled(
  p_product_id uuid,
  p_buyer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_payment_settled(p_product_id, p_buyer_id);
$$;

revoke all on function app_private.is_product_payment_settled(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.get_payment_runtime_mode_for_service()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select settings.active_mode
  from public.payment_runtime_settings as settings
  where settings.singleton;
$$;

revoke all on function public.get_payment_runtime_mode_for_service()
from public, anon, authenticated, service_role;
grant execute on function public.get_payment_runtime_mode_for_service()
to service_role;

create or replace function public.get_manual_transfer_status_for_service(
  p_product_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select manual_orders.status
  from public.manual_transfer_orders as manual_orders
  where manual_orders.product_id = p_product_id;
$$;

revoke all on function public.get_manual_transfer_status_for_service(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_manual_transfer_status_for_service(uuid)
to service_role;

create or replace function public.get_manual_transfer_settings()
returns table (
  active_mode text,
  bank_name text,
  account_number text,
  configured boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_manage_members() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;

  return query
  select
    settings.active_mode,
    settings.bank_name,
    settings.account_number,
    settings.bank_name is not null and settings.account_number is not null,
    settings.updated_at
  from public.payment_runtime_settings as settings
  where settings.singleton;
end;
$$;

revoke all on function public.get_manual_transfer_settings()
from public, anon;
grant execute on function public.get_manual_transfer_settings()
to authenticated;

create or replace function public.update_manual_transfer_settings(
  p_bank_name text,
  p_account_number text
)
returns table (
  active_mode text,
  bank_name text,
  account_number text,
  configured boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_name text := btrim(coalesce(p_bank_name, ''));
  v_account_number text := btrim(coalesce(p_account_number, ''));
begin
  if auth.uid() is null or not public.can_manage_members() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if char_length(v_bank_name) not between 2 and 40
    or char_length(v_account_number) not between 5 and 50
    or v_account_number !~ '^[0-9 -]+$'
  then
    raise exception using errcode = '22023', message = '은행명과 계좌번호를 확인해 주세요.';
  end if;

  update public.payment_runtime_settings as settings
  set
    bank_name = v_bank_name,
    account_number = v_account_number,
    updated_by = auth.uid()
  where settings.singleton;

  return query
  select
    settings.active_mode,
    settings.bank_name,
    settings.account_number,
    true,
    settings.updated_at
  from public.payment_runtime_settings as settings
  where settings.singleton;
end;
$$;

revoke all on function public.update_manual_transfer_settings(text, text)
from public, anon;
grant execute on function public.update_manual_transfer_settings(text, text)
to authenticated;

-- Kept owner-only and intentionally absent from the normal operator UI. This
-- is the explicit restoration switch after the PG contract is ready.
create or replace function public.set_payment_runtime_mode(
  p_active_mode text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_active_mode is null
    or p_active_mode not in ('manual_transfer', 'portone')
  then
    raise exception using errcode = '22023', message = '결제 운영 모드를 확인해 주세요.';
  end if;
  if p_active_mode = 'portone' and exists (
    select 1
    from public.manual_transfer_orders as manual_orders
    where manual_orders.status = 'awaiting_manual_transfer'
  ) then
    raise exception using
      errcode = '55000',
      message = '입금 확인 대기 주문을 모두 처리한 뒤 PG 결제를 복원해 주세요.';
  end if;

  update public.payment_runtime_settings
  set active_mode = p_active_mode, updated_by = auth.uid()
  where singleton;
  return p_active_mode;
end;
$$;

revoke all on function public.set_payment_runtime_mode(text)
from public, anon;
grant execute on function public.set_payment_runtime_mode(text)
to authenticated;

create or replace function public.begin_manual_transfer(
  p_product_id uuid
)
returns table (
  order_id uuid,
  product_id uuid,
  order_name text,
  expected_amount bigint,
  status text,
  bank_name text,
  account_number text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz,
  is_payment_settled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_product public.products%rowtype;
  v_order public.manual_transfer_orders%rowtype;
  v_winner_id uuid;
  v_winning_amount bigint;
  v_settings public.payment_runtime_settings%rowtype;
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인이 필요합니다.';
  end if;
  if not public.auth_user_has_kakao_identity(v_user_id)
    or not exists (
      select 1
      from public.member_accounts as accounts
      where accounts.member_id = v_user_id
        and accounts.account_status = 'active'
    )
  then
    raise exception using errcode = '42501', message = '결제할 수 있는 활성 카카오 회원이 아닙니다.';
  end if;
  if p_product_id is null then
    raise exception using errcode = '22023', message = '결제할 상품을 선택해 주세요.';
  end if;

  select settings.* into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for share;
  if not (v_settings.active_mode = 'manual_transfer') then
    raise exception using errcode = '55000', message = '현재 계좌이체 결제를 이용할 수 없습니다.';
  end if;
  if not (
    v_settings.bank_name is not null
    and v_settings.account_number is not null
  ) then
    raise exception using errcode = '55000', message = '운영 계좌가 아직 등록되지 않았습니다.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
    and products.status = 'closed'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '결제할 수 있는 마감 상품을 찾지 못했습니다.';
  end if;

  select bids.bidder_id, bids.amount
  into v_winner_id, v_winning_amount
  from public.auction_bids as bids
  where bids.product_id = p_product_id
  order by bids.amount desc, bids.created_at desc, bids.id desc
  limit 1;
  if v_winner_id is null or v_winner_id <> v_user_id then
    raise exception using errcode = '42501', message = '낙찰자만 계좌번호를 확인할 수 있습니다.';
  end if;
  if v_winning_amount is null or v_winning_amount <= 0 then
    raise exception using errcode = '22000', message = '낙찰 금액을 확정할 수 없습니다.';
  end if;

  -- PortOne reconciliation serializes on this row. Waiting here prevents a
  -- PAID transition and a manual order insert from both winning the race.
  perform orders.id
  from public.payment_orders as orders
  where orders.product_id = p_product_id
  for update;
  if exists (
    select 1 from public.payment_orders as orders
    where orders.product_id = p_product_id
      and orders.buyer_id = v_user_id
      and orders.payment_status = '결제완료'
      and orders.portone_status = 'PAID'
  ) then
    raise exception using errcode = '55000', message = '이미 결제가 완료된 상품입니다.';
  end if;

  select manual_orders.* into v_order
  from public.manual_transfer_orders as manual_orders
  where manual_orders.product_id = p_product_id
  for update;

  if v_order.id is null then
    insert into public.manual_transfer_orders (
      product_id,
      buyer_id,
      order_name,
      expected_amount,
      bank_name_snapshot,
      account_number_snapshot
    ) values (
      p_product_id,
      v_user_id,
      v_product.title,
      v_winning_amount,
      v_settings.bank_name,
      v_settings.account_number
    )
    returning * into v_order;
  elsif v_order.buyer_id is null or v_order.buyer_id <> v_user_id then
    raise exception using errcode = '42501', message = '해당 주문의 결제 권한이 없습니다.';
  elsif v_order.expected_amount <> v_winning_amount then
    raise exception using errcode = '22000', message = '저장된 주문 금액과 낙찰 금액이 일치하지 않습니다.';
  end if;

  perform app_private.write_security_activity(
    v_user_id,
    v_user_id,
    'payment',
    'payment.manual_transfer.account_revealed',
    'read',
    'begin_manual_transfer',
    'manual_transfer_order',
    v_order.id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'product_id', v_order.product_id,
      'amount', v_order.expected_amount,
      'payment_status', v_order.status
    )
  );

  return query select
    v_order.id,
    v_order.product_id,
    v_order.order_name,
    v_order.expected_amount,
    v_order.status,
    v_order.bank_name_snapshot,
    v_order.account_number_snapshot,
    v_order.requested_at,
    v_order.confirmed_at,
    v_order.updated_at,
    v_order.status = 'confirmed';
end;
$$;

revoke all on function public.begin_manual_transfer(uuid)
from public, anon;
grant execute on function public.begin_manual_transfer(uuid)
to authenticated;

create or replace function public.owner_begin_hidden_test_manual_transfer(
  p_product_id uuid
)
returns table (
  order_id uuid,
  product_id uuid,
  order_name text,
  expected_amount bigint,
  status text,
  bank_name text,
  account_number text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz,
  is_payment_settled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_test_user uuid;
  v_product public.products%rowtype;
  v_order public.manual_transfer_orders%rowtype;
  v_winner_id uuid;
  v_winning_amount bigint;
  v_settings public.payment_runtime_settings%rowtype;
begin
  if v_owner is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  select tests.test_user_id into v_test_user
  from public.owner_hidden_test_members as tests
  where tests.owner_id = v_owner and tests.retired_at is null
  for update;
  if v_test_user is null then
    raise exception using errcode = 'P0002', message = '활성 테스트 회원이 없습니다.';
  end if;
  if not exists (
    select 1
    from public.member_accounts as accounts
    where accounts.member_id = v_test_user
      and accounts.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = '활성 테스트 회원 계정이 아닙니다.';
  end if;
  perform set_config('app.owner_hidden_test_actor', v_owner::text, true);

  select settings.* into v_settings
  from public.payment_runtime_settings as settings
  where settings.singleton
  for share;
  if v_settings.active_mode <> 'manual_transfer'
    or v_settings.bank_name is null
    or v_settings.account_number is null
  then
    raise exception using errcode = '55000', message = '계좌이체 운영 설정을 확인해 주세요.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
    and products.status = 'closed'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '결제할 수 있는 마감 상품을 찾지 못했습니다.';
  end if;
  select bids.bidder_id, bids.amount into v_winner_id, v_winning_amount
  from public.auction_bids as bids
  where bids.product_id = p_product_id
  order by bids.amount desc, bids.created_at desc, bids.id desc
  limit 1;
  if v_winner_id is null or v_winner_id <> v_test_user then
    raise exception using errcode = '42501', message = '테스트 회원이 낙찰한 상품이 아닙니다.';
  end if;
  if v_winning_amount is null or v_winning_amount <= 0 then
    raise exception using errcode = '22000', message = '낙찰 금액을 확정할 수 없습니다.';
  end if;

  perform orders.id
  from public.payment_orders as orders
  where orders.product_id = p_product_id
  for update;
  if exists (
    select 1 from public.payment_orders as orders
    where orders.product_id = p_product_id
      and orders.buyer_id = v_test_user
      and orders.payment_status = '결제완료'
      and orders.portone_status = 'PAID'
  ) then
    raise exception using errcode = '55000', message = '이미 결제가 완료된 테스트 상품입니다.';
  end if;

  select manual_orders.* into v_order
  from public.manual_transfer_orders as manual_orders
  where manual_orders.product_id = p_product_id
  for update;
  if v_order.id is null then
    insert into public.manual_transfer_orders (
      product_id,
      buyer_id,
      order_name,
      expected_amount,
      bank_name_snapshot,
      account_number_snapshot
    ) values (
      p_product_id,
      v_test_user,
      v_product.title,
      v_winning_amount,
      v_settings.bank_name,
      v_settings.account_number
    ) returning * into v_order;
  elsif v_order.buyer_id is null or v_order.buyer_id <> v_test_user then
    raise exception using errcode = '42501', message = '테스트 주문 소유자가 일치하지 않습니다.';
  elsif v_order.expected_amount <> v_winning_amount then
    raise exception using errcode = '22000', message = '저장된 주문 금액과 낙찰 금액이 일치하지 않습니다.';
  end if;

  if v_order.status = 'awaiting_manual_transfer' then
    perform public.insert_owner_hidden_test_member_audit(
      v_owner,
      v_test_user,
      'test_member.manual_transfer_started',
      jsonb_build_object(
        'manual_transfer_order_id', v_order.id,
        'product_id', p_product_id,
        'expected_amount', v_order.expected_amount
      )
    );
  end if;

  perform app_private.write_security_activity(
    v_owner,
    v_test_user,
    'payment',
    'payment.manual_transfer.account_revealed',
    'read',
    'owner_begin_hidden_test_manual_transfer',
    'manual_transfer_order',
    v_order.id::text,
    'notice',
    null,
    null,
    jsonb_build_object(
      'product_id', v_order.product_id,
      'amount', v_order.expected_amount,
      'payment_status', v_order.status
    )
  );

  return query select
    v_order.id,
    v_order.product_id,
    v_order.order_name,
    v_order.expected_amount,
    v_order.status,
    v_order.bank_name_snapshot,
    v_order.account_number_snapshot,
    v_order.requested_at,
    v_order.confirmed_at,
    v_order.updated_at,
    v_order.status = 'confirmed';
end;
$$;

revoke all on function public.owner_begin_hidden_test_manual_transfer(uuid)
from public, anon;
grant execute on function public.owner_begin_hidden_test_manual_transfer(uuid)
to authenticated;

create or replace function public.get_pending_manual_transfers(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  order_id uuid,
  product_id uuid,
  buyer_id uuid,
  buyer_display_name text,
  product_title text,
  image_urls text[],
  bank_name text,
  account_number text,
  expected_amount bigint,
  status text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_manage_members() then
    raise exception using errcode = '42501', message = '입금 확인 권한이 없습니다.';
  end if;
  if p_limit not between 1 and 200 or p_offset not between 0 and 1000000 then
    raise exception using errcode = '22023', message = '조회 범위를 확인해 주세요.';
  end if;

  return query
  select
    manual_orders.id,
    manual_orders.product_id,
    manual_orders.buyer_id,
    coalesce(profiles.display_name, '탈퇴 회원'),
    products.title,
    products.image_urls,
    manual_orders.bank_name_snapshot,
    manual_orders.account_number_snapshot,
    manual_orders.expected_amount,
    manual_orders.status,
    manual_orders.requested_at,
    manual_orders.confirmed_at,
    manual_orders.updated_at,
    count(*) over ()
  from public.manual_transfer_orders as manual_orders
  join public.products as products on products.id = manual_orders.product_id
  left join public.profiles as profiles on profiles.id = manual_orders.buyer_id
  where manual_orders.status = 'awaiting_manual_transfer'
    and (
      public.is_owner()
      or not exists (
        select 1
        from public.owner_hidden_test_members as hidden_test_members
        where hidden_test_members.test_user_id = manual_orders.buyer_id
      )
    )
  order by manual_orders.requested_at, manual_orders.id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_pending_manual_transfers(integer, integer)
from public, anon;
grant execute on function public.get_pending_manual_transfers(integer, integer)
to authenticated;

create or replace function public.confirm_manual_transfer(
  p_order_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  order_id uuid,
  product_id uuid,
  status text,
  confirmed_at timestamptz,
  updated_at timestamptz,
  is_payment_settled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_product_id uuid;
  v_order public.manual_transfer_orders%rowtype;
  v_winner_id uuid;
  v_winning_amount bigint;
begin
  if v_actor is null or not public.can_manage_members() then
    raise exception using errcode = '42501', message = '입금 확인 권한이 없습니다.';
  end if;
  if p_order_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = '확인할 입금 주문 정보를 선택해 주세요.';
  end if;

  select manual_orders.product_id into v_product_id
  from public.manual_transfer_orders as manual_orders
  where manual_orders.id = p_order_id;
  if v_product_id is null then
    raise exception using errcode = 'P0002', message = '입금 확인 주문을 찾지 못했습니다.';
  end if;

  perform 1 from public.products as products
  where products.id = v_product_id
  for update;

  select manual_orders.* into v_order
  from public.manual_transfer_orders as manual_orders
  where manual_orders.id = p_order_id
  for update;
  if v_order.id is null or v_order.product_id <> v_product_id then
    raise exception using errcode = 'P0002', message = '입금 확인 주문을 찾지 못했습니다.';
  end if;
  if not exists (
    select 1
    from public.products as products
    where products.id = v_order.product_id
      and products.status = 'closed'
  ) then
    raise exception using errcode = '55000', message = '마감된 경매 상품만 입금 확정할 수 있습니다.';
  end if;
  if not public.is_owner()
    and public.is_owner_hidden_test_member(v_order.buyer_id)
  then
    raise exception using errcode = '42501', message = '확인할 수 없는 입금 주문입니다.';
  end if;
  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = '다른 운영자가 주문을 먼저 변경했습니다. 목록을 새로고침해 주세요.';
  end if;
  if v_order.status <> 'awaiting_manual_transfer' then
    raise exception using errcode = '55000', message = '이미 처리된 입금 주문입니다.';
  end if;

  perform orders.id
  from public.payment_orders as orders
  where orders.product_id = v_order.product_id
  for update;

  select bids.bidder_id, bids.amount into v_winner_id, v_winning_amount
  from public.auction_bids as bids
  where bids.product_id = v_order.product_id
  order by bids.amount desc, bids.created_at desc, bids.id desc
  limit 1;
  if v_order.buyer_id is null
    or v_winner_id is null
    or v_winner_id <> v_order.buyer_id
    or v_winning_amount is null
    or v_winning_amount <> v_order.expected_amount
  then
    raise exception using errcode = '22000', message = '낙찰자 또는 입금 금액 검증에 실패했습니다.';
  end if;
  if exists (
    select 1 from public.payment_orders as orders
    where orders.product_id = v_order.product_id
      and orders.payment_status = '결제완료'
      and orders.portone_status = 'PAID'
  ) then
    raise exception using errcode = '55000', message = 'PG 결제가 이미 완료된 상품입니다.';
  end if;

  if public.is_owner_hidden_test_member(v_order.buyer_id) then
    perform set_config('app.owner_hidden_test_actor', v_actor::text, true);
  end if;

  update public.manual_transfer_orders as manual_orders
  set
    status = 'confirmed',
    confirmed_at = clock_timestamp(),
    confirmed_by = auth.uid()
  where manual_orders.id = v_order.id
  returning * into v_order;

  if public.is_owner_hidden_test_member(v_order.buyer_id) then
    perform public.insert_owner_hidden_test_member_audit(
      v_actor,
      v_order.buyer_id,
      'test_member.manual_transfer_confirmed',
      jsonb_build_object(
        'manual_transfer_order_id', v_order.id,
        'product_id', v_order.product_id,
        'expected_amount', v_order.expected_amount
      )
    );
  end if;

  return query select
    v_order.id,
    v_order.product_id,
    v_order.status,
    v_order.confirmed_at,
    v_order.updated_at,
    true;
end;
$$;

revoke all on function public.confirm_manual_transfer(uuid, timestamptz)
from public, anon;
grant execute on function public.confirm_manual_transfer(uuid, timestamptz)
to authenticated;

-- Member projection: no bank data is returned here. The number is disclosed
-- only by begin_manual_transfer after current winner/amount validation.
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
  portone_status text,
  manual_transfer_order_id uuid,
  manual_transfer_status text,
  manual_transfer_requested_at timestamptz,
  manual_transfer_confirmed_at timestamptz,
  is_payment_settled boolean,
  active_payment_mode text
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
    case
      when orders.portone_status = 'PAID' then '결제완료'
      when manual_orders.status = 'confirmed' then '결제완료'
      else coalesce(orders.payment_status, '대기중')
    end,
    orders.requested_method,
    orders.portone_status,
    manual_orders.id,
    manual_orders.status,
    manual_orders.requested_at,
    manual_orders.confirmed_at,
    app_private.is_product_payment_settled(products.id, v_user_id),
    settings.active_mode
  from public.products as products
  join lateral (
    select bids.bidder_id, bids.amount
    from public.auction_bids as bids
    where bids.product_id = products.id
    order by bids.amount desc, bids.created_at desc, bids.id desc
    limit 1
  ) as winner on true
  cross join public.payment_runtime_settings as settings
  left join public.shipping_request_items as items
    on items.product_id = products.id
  left join public.shipping_requests as requests
    on requests.id = items.request_id
  left join public.payment_orders as orders
    on orders.product_id = products.id and orders.buyer_id = v_user_id
  left join public.manual_transfer_orders as manual_orders
    on manual_orders.product_id = products.id and manual_orders.buyer_id = v_user_id
  where winner.bidder_id = v_user_id
    and products.status = 'closed'
    and settings.singleton
  order by products.closes_at desc, products.id;
end;
$$;

revoke all on function public.get_my_won_products() from public, anon;
grant execute on function public.get_my_won_products() to authenticated;

drop function if exists public.get_owner_hidden_test_won_products();
create function public.get_owner_hidden_test_won_products()
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
  portone_status text,
  manual_transfer_order_id uuid,
  manual_transfer_status text,
  manual_transfer_requested_at timestamptz,
  manual_transfer_confirmed_at timestamptz,
  is_payment_settled boolean,
  active_payment_mode text
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
  if v_owner is null or not public.is_owner() then
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
    case
      when orders.portone_status = 'PAID' then '결제완료'
      when manual_orders.status = 'confirmed' then '결제완료'
      else coalesce(orders.payment_status, '대기중')
    end,
    orders.requested_method,
    orders.portone_status,
    manual_orders.id,
    manual_orders.status,
    manual_orders.requested_at,
    manual_orders.confirmed_at,
    app_private.is_product_payment_settled(products.id, v_test_user),
    settings.active_mode
  from public.products as products
  join lateral (
    select bids.bidder_id, bids.amount
    from public.auction_bids as bids
    where bids.product_id = products.id
    order by bids.amount desc, bids.created_at desc, bids.id desc
    limit 1
  ) as winner on true
  cross join public.payment_runtime_settings as settings
  left join public.shipping_request_items as items
    on items.product_id = products.id
  left join public.shipping_requests as requests
    on requests.id = items.request_id
  left join public.payment_orders as orders
    on orders.product_id = products.id and orders.buyer_id = v_test_user
  left join public.manual_transfer_orders as manual_orders
    on manual_orders.product_id = products.id and manual_orders.buyer_id = v_test_user
  where winner.bidder_id = v_test_user
    and products.status = 'closed'
    and settings.singleton
  order by products.closes_at desc, products.id;
end;
$$;

revoke all on function public.get_owner_hidden_test_won_products()
from public, anon;
grant execute on function public.get_owner_hidden_test_won_products()
to authenticated;

-- Shipping accepts only an exact PAID PortOne order or an operator-confirmed
-- manual transfer. PARTIAL_CANCELLED deliberately remains unsettled.
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
  select count(distinct product_id) into v_distinct_count
  from unnest(p_product_ids) as selected(product_id);
  if v_distinct_count <> cardinality(p_product_ids) then
    raise exception using errcode = '22023', message = '중복된 상품 선택이 있습니다.';
  end if;

  select accounts.shipping_credit_count into v_credit_count
  from public.member_accounts as accounts
  where accounts.member_id = v_user_id
  for update;
  if v_credit_count is null or v_credit_count < 1 then
    raise exception using errcode = 'P0001', message = '택배 가능 횟수가 부족합니다.';
  end if;
  select addresses.* into v_address
  from public.shipping_addresses as addresses
  where addresses.id = p_address_id and addresses.member_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = '선택한 배송지를 찾을 수 없습니다.';
  end if;

  perform 1 from public.products as products
  where products.id = any(p_product_ids)
  order by products.id
  for update;
  perform orders.id from public.payment_orders as orders
  where orders.product_id = any(p_product_ids) and orders.buyer_id = v_user_id
  order by orders.product_id for update;
  perform manual_orders.id from public.manual_transfer_orders as manual_orders
  where manual_orders.product_id = any(p_product_ids) and manual_orders.buyer_id = v_user_id
  order by manual_orders.product_id for update;

  select count(*) into v_valid_count
  from public.products as products
  join lateral (
    select bids.bidder_id from public.auction_bids as bids
    where bids.product_id = products.id
    order by bids.amount desc, bids.created_at desc, bids.id desc limit 1
  ) as winner on true
  where products.id = any(p_product_ids)
    and products.status = 'closed'
    and winner.bidder_id = v_user_id
    and app_private.is_product_payment_settled(products.id, v_user_id)
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
    v_user_id,
    v_address.id,
    jsonb_build_object(
      'label', v_address.label,
      'recipientName', v_address.recipient_name,
      'phone', v_address.phone,
      'postalCode', v_address.postal_code,
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
  if v_owner is null or not public.is_owner() then
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
  where accounts.member_id = v_test_user and accounts.account_status = 'active'
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

  perform 1 from public.products as products
  where products.id = any(p_product_ids)
  order by products.id for update;
  perform orders.id from public.payment_orders as orders
  where orders.product_id = any(p_product_ids) and orders.buyer_id = v_test_user
  order by orders.product_id for update;
  perform manual_orders.id from public.manual_transfer_orders as manual_orders
  where manual_orders.product_id = any(p_product_ids) and manual_orders.buyer_id = v_test_user
  order by manual_orders.product_id for update;

  select count(*) into v_valid_count
  from public.products as products
  join lateral (
    select bids.bidder_id from public.auction_bids as bids
    where bids.product_id = products.id
    order by bids.amount desc, bids.created_at desc, bids.id desc limit 1
  ) as winner on true
  where products.id = any(p_product_ids)
    and products.status = 'closed'
    and winner.bidder_id = v_test_user
    and app_private.is_product_payment_settled(products.id, v_test_user)
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
      'postalCode', v_address.postal_code,
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
