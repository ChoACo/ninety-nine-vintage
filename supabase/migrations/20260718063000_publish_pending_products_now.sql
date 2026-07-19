-- Operators can atomically publish reviewed queue items. Only pending rows are
-- changed; missing or already-transitioned IDs are reported back as skipped so
-- the UI can reconcile concurrent edits without retrying successful rows.

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
  v_published_ids uuid[];
  v_skipped_ids uuid[];
  v_closes_at timestamptz;
begin
  if v_actor is null
    or coalesce(public.access_role_for_user(v_actor), '') not in ('owner', 'operator')
  then
    raise exception using
      errcode = '42501',
      message = '운영자만 대기 상품을 즉시 공개할 수 있습니다.';
  end if;

  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception using
      errcode = '22023',
      message = '즉시 공개할 상품을 하나 이상 선택해 주세요.';
  end if;
  if cardinality(p_product_ids) > 200 then
    raise exception using
      errcode = '22023',
      message = '한 번에 최대 200개 상품까지 즉시 공개할 수 있습니다.';
  end if;

  select array_agg(input.product_id order by input.first_position)
  into v_ids
  from (
    select input_values.product_id, min(input_values.position) as first_position
    from unnest(p_product_ids) with ordinality as input_values(product_id, position)
    where input_values.product_id is not null
    group by input_values.product_id
  ) as input;

  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception using
      errcode = '22023',
      message = '즉시 공개할 상품 ID를 확인해 주세요.';
  end if;

  -- The deadline is the first KST 21:00 strictly after the publish instant.
  v_closes_at := (
    (v_now at time zone 'Asia/Seoul')::date
    + case
        when (v_now at time zone 'Asia/Seoul')::time < time '21:00:00'
        then 0
        else 1
      end
    + time '21:00:00'
  ) at time zone 'Asia/Seoul';

  with published as (
    update public.products as products
    set
      status = 'active',
      publish_at = v_now,
      closes_at = v_closes_at,
      updated_by = v_actor
    where products.id = any(v_ids)
      and products.status = 'pending'
    returning products.id
  )
  select coalesce(array_agg(published.id order by published.id), '{}'::uuid[])
  into v_published_ids
  from published;

  select coalesce(array_agg(requested.id order by requested.position), '{}'::uuid[])
  into v_skipped_ids
  from unnest(v_ids) with ordinality as requested(id, position)
  where not (requested.id = any(v_published_ids));

  return query select
    cardinality(v_ids),
    cardinality(v_published_ids),
    cardinality(v_skipped_ids),
    v_published_ids,
    v_skipped_ids,
    v_now,
    v_closes_at;
end;
$$;

revoke all on function public.publish_pending_products_now(uuid[])
  from public, anon, authenticated;
grant execute on function public.publish_pending_products_now(uuid[])
  to authenticated;
