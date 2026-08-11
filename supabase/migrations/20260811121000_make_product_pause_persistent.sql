-- A paused product used the same pending status as scheduled publication while
-- retaining its already elapsed publish_at. The minute cron therefore
-- re-published it. Preserve the existing public status contract and record the
-- operator's explicit pause separately so cron can distinguish it from drafts.

alter table public.products
add column if not exists paused_at timestamptz;

comment on column public.products.paused_at is
  'Non-null while an operator has explicitly paused publication; cleared only by explicit publish.';

create or replace function public.pause_managed_product(
  p_product_id uuid,
  p_expected_updated_at timestamptz
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
begin
  select * into v_product
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '상품을 찾을 수 없습니다.';
  end if;
  if not public.has_store_permission(v_product.store_id, 'manage_products') then
    raise exception using errcode = '42501', message = '상품 관리 권한이 없습니다.';
  end if;
  if v_product.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'PT409', message = '상품 정보가 변경되었습니다.';
  end if;
  if v_product.status <> 'active' then
    raise exception using errcode = '55000', message = '공개 중인 상품만 일시중지할 수 있습니다.';
  end if;
  if v_product.participant_count <> 0
    or v_product.final_bid_id is not null
    or exists (
      select 1 from public.auction_bids where product_id = p_product_id
    )
  then
    raise exception using errcode = '55000', message = '입찰 기록이 있는 상품은 일시중지할 수 없습니다.';
  end if;

  update public.products
  set
    status = 'pending',
    paused_at = clock_timestamp(),
    updated_by = auth.uid()
  where id = p_product_id;
  return query select * from public.products where id = p_product_id;
end;
$$;

revoke all on function public.pause_managed_product(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.pause_managed_product(uuid, timestamptz)
to authenticated;

create or replace function public.publish_pending_products_now(
  p_product_ids uuid[]
)
returns table (
  requested_count integer,
  published_count integer,
  skipped_count integer,
  published_ids uuid[],
  skipped_ids uuid[],
  published_at timestamptz,
  closes_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_ids uuid[];
  v_published_ids uuid[] := '{}'::uuid[];
  v_skipped_ids uuid[] := '{}'::uuid[];
  v_auction_closes_at timestamptz := public.auction_close_at(v_now);
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = '상품 공개 권한이 필요합니다.';
  end if;
  if p_product_ids is null
    or cardinality(p_product_ids) = 0
    or cardinality(p_product_ids) > 200
  then
    raise exception using errcode = '22023', message = '공개할 상품을 1~200개 선택해 주세요.';
  end if;

  select coalesce(array_agg(input.product_id order by input.first_position), '{}'::uuid[])
  into v_ids
  from (
    select values_with_position.product_id,
      min(values_with_position.position) as first_position
    from unnest(p_product_ids) with ordinality
      as values_with_position(product_id, position)
    where values_with_position.product_id is not null
    group by values_with_position.product_id
  ) as input;
  if cardinality(v_ids) = 0 then
    raise exception using errcode = '22023', message = '공개할 상품 ID를 확인해 주세요.';
  end if;

  with published as (
    update public.products as products
    set
      status = 'active',
      paused_at = null,
      publish_at = v_now,
      closes_at = case
        when products.sale_type = 'auction' then v_auction_closes_at
        else timestamptz '9999-12-31 23:59:59+00'
      end,
      auction_feed_expires_at = case
        when products.sale_type = 'auction' then v_now + interval '7 days'
        else null
      end,
      updated_by = v_actor
    where products.id = any(v_ids)
      and products.status = 'pending'
      and public.has_store_permission(products.store_id, 'publish_products')
    returning products.id
  )
  select coalesce(array_agg(published.id order by published.id), '{}'::uuid[])
  into v_published_ids
  from published;

  select coalesce(array_agg(requested.id order by requested.position), '{}'::uuid[])
  into v_skipped_ids
  from unnest(v_ids) with ordinality as requested(id, position)
  where not (requested.id = any(v_published_ids));

  return query select cardinality(v_ids), cardinality(v_published_ids),
    cardinality(v_skipped_ids), v_published_ids, v_skipped_ids,
    v_now, v_auction_closes_at;
end;
$$;

revoke all on function public.publish_pending_products_now(uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.publish_pending_products_now(uuid[])
to authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobs.jobid
    from cron.job as jobs
    where jobs.command ~* 'update[[:space:]]+public[.]products'
      and jobs.command ~* 'status[[:space:]]*=[[:space:]]*''active'''
      and jobs.command ~* 'status[[:space:]]*=[[:space:]]*''pending'''
  loop
    perform cron.alter_job(
      v_job_id,
      command := $command$
        update public.products
        set status = 'active'
        where status = 'pending'
          and paused_at is null
          and publish_at <= now();
      $command$
    );
  end loop;
end;
$$;

