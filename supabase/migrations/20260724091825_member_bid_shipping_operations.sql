begin;

-- A shipment remains the immutable settlement/fulfillment record.  This small
-- projection is the operator-facing delivery-completion history and is the
-- only data that is purged after the requested 30-day recognition window.
alter table public.inventory_shipments
  add column if not exists delivery_completed_at timestamptz;

create index if not exists inventory_shipments_delivery_transition_idx
  on public.inventory_shipments (shipped_at, id)
  where status = 'shipped' and delivery_completed_at is null;

create table if not exists public.inventory_delivery_history (
  shipment_id uuid primary key,
  member_id uuid not null,
  member_name text not null,
  courier text not null,
  tracking_number text not null,
  item_count integer not null check (item_count > 0),
  product_summaries jsonb not null
    check (jsonb_typeof(product_summaries) = 'array'),
  shipped_at timestamptz not null,
  completed_at timestamptz not null,
  purge_after timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (completed_at >= shipped_at + interval '7 days'),
  check (purge_after >= completed_at + interval '30 days')
);

create index if not exists inventory_delivery_history_purge_idx
  on public.inventory_delivery_history (purge_after, shipment_id);

alter table public.inventory_delivery_history enable row level security;
alter table public.inventory_delivery_history force row level security;
revoke all on table public.inventory_delivery_history
from public, anon, authenticated;

create or replace function public.refresh_inventory_delivery_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived integer := 0;
  v_purged integer := 0;
begin
  insert into public.inventory_delivery_history (
    shipment_id,
    member_id,
    member_name,
    courier,
    tracking_number,
    item_count,
    product_summaries,
    shipped_at,
    completed_at,
    purge_after
  )
  select
    shipments.id,
    shipments.member_id,
    profiles.display_name,
    shipments.courier,
    shipments.tracking_number,
    count(items.inventory_item_id)::integer,
    jsonb_agg(
      jsonb_build_object(
        'productId', items.product_id,
        'title', products.title,
        'imageUrl', coalesce(products.image_urls[1], '')
      )
      order by items.created_at, items.inventory_item_id
    ),
    shipments.shipped_at,
    shipments.shipped_at + interval '7 days',
    shipments.shipped_at + interval '37 days'
  from public.inventory_shipments shipments
  join public.profiles profiles on profiles.id = shipments.member_id
  join public.inventory_shipment_items items
    on items.shipment_id = shipments.id
   and items.line_status not in ('excluded', 'cancelled')
  join public.products products on products.id = items.product_id
  where shipments.status = 'shipped'
    and shipments.delivery_completed_at is null
    and shipments.shipped_at <= clock_timestamp() - interval '7 days'
  group by
    shipments.id,
    shipments.member_id,
    profiles.display_name,
    shipments.courier,
    shipments.tracking_number,
    shipments.shipped_at
  on conflict (shipment_id) do nothing;

  get diagnostics v_archived = row_count;

  update public.inventory_shipments
  set
    delivery_completed_at = shipped_at + interval '7 days',
    updated_at = clock_timestamp()
  where status = 'shipped'
    and delivery_completed_at is null
    and shipped_at <= clock_timestamp() - interval '7 days';

  delete from public.inventory_delivery_history
  where purge_after <= clock_timestamp();

  get diagnostics v_purged = row_count;

  return jsonb_build_object('archived', v_archived, 'purged', v_purged);
end;
$$;

revoke all on function public.refresh_inventory_delivery_history()
from public, anon, authenticated, service_role;
grant execute on function public.refresh_inventory_delivery_history()
to service_role;

-- Reading the queue also catches up the transition immediately.  pg_cron keeps
-- it progressing even when no operator has the page open.
do $$
declare
  v_job_id bigint;
begin
  if exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    for v_job_id in
      select jobid from cron.job
      where jobname = 'inventory-delivery-retention'
    loop
      perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
      'inventory-delivery-retention',
      '15 * * * *',
      'select public.refresh_inventory_delivery_history();'
    );
  end if;
end;
$$;

-- Once any non-cancelled delivery line exists, the product belongs to shipping
-- work/history rather than the member-storage work list.
create or replace function public.get_operator_member_storage(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select
      items.id,
      items.member_id,
      profiles.display_name as member_name,
      items.product_id,
      products.title,
      coalesce(products.image_urls[1], '') as image_url,
      items.origin_store_id,
      stores.name as store_name,
      fulfillments.outbound_released,
      items.storage_started_at,
      items.storage_expires_at,
      items.paid_at
    from public.customer_inventory_items items
    join public.profiles profiles on profiles.id = items.member_id
    join public.products products on products.id = items.product_id
    join public.stores stores on stores.id = items.origin_store_id
    join public.inventory_item_fulfillments fulfillments
      on fulfillments.inventory_item_id = items.id
    where items.ownership_status = 'active'
      and public.can_view_shared_fulfillment()
      and not exists (
        select 1
        from public.inventory_shipment_items shipment_items
        where shipment_items.inventory_item_id = items.id
          and shipment_items.line_status not in ('excluded', 'cancelled')
      )
  ),
  paged as (
    select *
    from visible
    order by paid_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', id,
      'memberId', member_id,
      'memberName', member_name,
      'productId', product_id,
      'title', title,
      'imageUrl', image_url,
      'originStoreId', origin_store_id,
      'originStoreName', store_name,
      'fulfillmentStatus', case
        when outbound_released then 'stored'
        else 'waiting_outbound'
      end,
      'shipmentRequested', false,
      'storageStartedAt', storage_started_at,
      'storageExpiresAt', storage_expires_at
    ) order by paid_at desc, id desc), '[]'::jsonb),
    'hasMore', (select count(*) from visible) >
      greatest(coalesce(p_offset, 0), 0)
      + greatest(1, least(coalesce(p_limit, 100), 200))
  )
  from paged;
$$;

revoke all on function public.get_operator_member_storage(integer, integer)
from public, anon, service_role;
grant execute on function public.get_operator_member_storage(integer, integer)
to authenticated;

create or replace function public.get_inventory_shipment_queue(
  p_include_shipped boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipments jsonb;
  v_completed jsonb;
begin
  if not public.can_view_shared_fulfillment() then
    raise exception using
      errcode = '42501',
      message = '택배 신청 조회 권한이 없습니다.';
  end if;

  perform public.refresh_inventory_delivery_history();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', shipments.id,
    'memberId', shipments.member_id,
    'memberName', profiles.display_name,
    'businessId', shipments.business_id,
    'status', shipments.status,
    'version', shipments.version,
    'settlementMethod', shipments.settlement_method,
    'shippingFeeStatus', case
      when shipments.settlement_method = 'manual_transfer' then payments.status
      else 'confirmed'
    end,
    'requestedAt', shipments.created_at,
    'packedAt', shipments.packed_at,
    'shippedAt', shipments.shipped_at,
    'courier', shipments.courier,
    'trackingNumber', shipments.tracking_number,
    'addressSnapshot', shipments.address_snapshot,
    'itemCount', (
      select count(*)
      from public.inventory_shipment_items x
      where x.shipment_id = shipments.id
    ),
    'activeItemCount', (
      select count(*)
      from public.inventory_shipment_items x
      where x.shipment_id = shipments.id
        and x.line_status not in ('excluded', 'cancelled')
    ),
    'releasedItemCount', (
      select count(*)
      from public.inventory_shipment_items x
      join public.inventory_item_fulfillments f
        on f.inventory_item_id = x.inventory_item_id
      where x.shipment_id = shipments.id
        and x.line_status not in ('excluded', 'cancelled')
        and f.outbound_released
    ),
    'unreleasedItemCount', (
      select count(*)
      from public.inventory_shipment_items x
      join public.inventory_item_fulfillments f
        on f.inventory_item_id = x.inventory_item_id
      where x.shipment_id = shipments.id
        and x.line_status not in ('excluded', 'cancelled')
        and not f.outbound_released
    ),
    'heldItemCount', (
      select count(*)
      from public.inventory_shipment_items x
      where x.shipment_id = shipments.id and x.line_status = 'held'
    ),
    'storeWorks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', works.id,
        'storeId', works.origin_store_id,
        'storeName', stores.name,
        'status', works.status,
        'version', works.version
      ) order by stores.name, works.origin_store_id), '[]'::jsonb)
      from public.inventory_shipment_store_works works
      join public.stores stores on stores.id = works.origin_store_id
      where works.shipment_id = shipments.id
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'inventoryItemId', shipment_items.inventory_item_id,
        'productId', shipment_items.product_id,
        'title', products.title,
        'imageUrl', coalesce(products.image_urls[1], ''),
        'lineStatus', shipment_items.line_status,
        'released', fulfillments.outbound_released,
        'originStoreId', shipment_items.origin_store_id,
        'originStoreName', stores.name,
        'isBlocked', fulfillments.is_blocked
      ) order by stores.name, shipment_items.created_at, shipment_items.inventory_item_id), '[]'::jsonb)
      from public.inventory_shipment_items shipment_items
      join public.products products on products.id = shipment_items.product_id
      join public.inventory_item_fulfillments fulfillments
        on fulfillments.inventory_item_id = shipment_items.inventory_item_id
      join public.stores stores on stores.id = shipment_items.origin_store_id
      where shipment_items.shipment_id = shipments.id
    )
  ) order by shipments.created_at desc, shipments.id desc), '[]'::jsonb)
  into v_shipments
  from (
    select *
    from public.inventory_shipments
    where delivery_completed_at is null
      and (p_include_shipped or status <> 'shipped')
    order by created_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(coalesce(p_offset, 0), 0)
  ) shipments
  join public.profiles profiles on profiles.id = shipments.member_id
  left join public.shipping_fee_payments payments
    on payments.id = shipments.shipping_fee_payment_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shipmentId', history.shipment_id,
    'memberId', history.member_id,
    'memberName', history.member_name,
    'courier', history.courier,
    'trackingNumber', history.tracking_number,
    'itemCount', history.item_count,
    'products', history.product_summaries,
    'shippedAt', history.shipped_at,
    'completedAt', history.completed_at,
    'purgeAfter', history.purge_after
  ) order by history.completed_at desc, history.shipment_id desc), '[]'::jsonb)
  into v_completed
  from (
    select *
    from public.inventory_delivery_history
    order by completed_at desc, shipment_id desc
    limit 500
  ) history;

  return jsonb_build_object(
    'shipments', coalesce(v_shipments, '[]'::jsonb),
    'completedDeliveries', coalesce(v_completed, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_inventory_shipment_queue(boolean, integer, integer)
from public, anon, service_role;
grant execute on function public.get_inventory_shipment_queue(boolean, integer, integer)
to authenticated;

-- Store the depositor name with standalone credit requests so operators and the
-- member see the same request identity.
alter table public.shipping_fee_payments
  add column if not exists depositor_name text;

alter table public.shipping_fee_payments
  drop constraint if exists shipping_fee_payments_depositor_name_check;
alter table public.shipping_fee_payments
  add constraint shipping_fee_payments_depositor_name_check
  check (
    depositor_name is null
    or char_length(btrim(depositor_name)) between 1 and 80
  );

alter table public.inventory_command_receipts
  drop constraint if exists inventory_command_receipts_command_name_check;
alter table public.inventory_command_receipts
  add constraint inventory_command_receipts_command_name_check
  check (command_name in (
    'confirm_payment',
    'request_shipment',
    'release_store_items',
    'center_receive',
    'center_store',
    'pack_shipment',
    'ship_shipment',
    'open_exception',
    'resolve_exception',
    'submit_refund_account',
    'review_refund',
    'refund_account_access',
    'append_exception_evidence',
    'configure_rollout',
    'review_shipping_fee_refund',
    'reconcile_inventory_item',
    'release_paid_items',
    'submit_shipping_fee_refund_account',
    'shipping_fee_refund_account_access',
    'configure_center_assignment',
    'revise_tracking',
    'cancel_shipping_credit_payment'
  ));

create or replace function public.request_my_shipping_credit_payment(
  p_quantity integer,
  p_depositor_name text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_depositor_name, ''));
  v_business uuid;
  v_unit_amount bigint;
  v_bank_name text;
  v_account_number text;
  v_payment public.shipping_fee_payments%rowtype;
begin
  if v_actor is null or not public.is_member() then
    raise exception using errcode = '42501', message = '회원 로그인이 필요합니다.';
  end if;
  if p_quantity is null or p_quantity not between 1 and 20
    or char_length(v_name) not between 1 and 80
    or p_idempotency_key is null
  then
    raise exception using errcode = '22023', message = '배송 크레딧 신청 정보를 확인해 주세요.';
  end if;

  select settings.business_id, settings.shipping_fee_amount
  into v_business, v_unit_amount
  from public.inventory_fulfillment_rollout_settings settings
  where settings.shipping_fee_amount > 0
  order by settings.shipping_fee_amount desc, settings.business_id
  limit 1;

  select settings.bank_name, settings.account_number
  into v_bank_name, v_account_number
  from public.payment_runtime_settings settings
  where settings.singleton and settings.active_mode = 'manual_transfer';

  if v_business is null or v_unit_amount is null
    or v_bank_name is null or v_account_number is null
  then
    raise exception using errcode = '55000', message = '배송비 입금 설정이 없습니다.';
  end if;

  select *
  into v_payment
  from public.shipping_fee_payments payments
  where payments.member_id = v_actor
    and payments.idempotency_key = p_idempotency_key::text;

  if found then
    if v_payment.payment_context <> 'shipping_credit'
      or v_payment.credit_quantity <> p_quantity
      or v_payment.expected_amount <> v_unit_amount * p_quantity
      or coalesce(v_payment.depositor_name, '') <> v_name
    then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return to_jsonb(v_payment) || jsonb_build_object('unit_amount', v_unit_amount);
  end if;

  insert into public.shipping_fee_payments (
    member_id,
    business_id,
    expected_amount,
    bank_name_snapshot,
    account_number_snapshot,
    idempotency_key,
    credit_quantity,
    payment_context,
    depositor_name
  )
  values (
    v_actor,
    v_business,
    v_unit_amount * p_quantity,
    btrim(v_bank_name),
    btrim(v_account_number),
    p_idempotency_key::text,
    p_quantity,
    'shipping_credit',
    v_name
  )
  returning * into v_payment;

  update public.member_accounts
  set last_depositor_name = v_name
  where member_id = v_actor;

  return to_jsonb(v_payment) || jsonb_build_object('unit_amount', v_unit_amount);
end;
$$;

revoke all on function public.request_my_shipping_credit_payment(integer, text, uuid)
from public, anon, service_role;
grant execute on function public.request_my_shipping_credit_payment(integer, text, uuid)
to authenticated;

create or replace function public.cancel_my_shipping_credit_payment(
  p_payment_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payment public.shipping_fee_payments%rowtype;
  v_receipt public.inventory_command_receipts%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if v_actor is null or not public.is_member() or p_idempotency_key is null then
    raise exception using errcode = '42501', message = '회원 로그인이 필요합니다.';
  end if;

  v_fingerprint := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'paymentId', p_payment_id,
    'version', p_expected_version,
    'action', 'member_cancel_shipping_credit'
  ));

  select *
  into v_receipt
  from public.inventory_command_receipts receipts
  where receipts.actor_user_id = v_actor
    and receipts.idempotency_key = p_idempotency_key;

  if found then
    if v_receipt.command_name <> 'cancel_shipping_credit_payment'
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select *
  into v_payment
  from public.shipping_fee_payments payments
  where payments.id = p_payment_id
    and payments.member_id = v_actor
    and payments.payment_context = 'shipping_credit'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '배송 크레딧 결제 신청을 찾지 못했습니다.';
  end if;
  if v_payment.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = '결제 신청 상태가 변경되었습니다.';
  end if;
  if v_payment.status <> 'awaiting_transfer'
    or exists (
      select 1
      from public.manual_transfer_payment_ledger ledger
      where ledger.shipping_fee_payment_id = v_payment.id
    )
  then
    raise exception using errcode = '55000', message = '입금 처리 전 신청만 직접 취소할 수 있습니다.';
  end if;

  update public.shipping_fee_payments
  set status = 'cancelled', version = version + 1
  where id = v_payment.id
  returning * into v_payment;

  v_result := jsonb_build_object(
    'id', v_payment.id,
    'status', v_payment.status,
    'version', v_payment.version,
    'idempotent_replay', false
  );

  insert into public.inventory_command_receipts (
    actor_user_id,
    idempotency_key,
    command_name,
    target_id,
    request_fingerprint,
    result
  )
  values (
    v_actor,
    p_idempotency_key,
    'cancel_shipping_credit_payment',
    v_payment.id,
    v_fingerprint,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.cancel_my_shipping_credit_payment(uuid, bigint, uuid)
from public, anon, service_role;
grant execute on function public.cancel_my_shipping_credit_payment(uuid, bigint, uuid)
to authenticated;

commit;
