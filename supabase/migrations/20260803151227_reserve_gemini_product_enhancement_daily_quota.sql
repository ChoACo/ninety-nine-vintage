begin;

create schema if not exists app_private;

-- Gemini 호출량은 운영 데이터와 분리하고 Data API에 노출하지 않습니다.
create table if not exists app_private.gemini_product_enhancement_daily_usage (
  usage_date date primary key,
  request_count integer not null default 0
    check (request_count between 0 and 300),
  updated_at timestamptz not null default statement_timestamp()
);

revoke all on table app_private.gemini_product_enhancement_daily_usage
from public, anon, authenticated;

create or replace function public.reserve_gemini_product_enhancement_quota()
returns table (
  allowed boolean,
  used integer,
  daily_limit integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_date date := timezone('Asia/Seoul', statement_timestamp())::date;
  v_used integer;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.account_access_roles as role
    where role.user_id = auth.uid()
      and role.role_code in ('owner', 'operator')
  ) then
    raise exception 'operator_products_forbidden'
      using errcode = '42501';
  end if;

  insert into app_private.gemini_product_enhancement_daily_usage as usage (
    usage_date,
    request_count,
    updated_at
  ) values (
    v_usage_date,
    1,
    statement_timestamp()
  )
  on conflict (usage_date) do update
    set request_count = usage.request_count + 1,
        updated_at = statement_timestamp()
    where usage.request_count < 300
  returning request_count into v_used;

  if v_used is not null then
    return query select true, v_used, 300;
    return;
  end if;

  select usage.request_count
  into v_used
  from app_private.gemini_product_enhancement_daily_usage as usage
  where usage.usage_date = v_usage_date;

  return query select false, coalesce(v_used, 300), 300;
end;
$$;

revoke all on function public.reserve_gemini_product_enhancement_quota()
from public, anon;
grant execute on function public.reserve_gemini_product_enhancement_quota()
to authenticated;

commit;
