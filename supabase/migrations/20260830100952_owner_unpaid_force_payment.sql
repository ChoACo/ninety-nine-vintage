-- Owner-only recovery path for an expired auction winner. The public entry
-- point accepts an offer instead of a pre-existing confirmation request,
-- reopens (or creates) the single-order request, and delegates the monetary,
-- inventory, sanction, and settlement work to the canonical force-confirm
-- function introduced in 20260826221618.
create or replace function public.owner_force_confirm_unpaid_auction_offer(
  p_offer_id uuid,
  p_depositor_name text,
  p_include_in_settlement boolean,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_name text := btrim(coalesce(p_depositor_name, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_disposition text := case when p_include_in_settlement then 'included' else 'excluded' end;
  v_offer public.auction_purchase_offers%rowtype;
  v_order public.manual_transfer_orders%rowtype;
  v_product public.products%rowtype;
  v_request public.auction_payment_confirmation_requests%rowtype;
  v_existing public.owner_forced_payment_confirmations%rowtype;
  v_batch_key text;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_offer_id is null or p_idempotency_key is null
    or p_include_in_settlement is null
    or char_length(v_name) not between 1 and 80
    or char_length(v_reason) not between 3 and 500
  then
    raise exception using errcode = '22023', message = '강제 결제완료 처리값을 확인해 주세요.';
  end if;

  -- Preserve idempotency even after the first execution changed the offer and
  -- order out of the unpaid states checked below.
  select confirmations.* into v_existing
  from public.owner_forced_payment_confirmations as confirmations
  where confirmations.actor_owner_id = v_actor
    and confirmations.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.depositor_name <> v_name
      or v_existing.settlement_disposition <> v_disposition
      or v_existing.reason <> v_reason
      or not exists (
        select 1
        from public.manual_transfer_orders as orders
        where orders.id = any(v_existing.order_ids)
          and orders.purchase_offer_id = p_offer_id
      )
    then
      raise exception using errcode = '23505', message = '같은 요청 키를 다른 강제 결제완료에 재사용할 수 없습니다.';
    end if;
    return v_existing.result || jsonb_build_object('idempotentReplay', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owner-force-unpaid-offer:' || p_offer_id::text, 0));

  select offers.* into v_offer
  from public.auction_purchase_offers as offers
  where offers.id = p_offer_id
  for update;
  if not found or v_offer.status not in ('payment_due', 'accepted', 'expired_unpaid') then
    raise exception using errcode = '55000', message = '강제 완료할 미결제 낙찰 원장을 찾을 수 없습니다.';
  end if;

  select orders.* into v_order
  from public.manual_transfer_orders as orders
  where orders.purchase_offer_id = v_offer.id
    and orders.product_id = v_offer.product_id
    and orders.buyer_id = v_offer.bidder_id
    and orders.status in ('awaiting_manual_transfer', 'cancelled_unpaid')
  for update;
  if not found then
    raise exception using errcode = '55000', message = '강제 완료할 미결제 주문 원장을 찾을 수 없습니다.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = v_offer.product_id
  for update;
  if not found or v_product.sale_type <> 'auction' or v_product.status <> 'closed' then
    raise exception using errcode = '55000', message = '마감된 경매 상품만 강제 결제완료 처리할 수 있습니다.';
  end if;
  if exists (
    select 1 from public.auction_purchase_offers as offers
    where offers.product_id = v_product.id
      and offers.id <> v_offer.id
      and offers.status = 'settled'
  ) then
    raise exception using errcode = '55000', message = '다른 낙찰자의 결제가 이미 완료된 상품입니다.';
  end if;

  v_batch_key := md5(v_order.buyer_id::text || ':' || v_order.id::text);
  select requests.* into v_request
  from public.auction_payment_confirmation_requests as requests
  where requests.batch_key = v_batch_key
  for update;

  if found then
    if v_request.member_id <> v_order.buyer_id
      or v_request.order_ids <> array[v_order.id]::uuid[]
    then
      raise exception using errcode = '55000', message = '기존 입금 확인 묶음과 낙찰 주문이 일치하지 않습니다.';
    end if;
    update public.auction_payment_confirmation_requests
    set request_kind = 'system_reconciliation',
        shipping_fee_payment_id = null,
        expected_amount = v_order.expected_amount,
        depositor_name = v_name,
        status = 'open',
        last_requested_at = v_now,
        original_due_at = coalesce(v_order.display_due_at, v_order.due_at),
        review_due_at = null,
        resolved_at = null,
        resolution = null,
        version = version + 1
    where id = v_request.id
    returning * into v_request;
  else
    insert into public.auction_payment_confirmation_requests (
      member_id, batch_key, request_kind, order_ids,
      shipping_fee_payment_id, expected_amount, depositor_name,
      first_requested_at, last_requested_at, original_due_at, review_due_at
    ) values (
      v_order.buyer_id, v_batch_key, 'system_reconciliation', array[v_order.id]::uuid[],
      null, v_order.expected_amount, v_name,
      v_now, v_now, coalesce(v_order.display_due_at, v_order.due_at), null
    )
    returning * into v_request;
  end if;

  insert into public.auction_payment_confirmation_request_events (
    request_id, event_kind, actor_user_id, metadata
  ) values (
    v_request.id, 'detected', v_actor,
    jsonb_build_object(
      'source', 'owner_unpaid_auction_console',
      'offerId', v_offer.id,
      'orderId', v_order.id,
      'reason', v_reason
    )
  );

  return public.owner_force_confirm_auction_payment_request(
    v_request.id,
    v_request.version,
    v_name,
    p_include_in_settlement,
    v_reason,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.owner_force_confirm_unpaid_auction_offer(uuid,text,boolean,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.owner_force_confirm_unpaid_auction_offer(uuid,text,boolean,text,uuid)
to authenticated;

comment on function public.owner_force_confirm_unpaid_auction_offer(uuid,text,boolean,text,uuid) is
  'Owner-only fail-closed recovery: force-confirms one expired auction offer and records settlement inclusion.';

-- Private, non-API archive used before a narrowly targeted operational ledger
-- purge. Keeping the immutable snapshot outside public prevents the deleted
-- request from reappearing in any owner/operator queue while retaining recovery
-- evidence for a database administrator.
create table if not exists app_private.owner_operational_ledger_purge_archives (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null check (char_length(btrim(entity_kind)) between 3 and 80),
  entity_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  archived_at timestamptz not null default clock_timestamp(),
  unique (entity_kind, entity_id)
);

revoke all on table app_private.owner_operational_ledger_purge_archives
from public, anon, authenticated, service_role;
