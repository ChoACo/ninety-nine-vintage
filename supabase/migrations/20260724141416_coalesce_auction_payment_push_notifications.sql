begin;

set local lock_timeout = '10s';

-- Combined auction payment creates one transfer row per product. Notify store
-- staff once per member action instead of once per item.
drop trigger if exists manual_transfer_orders_notify_insert
  on public.manual_transfer_orders;

create or replace function app_private.notify_combined_auction_payment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  if new.last_depositor_name is null then
    return new;
  end if;

  for v_scope in
    select
      stores.business_id,
      count(*)::integer as item_count
    from public.manual_transfer_orders as orders
    join public.products on products.id = orders.product_id
    join public.stores on stores.id = products.store_id
    where orders.buyer_id = new.member_id
      and orders.status = 'awaiting_manual_transfer'
    group by stores.business_id
  loop
    perform app_private.insert_staff_notifications(
      v_scope.business_id,
      null,
      'payment_verification_requested',
      '새 입금 확인 요청이 있습니다',
      '낙찰품 ' || v_scope.item_count::text || '개의 일괄 결제가 접수되었습니다.',
      '/admin/operator/payments'
    );
  end loop;

  return new;
end;
$$;

revoke all on function app_private.notify_combined_auction_payment_request()
  from public, anon, authenticated, service_role;

create trigger member_accounts_notify_combined_auction_payment
after update of last_depositor_name on public.member_accounts
for each row execute function app_private.notify_combined_auction_payment_request();

create or replace function app_private.notify_shipping_payment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_context = 'auction_bundle' then
    return new;
  end if;

  perform app_private.insert_staff_notifications(
    new.business_id,
    null,
    'payment_verification_requested',
    '새 입금 확인 요청이 있습니다',
    case new.payment_context
      when 'shipping_credit' then '배송 크레딧 결제'
      else '배송비 결제'
    end || ' · ' || to_char(new.expected_amount, 'FM999,999,999,990') || '원',
    '/admin/operator/payments'
  );

  return new;
end;
$$;

revoke all on function app_private.notify_shipping_payment_request()
  from public, anon, authenticated, service_role;

commit;
