begin;

-- The store-scoped chat migration replaced these ambiguous member RPCs with
-- get_or_create_support_conversation(store_id) and start_product_inquiry(...).
-- Keeping the old functions would either fail at runtime or bypass the
-- explicit store selection required by the new chat model.
revoke all on function public.reopen_my_support_conversation()
from public, anon, authenticated, service_role;
drop function public.reopen_my_support_conversation();

revoke all on function public.get_or_create_product_inquiry_conversation(uuid)
from public, anon, authenticated, service_role;
drop function public.get_or_create_product_inquiry_conversation(uuid);

-- Repair two pre-existing PL/pgSQL name-resolution errors without changing
-- either function's signature, privileges, or surrounding payment behavior.
do $repair$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.confirm_unified_manual_payment(text,uuid,bigint,text,bigint,integer,uuid)'::regprocedure
  )
  into v_definition;

  if position('v_offer_row.amount' in v_definition) = 0 then
    raise exception
      'confirm_unified_manual_payment no longer contains the expected legacy field reference';
  end if;

  execute replace(
    v_definition,
    'v_offer_row.amount',
    'v_offer_row.offered_amount'
  );
end;
$repair$;

do $repair$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.prepare_commerce_portone_checkout(uuid,uuid[],text,text,text,text,boolean)'::regprocedure
  )
  into v_definition;

  if position(
    'update public.payment_orders' || chr(10) ||
    '  set expected_amount = (v_order ->> ''total'')::bigint' || chr(10) ||
    '  where commerce_order_id = v_prepared.commerce_order_id'
    in v_definition
  ) = 0 then
    raise exception
      'prepare_commerce_portone_checkout no longer contains the expected ambiguous update';
  end if;

  execute replace(
    v_definition,
    'update public.payment_orders' || chr(10) ||
    '  set expected_amount = (v_order ->> ''total'')::bigint' || chr(10) ||
    '  where commerce_order_id = v_prepared.commerce_order_id',
    'update public.payment_orders as orders' || chr(10) ||
    '  set expected_amount = (v_order ->> ''total'')::bigint' || chr(10) ||
    '  where orders.commerce_order_id = v_prepared.commerce_order_id'
  );
end;
$repair$;

commit;
