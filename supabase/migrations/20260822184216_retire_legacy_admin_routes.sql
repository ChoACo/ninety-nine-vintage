begin;

-- Existing notifications and their writers must stop pointing at removed
-- compatibility URLs before those routes disappear from the application.
update public.notifications
set href = case href
  when '/admin/operator/payments' then '/admin/owner/payments'
  when '/admin/operator/fulfillment' then '/admin/operator/orders'
  else href
end
where href in ('/admin/operator/payments', '/admin/operator/fulfillment');

do $$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    to_regprocedure('app_private.notify_manual_transfer_request()'),
    to_regprocedure('app_private.notify_commerce_transfer_request()'),
    to_regprocedure('app_private.notify_shipping_payment_request()'),
    to_regprocedure('app_private.notify_combined_auction_payment_request()'),
    to_regprocedure('app_private.notify_store_sale_created()')
  ]::regprocedure[]
  loop
    if v_function is null then
      continue;
    end if;

    select pg_get_functiondef(v_function)
    into v_definition;

    v_definition := replace(
      v_definition,
      '/admin/operator/payments',
      '/admin/owner/payments'
    );
    v_definition := replace(
      v_definition,
      '/admin/operator/fulfillment',
      '/admin/operator/orders'
    );

    execute v_definition;
  end loop;
end;
$$;

commit;
