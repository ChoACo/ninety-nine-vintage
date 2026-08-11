begin;

set local lock_timeout = '10s';

-- Owner cancellation is an explicit, audited operation for an unpaid fixed-price
-- checkout. It must not be represented as a receipt reversal: there is no money
-- to reverse when the ledger balance is zero.
alter table public.commerce_order_transfers
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_reason text;

create table public.manual_transfer_cancellation_events (
  id uuid primary key default gen_random_uuid(),
  payment_kind text not null check (payment_kind = 'commerce'),
  payment_id uuid not null references public.commerce_order_transfers(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  previous_status text not null,
  expected_version bigint not null check (expected_version >= 0),
  expected_received_amount bigint not null check (expected_received_amount = 0),
  expected_ledger_entry_count integer not null check (expected_ledger_entry_count = 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (actor_user_id, idempotency_key)
);

alter table public.manual_transfer_cancellation_events enable row level security;
alter table public.manual_transfer_cancellation_events force row level security;
revoke all on table public.manual_transfer_cancellation_events
from public, anon, authenticated, service_role;
grant select on table public.manual_transfer_cancellation_events to authenticated, service_role;
create policy "Owners read manual transfer cancellation events"
on public.manual_transfer_cancellation_events
for select to authenticated
using (public.is_owner());
create policy "Service reads manual transfer cancellation events"
on public.manual_transfer_cancellation_events
for select to service_role
using (true);

create or replace function public.cancel_owner_pending_manual_payment(
  p_payment_kind text,
  p_payment_id uuid,
  p_expected_version bigint,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_transfer public.commerce_order_transfers%rowtype;
  v_order public.commerce_orders%rowtype;
  v_event public.manual_transfer_cancellation_events%rowtype;
  v_order_id uuid;
  v_received bigint;
  v_entry_count integer;
  v_version bigint;
  v_now timestamptz := clock_timestamp();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_fingerprint text;
  v_result jsonb;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_payment_kind <> 'commerce'
    or p_payment_id is null
    or p_expected_version is null
    or p_expected_version < 0
    or p_expected_received_amount is distinct from 0
    or p_expected_ledger_entry_count is distinct from 0
    or p_idempotency_key is null
    or char_length(v_reason) not between 3 and 500
  then
    raise exception using errcode = '22023', message = '입금 요청 취소 입력값을 확인해 주세요.';
  end if;

  v_fingerprint := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'kind', p_payment_kind,
    'id', p_payment_id,
    'version', p_expected_version,
    'received', p_expected_received_amount,
    'entries', p_expected_ledger_entry_count,
    'reason', v_reason
  ));

  select * into v_event
  from public.manual_transfer_cancellation_events
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_event.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = '동일한 취소 요청 키를 다른 내용으로 재사용할 수 없습니다.';
    end if;
    return v_event.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select order_id into v_order_id
  from public.commerce_order_transfers
  where id = p_payment_id;
  if v_order_id is null then
    raise exception using errcode = 'P0002', message = '입금 요청을 찾을 수 없습니다.';
  end if;

  select * into v_order
  from public.commerce_orders
  where id = v_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '주문을 찾을 수 없습니다.';
  end if;

  select * into v_transfer
  from public.commerce_order_transfers
  where id = p_payment_id and order_id = v_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '입금 요청을 찾을 수 없습니다.';
  end if;
  if v_transfer.version is distinct from p_expected_version then
    raise exception using errcode = 'PT409', message = '입금 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_transfer.status <> 'awaiting_transfer' or v_order.status <> 'awaiting_payment' then
    raise exception using errcode = '55000', message = '입금액이 없고 결제 대기 중인 주문만 취소할 수 있습니다.';
  end if;

  select coalesce(sum(case when entry_type = 'receipt' then amount else -amount end), 0)::bigint,
         count(*)::integer
  into v_received, v_entry_count
  from public.manual_transfer_payment_ledger
  where commerce_order_transfer_id = v_transfer.id;
  if v_received <> p_expected_received_amount or v_entry_count <> p_expected_ledger_entry_count then
    raise exception using errcode = 'PT409', message = '입금 원장이 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_received <> 0 or v_entry_count <> 0 then
    raise exception using errcode = '55000', message = '입금액이 있는 주문은 취소 전에 환불 절차를 확인해야 합니다.';
  end if;
  if exists (
    select 1
    from public.customer_inventory_items
    where commerce_order_item_id in (
      select id from public.commerce_order_items where order_id = v_order.id
    )
  ) then
    raise exception using errcode = '55000', message = '이미 보관 권리가 생성된 주문은 입금 요청 취소를 사용할 수 없습니다.';
  end if;

  update public.commerce_order_transfers
  set status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = v_actor,
      cancellation_reason = v_reason
  where id = v_transfer.id;

  update public.commerce_order_items
  set payment_status = 'cancelled', paid_at = null, storage_expires_at = null
  where order_id = v_order.id and payment_status = 'awaiting_payment';

  update public.commerce_orders
  set status = 'cancelled', updated_at = v_now
  where id = v_order.id and status = 'awaiting_payment';

  -- Checkout closes fixed-price products to reserve them. Release only those
  -- still closed and never entitled to inventory; never reopen a later state.
  update public.products
  set status = 'active', updated_at = v_now
  where id in (
    select product_id from public.commerce_order_items where order_id = v_order.id
  )
    and sale_type = 'fixed'
    and status = 'closed'
    and not exists (
      select 1
      from public.customer_inventory_items inventory
      where inventory.product_id = public.products.id
    );

  select version into v_version
  from public.commerce_order_transfers
  where id = v_transfer.id;

  v_result := jsonb_build_object(
    'payment_kind', 'commerce',
    'payment_id', v_transfer.id,
    'status', 'cancelled',
    'received_amount', 0,
    'remaining_amount', v_transfer.expected_amount,
    'ledger_entry_count', 0,
    'version', v_version,
    'idempotent_replay', false
  );

  insert into public.manual_transfer_cancellation_events(
    payment_kind, payment_id, actor_user_id, idempotency_key,
    request_fingerprint, previous_status, expected_version,
    expected_received_amount, expected_ledger_entry_count, reason, result
  ) values (
    'commerce', v_transfer.id, v_actor, p_idempotency_key,
    v_fingerprint, 'awaiting_transfer', p_expected_version,
    0, 0, v_reason, v_result
  );

  perform app_private.insert_targeted_notification(
    v_order.member_id,
    'member',
    'payment_cancelled',
    '입금 요청이 취소되었습니다.',
    '소유자가 결제 대기 주문을 취소했습니다. 다시 구매하려면 상품을 새로 선택해 주세요.',
    '/account/orders'
  );

  return v_result;
end;
$$;

revoke all on function public.cancel_owner_pending_manual_payment(text, uuid, bigint, bigint, integer, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.cancel_owner_pending_manual_payment(text, uuid, bigint, bigint, integer, uuid, text)
to authenticated;

comment on function public.cancel_owner_pending_manual_payment(text, uuid, bigint, bigint, integer, uuid, text) is
  'Owner-only unilateral cancellation for an unpaid fixed-price manual-transfer checkout; partial receipts require refund review.';

commit;
