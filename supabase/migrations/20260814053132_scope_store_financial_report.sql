begin;

create or replace function public.get_store_financial_report(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_store_id uuid;
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = '매출 조회 권한이 필요합니다.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 365 then
    raise exception using errcode = '22023', message = '조회 기간은 최대 366일까지 선택할 수 있습니다.';
  end if;

  v_store_id := public.require_active_operator_store_scope();
  if not public.has_store_permission(v_store_id, 'view_reports') and not public.is_owner() then
    raise exception using errcode = '42501', message = '선택한 매장의 매출 조회 권한이 필요합니다.';
  end if;

  v_from := p_from::timestamp at time zone 'Asia/Seoul';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Seoul';

  select jsonb_build_object(
    'stores', coalesce(jsonb_agg(jsonb_build_object(
      'storeId', q.store_id,
      'storeName', q.store_name,
      'grossSales', q.gross_sales,
      'refunds', q.refunds,
      'netSales', q.gross_sales - q.refunds,
      'paidItemCount', q.paid_count,
      'refundedItemCount', q.refunded_count,
      'entries', q.entries
    )), '[]'::jsonb),
    'centralShippingFees', 0,
    'serverTime', clock_timestamp()
  )
  into v_result
  from (
    select
      store.id as store_id,
      store.name as store_name,
      coalesce(sum(entry.amount) filter (where entry.entry_kind = 'item_payment'), 0) as gross_sales,
      coalesce(-sum(entry.amount) filter (where entry.entry_kind in ('item_refund', 'payment_reversal')), 0) as refunds,
      count(entry.id) filter (where entry.entry_kind = 'item_payment')::integer as paid_count,
      count(entry.id) filter (where entry.entry_kind in ('item_refund', 'payment_reversal'))::integer as refunded_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', entry.id,
        'entryKind', entry.entry_kind,
        'amount', entry.amount,
        'occurredAt', entry.occurred_at,
        'inventoryItemId', entry.inventory_item_id,
        'manualRefundId', entry.manual_refund_id
      ) order by entry.occurred_at desc, entry.id desc) filter (where entry.id is not null), '[]'::jsonb) as entries
    from public.stores store
    left join public.store_financial_entries entry
      on entry.origin_store_id = store.id
     and entry.occurred_at >= v_from
     and entry.occurred_at < v_to
     and entry.entry_kind in ('item_payment', 'payment_reversal', 'item_refund')
    where store.id = v_store_id
      and store.is_active
    group by store.id, store.name
  ) q;

  return coalesce(v_result, jsonb_build_object(
    'stores', '[]'::jsonb,
    'centralShippingFees', 0,
    'serverTime', clock_timestamp()
  ));
end;
$$;

revoke all on function public.get_store_financial_report(date, date)
from public, anon, service_role;
grant execute on function public.get_store_financial_report(date, date)
to authenticated;

commit;
