begin;

-- 단품(수량 1) 빈티지 상품의 임시 재고 선점(Pending lock) 상태를 판매센터가
-- 명확히 표기할 수 있도록, 즉시구매 결제 진행 중 또는 경매 낙찰 후 결제 대기인
-- 상품을 판매센터 상품 목록에서 식별합니다.
--
-- 선점(Pending lock) 판정 기준:
--   * buy_now_payment : 즉시구매 주문 생성 시 상품이 'closed'로 바뀌고
--     commerce_order_transfers가 입금 대기 중인 상태. 입금 확인 전까지 다른
--     사용자의 결제 시도를 원천 차단합니다.
--   * auction_payment : 경매 마감 후 최종 낙찰자 또는 차순위 낙찰자의 결제(응답)
--     기한이 남아 있는 상태. 정산(settled)되거나 기한 만료로 최종 입찰이 해제되기
--     전까지 다른 사용자가 구매할 수 없습니다.
create or replace function public.get_operator_pending_product_locks(
  p_store_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with buy_now_locks as (
    select
      p.id as product_id,
      'buy_now_payment' as lock_kind,
      greatest(o.payment_due_at, t.payment_due_at) as lock_until
    from public.products p
    join public.commerce_order_items oi on oi.product_id = p.id
    join public.commerce_orders o on o.id = oi.order_id
    join public.commerce_order_transfers t on t.order_id = o.id
    where p.sale_type = 'fixed'
      and p.status = 'closed'
      and o.status in ('awaiting_payment', 'partially_paid')
      and t.status in ('awaiting_transfer', 'partially_paid')
      and p.store_id = any(p_store_ids)
  ),
  auction_locks as (
    select distinct on (p.id)
      p.id as product_id,
      'auction_payment' as lock_kind,
      coalesce(offer.payment_due_at, offer.response_due_at) as lock_until
    from public.products p
    join public.auction_purchase_offers offer on offer.product_id = p.id
    where p.sale_type = 'auction'
      and p.status = 'closed'
      and offer.status in ('offered', 'payment_due', 'accepted')
      and p.store_id = any(p_store_ids)
    order by p.id, offer.offered_at desc
  ),
  merged as (
    select * from buy_now_locks
    union all
    select * from auction_locks
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'productId', merged.product_id,
    'lockKind', merged.lock_kind,
    'lockUntil', merged.lock_until
  )), '[]'::jsonb)
  from merged;
$$;

revoke all on function public.get_operator_pending_product_locks(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_operator_pending_product_locks(uuid[])
  to authenticated;

commit;