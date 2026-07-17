-- Keep the compact daily ledger while making month boundaries valid PostgreSQL
-- aggregates. The previous expression mixed a timestamp boundary with a
-- date-cast GROUP BY expression, which failed only when the RPC was planned.
create or replace function public.get_monthly_revenue(
  p_from date,
  p_to date
)
returns table (
  period_start date,
  period_end date,
  gross_amount bigint,
  paid_order_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_members() then
    raise exception using errcode = '42501', message = '매출 조회 권한이 없습니다.';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 36525 then
    raise exception using errcode = '22023', message = '매출 조회 기간을 확인해 주세요.';
  end if;

  return query
  with monthly as (
    select
      date_trunc('month', revenue.revenue_date::timestamp)::date as month_start,
      sum(revenue.gross_amount)::bigint as month_gross_amount,
      sum(revenue.paid_order_count)::bigint as month_paid_order_count
    from public.daily_revenue as revenue
    where revenue.revenue_date between p_from and p_to
    group by 1
  )
  select
    monthly.month_start,
    (monthly.month_start + interval '1 month' - interval '1 day')::date,
    monthly.month_gross_amount,
    monthly.month_paid_order_count
  from monthly
  order by monthly.month_start;
end;
$$;

revoke all on function public.get_monthly_revenue(date, date) from public;
grant execute on function public.get_monthly_revenue(date, date) to authenticated;

-- This directory compares sanctions with clock_timestamp(), so declaring it
-- VOLATILE accurately reflects the function body and removes a false planner
-- promise without changing its result or permissions.
alter function public.get_staff_member_directory(integer, integer) volatile;
