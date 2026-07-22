begin;

-- Item-selected shipments use a shipping-fee payment row too, but their
-- settlement must stay separate from the legacy order-shipment writer.  This
-- private helper records a partial receipt only; even a receipt that fills the
-- full balance remains unconfirmed until the shared confirmation RPC performs
-- its CAS finalisation and financial projection.
create or replace function app_private.record_inventory_shipping_fee_receipt(
  p_payment_id uuid,
  p_amount bigint,
  p_depositor_name text,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_memo text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_key text := lower(btrim(coalesce(p_idempotency_key, '')));
  v_payment public.shipping_fee_payments%rowtype;
  v_existing public.manual_transfer_payment_ledger%rowtype;
  v_ledger_id uuid;
  v_received bigint;
  v_count integer;
begin
  if v_actor is null
    or p_payment_id is null
    or p_amount is null or p_amount < 1 or p_amount > 1000000000
    or p_expected_received_amount is null or p_expected_received_amount < 0
    or p_expected_ledger_entry_count is null or p_expected_ledger_entry_count < 0
    or nullif(btrim(coalesce(p_depositor_name, '')), '') is null
    or char_length(btrim(p_depositor_name)) > 80
    or char_length(btrim(coalesce(p_memo, ''))) > 500
    or v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception using errcode = '22023', message = '배송비 고급 원장 입력값을 확인해 주세요.';
  end if;

  select * into v_payment
  from public.shipping_fee_payments
  where id = p_payment_id
  for update;
  if not found or v_payment.inventory_shipment_id is null then
    raise exception using errcode = 'P0002', message = '선택 상품 배송비 입금 건을 찾지 못했습니다.';
  end if;
  if not app_private.can_confirm_shared_payment(v_payment.business_id) then
    raise exception using errcode = '42501', message = '배송비 원장을 처리할 권한이 없습니다.';
  end if;

  select * into v_existing
  from public.manual_transfer_payment_ledger
  where recorded_by = v_actor
    and idempotency_key = v_key
    and entry_type = 'receipt';
  if found then
    if v_existing.transfer_kind <> 'shipping'
      or v_existing.shipping_fee_payment_id <> p_payment_id
      or v_existing.amount <> p_amount
      or v_existing.depositor_name <> btrim(p_depositor_name)
      or v_existing.memo <> btrim(coalesce(p_memo, ''))
    then
      raise exception using errcode = '23505', message = '동일한 입금 요청 키를 다른 내용으로 재사용할 수 없습니다.';
    end if;
    select coalesce(sum(case when entry_type = 'receipt' then amount else -amount end), 0)::bigint, count(*)::integer
      into v_received, v_count
    from public.manual_transfer_payment_ledger
    where shipping_fee_payment_id = p_payment_id;
    return jsonb_build_object(
      'transfer_kind', 'shipping', 'transfer_id', p_payment_id,
      'ledger_id', v_existing.id, 'received_amount', v_received,
      'remaining_amount', v_payment.expected_amount - v_received,
      'ledger_entry_count', v_count, 'status', v_payment.status,
      'idempotent_replay', true
    );
  end if;

  if v_payment.status not in ('awaiting_transfer', 'partially_paid') then
    raise exception using errcode = '55000', message = '고급 원장을 추가할 수 있는 배송비 상태가 아닙니다.';
  end if;
  select coalesce(sum(case when entry_type = 'receipt' then amount else -amount end), 0)::bigint, count(*)::integer
    into v_received, v_count
  from public.manual_transfer_payment_ledger
  where shipping_fee_payment_id = p_payment_id;
  if v_received <> p_expected_received_amount or v_count <> p_expected_ledger_entry_count then
    raise exception using errcode = 'PT409', message = '다른 운영자가 배송비 원장을 변경했습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_received + p_amount > v_payment.expected_amount then
    raise exception using errcode = '22003', message = '초과 입금은 원장에 기록하기 전에 분리 환불 절차로 조정해 주세요.';
  end if;

  insert into public.manual_transfer_payment_ledger(
    transfer_kind, shipping_fee_payment_id, entry_type, amount,
    depositor_name, memo, recorded_by, idempotency_key
  ) values (
    'shipping', p_payment_id, 'receipt', p_amount,
    btrim(p_depositor_name), btrim(coalesce(p_memo, '')), v_actor, v_key
  ) returning id into v_ledger_id;
  v_received := v_received + p_amount;
  v_count := v_count + 1;
  update public.shipping_fee_payments
  set status = 'partially_paid', version = version + 1
  where id = p_payment_id
  returning * into v_payment;

  return jsonb_build_object(
    'transfer_kind', 'shipping', 'transfer_id', p_payment_id,
    'ledger_id', v_ledger_id, 'received_amount', v_received,
    'remaining_amount', v_payment.expected_amount - v_received,
    'ledger_entry_count', v_count, 'status', v_payment.status,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.record_shipping_fee_payment(
  p_payment_id uuid,
  p_amount bigint,
  p_depositor_name text,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_memo text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payment public.shipping_fee_payments%rowtype;
begin
  select * into v_payment from public.shipping_fee_payments where id = p_payment_id for update;
  if found and v_payment.inventory_shipment_id is not null then
    return app_private.record_inventory_shipping_fee_receipt(
      p_payment_id, p_amount, p_depositor_name, p_expected_received_amount,
      p_expected_ledger_entry_count, p_idempotency_key, p_memo
    );
  end if;
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  return app_private.record_legacy_shipping_fee_payment(
    p_payment_id, p_amount, p_depositor_name, p_expected_received_amount,
    p_expected_ledger_entry_count, p_idempotency_key, p_memo
  );
end;
$$;

create or replace function public.finalize_inventory_shipping_fee_payment(
  p_payment_id uuid,
  p_observed_received_amount bigint,
  p_observed_ledger_entry_count integer,
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
  v_received bigint;
  v_count integer;
  v_receipt public.inventory_command_receipts%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if v_actor is null or p_payment_id is null or p_idempotency_key is null
    or p_observed_received_amount is null or p_observed_received_amount < 0
    or p_observed_ledger_entry_count is null or p_observed_ledger_entry_count < 0
    or p_expected_version is null
  then
    raise exception using errcode = '22023', message = '배송비 확정 입력값을 확인해 주세요.';
  end if;
  v_fingerprint := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'payment', p_payment_id, 'received', p_observed_received_amount,
    'count', p_observed_ledger_entry_count, 'version', p_expected_version
  ));
  select * into v_receipt from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'finalize_shipping_fee_payment'
      or v_receipt.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = '동일한 요청 키를 다른 배송비 확정에 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select * into v_payment from public.shipping_fee_payments
  where id = p_payment_id for update;
  if not found or v_payment.inventory_shipment_id is null
    or v_payment.status not in ('awaiting_transfer', 'partially_paid') then
    raise exception using errcode = '55000', message = '확정할 선택 상품 배송비 입금 건을 찾지 못했습니다.';
  end if;
  if not app_private.can_confirm_shared_payment(v_payment.business_id) then
    raise exception using errcode = '42501', message = '배송비를 확정할 권한이 없습니다.';
  end if;
  if v_payment.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = '배송비 입금 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  select coalesce(sum(case when entry_type = 'receipt' then amount else -amount end), 0)::bigint, count(*)::integer
    into v_received, v_count
  from public.manual_transfer_payment_ledger
  where shipping_fee_payment_id = p_payment_id;
  if v_received <> p_observed_received_amount or v_count <> p_observed_ledger_entry_count then
    raise exception using errcode = 'PT409', message = '다른 운영자가 배송비 원장을 변경했습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_received <> v_payment.expected_amount then
    raise exception using errcode = '22023', message = '원장 잔액이 0원인 배송비만 확정할 수 있습니다.';
  end if;

  update public.shipping_fee_payments
  set status = 'confirmed', confirmed_at = clock_timestamp(), confirmed_by = v_actor,
      version = version + 1
  where id = p_payment_id
  returning * into v_payment;
  insert into public.store_financial_entries(
    business_id, inventory_shipment_id, entry_kind, amount, occurred_at,
    idempotency_key, metadata
  ) values (
    v_payment.business_id, v_payment.inventory_shipment_id, 'shipping_fee',
    v_payment.expected_amount, clock_timestamp(), p_idempotency_key,
    jsonb_build_object('shippingFeePaymentId', v_payment.id)
  );
  v_result := jsonb_build_object(
    'payment_kind', 'shipping_fee', 'payment_id', v_payment.id,
    'version', v_payment.version, 'received_amount', v_received,
    'remaining_amount', 0, 'ledger_entry_count', v_count,
    'status', 'confirmed', 'idempotent_replay', false
  );
  insert into public.inventory_command_receipts values (
    v_actor, p_idempotency_key, 'finalize_shipping_fee_payment',
    p_payment_id, v_fingerprint, v_result, clock_timestamp()
  );
  return v_result;
end;
$$;

create or replace function public.confirm_unified_manual_payment_v2(
  p_payment_kind text,
  p_payment_id uuid,
  p_expected_version bigint,
  p_depositor_name text,
  p_observed_received_amount bigint,
  p_observed_ledger_entry_count integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected bigint;
begin
  if p_payment_kind = 'shipping_fee' then
    select expected_amount into v_expected
    from public.shipping_fee_payments
    where id = p_payment_id and inventory_shipment_id is not null;
    if v_expected is not null and p_observed_received_amount = v_expected then
      return public.finalize_inventory_shipping_fee_payment(
        p_payment_id, p_observed_received_amount, p_observed_ledger_entry_count,
        p_expected_version, p_idempotency_key
      );
    end if;
  end if;
  return public.confirm_unified_manual_payment(
    p_payment_kind, p_payment_id, p_expected_version, p_depositor_name,
    p_observed_received_amount, p_observed_ledger_entry_count, p_idempotency_key
  );
end;
$$;

revoke all on function
  app_private.record_inventory_shipping_fee_receipt(uuid,bigint,text,bigint,integer,text,text)
from public, anon, authenticated, service_role;
revoke all on function
  public.finalize_inventory_shipping_fee_payment(uuid,bigint,integer,bigint,uuid),
  public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.record_shipping_fee_payment(uuid,bigint,text,bigint,integer,text,text),
  public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid)
to authenticated;

comment on function public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid)
  is 'Routes an exact advanced V2 shipping-fee ledger balance through CAS finalisation; all other payments retain the shared full-balance confirmation RPC.';

commit;
