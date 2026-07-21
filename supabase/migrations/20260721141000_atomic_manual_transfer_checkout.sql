begin;

-- Create the commerce order and its manual-transfer request in one database
-- transaction. Move the existing, already-hardened order implementation behind
-- a private schema and keep a public compatibility wrapper that is atomic too.
-- This lets the previous application version continue its second, idempotent
-- transfer call during a rolling DB-first deployment without an orphan-order
-- window. The transfer RPC also remains available for recovery of historical
-- awaiting orders that may not yet have a transfer row.

alter function public.create_commerce_order(uuid[], text, boolean)
set schema app_private;

revoke all on function app_private.create_commerce_order(uuid[], text, boolean)
from public, anon, authenticated, service_role;

create or replace function public.create_commerce_manual_transfer_checkout(
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
  v_order jsonb;
  v_order_id uuid;
  v_transfer jsonb;
  v_existing_transfer public.commerce_order_transfers%rowtype;
begin
  v_order := app_private.create_commerce_order(
    p_product_ids,
    p_idempotency_key,
    p_apply_shipping_credit
  );

  if jsonb_typeof(v_order) <> 'object'
    or nullif(v_order ->> 'id', '') is null
    or nullif(v_order ->> 'total', '') is null
  then
    raise exception using
      errcode = 'XX000',
      message = '주문 생성 결과가 올바르지 않습니다.';
  end if;

  v_order_id := (v_order ->> 'id')::uuid;
  select transfers.*
  into v_existing_transfer
  from public.commerce_order_transfers as transfers
  where transfers.order_id = v_order_id
  for update;

  if found then
    if v_existing_transfer.member_id is distinct from auth.uid() then
      raise exception using
        errcode = '23514',
        message = '주문과 입금 요청의 회원 계약이 일치하지 않습니다.';
    end if;
    if v_existing_transfer.status = 'cancelled' then
      raise exception using
        errcode = '55000',
        message = '취소된 입금 요청입니다.';
    end if;
    v_transfer := to_jsonb(v_existing_transfer);
  else
    v_transfer := public.create_commerce_order_transfer(v_order_id);
  end if;

  if jsonb_typeof(v_transfer) <> 'object'
    or v_transfer ->> 'order_id' is distinct from v_order_id::text
    or nullif(v_transfer ->> 'expected_amount', '') is null
    or (v_transfer ->> 'expected_amount')::bigint
      is distinct from (v_order ->> 'total')::bigint
    or nullif(btrim(v_transfer ->> 'bank_name_snapshot'), '') is null
    or nullif(btrim(v_transfer ->> 'account_number_snapshot'), '') is null
    or v_transfer ->> 'status' not in ('awaiting_transfer', 'partially_paid', 'confirmed')
  then
    raise exception using
      errcode = 'XX000',
      message = '입금 요청 생성 결과가 올바르지 않습니다.';
  end if;

  return jsonb_build_object(
    'order', v_order,
    'transfer', v_transfer
  );
end;
$$;

revoke all on function public.create_commerce_manual_transfer_checkout(uuid[], text, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_manual_transfer_checkout(uuid[], text, boolean)
to authenticated;

-- Preserve the old RPC contract for the currently deployed application, but
-- make that entrypoint atomic as well. Its follow-up transfer RPC becomes an
-- idempotent read of the row already created here.
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
  v_checkout jsonb;
begin
  v_checkout := public.create_commerce_manual_transfer_checkout(
    p_product_ids,
    p_idempotency_key,
    p_apply_shipping_credit
  );

  if jsonb_typeof(v_checkout -> 'order') <> 'object' then
    raise exception using
      errcode = 'XX000',
      message = '통합 주문 생성 결과가 올바르지 않습니다.';
  end if;

  return v_checkout -> 'order';
end;
$$;

revoke all on function public.create_commerce_order(uuid[], text, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_order(uuid[], text, boolean)
to authenticated;

comment on function public.create_commerce_manual_transfer_checkout(uuid[], text, boolean) is
  'Atomically creates or replays one fixed-price commerce order and its shared manual-transfer request.';

comment on function public.create_commerce_order(uuid[], text, boolean) is
  'Rolling-compatible atomic manual-transfer checkout entrypoint; returns the legacy order-only JSON contract.';

commit;
