-- Keep pending-product publication authoritative while preventing an operator
-- from publishing products assigned to another operator's store. Owners retain
-- the cross-store control required by the owner console.

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
  v_role text := coalesce(public.access_role_for_user(v_actor), '');
  v_now timestamptz := clock_timestamp();
  v_ids uuid[];
  v_published_ids uuid[] := '{}'::uuid[];
  v_skipped_ids uuid[] := '{}'::uuid[];
  v_auction_publish_at timestamptz := public.next_auction_drop_at(v_now);
  v_auction_closes_at timestamptz := public.auction_close_at(v_auction_publish_at);
begin
  if v_actor is null or v_role not in ('owner', 'operator') then
    raise exception using
      errcode = '42501',
      message = '운영자만 대기 상품을 공개할 수 있습니다.';
  end if;

  if p_product_ids is null
    or cardinality(p_product_ids) = 0
    or cardinality(p_product_ids) > 200
  then
    raise exception using
      errcode = '22023',
      message = '공개할 상품을 1~200개 선택해 주세요.';
  end if;

  select coalesce(
    array_agg(input.product_id order by input.first_position),
    '{}'::uuid[]
  )
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
    raise exception using
      errcode = '22023',
      message = '공개할 상품 ID를 확인해 주세요.';
  end if;

  with published as (
    update public.products as products
    set
      status = 'active',
      publish_at = case
        when products.sale_type = 'auction' then v_auction_publish_at
        else v_now
      end,
      closes_at = case
        when products.sale_type = 'auction' then v_auction_closes_at
        else timestamptz '9999-12-31 23:59:59+00'
      end,
      auction_feed_expires_at = case
        when products.sale_type = 'auction'
          then v_auction_publish_at + interval '7 days'
        else null
      end,
      updated_by = v_actor
    where products.id = any(v_ids)
      and products.status = 'pending'
      and (
        v_role = 'owner'
        or exists (
          select 1
          from public.stores as stores
          where stores.id = products.store_id
            and stores.operator_id = v_actor
            and stores.is_active
        )
      )
    returning products.id
  )
  select coalesce(array_agg(published.id order by published.id), '{}'::uuid[])
  into v_published_ids
  from published;

  select coalesce(
    array_agg(requested.id order by requested.position),
    '{}'::uuid[]
  )
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
    v_auction_closes_at;
end;
$$;

revoke all on function public.publish_pending_products_now(uuid[])
from public, anon, authenticated, service_role;

grant execute on function public.publish_pending_products_now(uuid[])
to authenticated;

comment on function public.publish_pending_products_now(uuid[]) is
  'Owner publishes any pending product; operator publishes only products assigned to their own store';
