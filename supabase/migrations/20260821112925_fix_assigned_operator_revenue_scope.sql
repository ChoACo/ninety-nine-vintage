begin;

-- Operators have one fixed active store and no store-selection UI. Owners keep
-- the short-lived support scope. Resolve those two authorization modes before
-- reading the scoped financial ledger.
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
  v_principal uuid;
  v_role text;
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

  v_principal := public.current_authorization_principal();
  v_role := public.access_role_for_user(v_actor);
  if v_role = 'owner' then
    v_store_id := public.require_active_operator_store_scope();
  elsif v_role = 'operator' then
    select min(memberships.store_id::text)::uuid
    into v_store_id
    from public.store_memberships as memberships
    join public.stores as stores
      on stores.id = memberships.store_id
     and stores.is_active
    where memberships.user_id = v_principal
      and memberships.membership_role = 'operator'
      and memberships.status = 'active'
    having count(distinct memberships.store_id) = 1;

    if v_store_id is null then
      raise exception using errcode = '42501', message = '배정된 매장의 매출 범위를 확인할 수 없습니다.';
    end if;
  else
    raise exception using errcode = '42501', message = '매출 조회 권한이 필요합니다.';
  end if;

  if not public.has_store_permission(v_store_id, 'view_reports')
    and v_role <> 'owner'
  then
    raise exception using errcode = '42501', message = '선택한 매장의 매출 조회 권한이 필요합니다.';
  end if;

  v_from := p_from::timestamp at time zone 'Asia/Seoul';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Seoul';

  select jsonb_build_object(
    'stores', coalesce(jsonb_agg(jsonb_build_object(
      'storeId', report.store_id,
      'storeName', report.store_name,
      'grossSales', report.gross_sales,
      'refunds', report.refunds,
      'netSales', report.gross_sales - report.refunds,
      'paidItemCount', report.paid_count,
      'refundedItemCount', report.refunded_count,
      'entries', report.entries
    )), '[]'::jsonb),
    'centralShippingFees', 0,
    'serverTime', clock_timestamp()
  )
  into v_result
  from (
    select
      stores.id as store_id,
      stores.name as store_name,
      coalesce(sum(entries.amount) filter (
        where entries.entry_kind = 'item_payment'
      ), 0) as gross_sales,
      coalesce(-sum(entries.amount) filter (
        where entries.entry_kind in ('item_refund', 'payment_reversal')
      ), 0) as refunds,
      count(entries.id) filter (
        where entries.entry_kind = 'item_payment'
      )::integer as paid_count,
      count(entries.id) filter (
        where entries.entry_kind in ('item_refund', 'payment_reversal')
      )::integer as refunded_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', entries.id,
        'entryKind', entries.entry_kind,
        'amount', entries.amount,
        'occurredAt', entries.occurred_at,
        'inventoryItemId', entries.inventory_item_id,
        'manualRefundId', entries.manual_refund_id
      ) order by entries.occurred_at desc, entries.id desc)
        filter (where entries.id is not null), '[]'::jsonb) as entries
    from public.stores as stores
    left join public.store_financial_entries as entries
      on entries.origin_store_id = stores.id
     and entries.occurred_at >= v_from
     and entries.occurred_at < v_to
     and entries.entry_kind in (
       'item_payment', 'payment_reversal', 'item_refund'
     )
    where stores.id = v_store_id
      and stores.is_active
    group by stores.id, stores.name
  ) as report;

  return coalesce(v_result, jsonb_build_object(
    'stores', '[]'::jsonb,
    'centralShippingFees', 0,
    'serverTime', clock_timestamp()
  ));
end;
$$;

revoke all on function public.get_store_financial_report(date, date)
from public, anon, authenticated, service_role;
grant execute on function public.get_store_financial_report(date, date)
to authenticated;

commit;
