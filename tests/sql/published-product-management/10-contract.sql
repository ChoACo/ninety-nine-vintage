\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

insert into public.stores (id, manager_id)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.products (
  id, store_id, title, description, category, brand, brand_slug,
  sale_type, starting_price, current_price, fixed_price, bid_increment,
  status, participant_count, publish_at, closes_at, auction_feed_expires_at,
  image_urls, thumbnail_urls, size_label, measurements, inspection_notes,
  updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '공개 경매', '수정 전', '의류', 'Brand', 'brand',
    'auction', 10000, 35000, null, 1000,
    'active', 1, '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z', '2030-01-08T00:00:00Z',
    array['https://example.com/original.jpg'], array['https://example.com/thumb.jpg'],
    'M', '{"legacy": 99}'::jsonb, array['수정 전'], '2030-01-01T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '삭제 가능한 공개 상품', '설명', '의류', 'Brand', 'brand',
    'fixed', 25000, 25000, 25000, 1000,
    'active', 0, '2030-01-01T00:00:00Z', '9999-12-31T23:59:59Z', null,
    array['https://example.com/delete.jpg'], array['https://example.com/delete-thumb.jpg'],
    'L', '{}'::jsonb, '{}'::text[], '2030-01-01T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '주문 이력 공개 상품', '설명', '의류', 'Brand', 'brand',
    'fixed', 30000, 30000, 30000, 1000,
    'active', 0, '2030-01-01T00:00:00Z', '9999-12-31T23:59:59Z', null,
    array['https://example.com/order.jpg'], array['https://example.com/order-thumb.jpg'],
    'S', '{}'::jsonb, '{}'::text[], '2030-01-01T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '판매 완료 상품', '설명', '의류', 'Brand', 'brand',
    'fixed', 40000, 40000, 40000, 1000,
    'sold', 0, '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z', null,
    array['https://example.com/sold.jpg'], array['https://example.com/sold-thumb.jpg'],
    'M', '{}'::jsonb, '{}'::text[], '2030-01-01T00:00:00Z'
  );

insert into public.auction_bids (id, product_id)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');

insert into public.commerce_order_items (id, product_id)
values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003');

set role authenticated;

select public.update_operator_product(
  '10000000-0000-4000-8000-000000000001',
  '2030-01-01T00:00:00Z',
  '공개 후 수정된 경매',
  '공개 후 수정된 설명',
  '빈티지 의류',
  'Updated Brand',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'auction',
  10000,
  1000,
  '2030-01-01T00:00:00Z',
  array['https://example.com/updated.jpg'],
  array['https://example.com/updated-thumb.jpg'],
  'M',
  'A+',
  'small',
  '{}'::jsonb,
  array['공개 후 점검 완료']
);

select public.delete_managed_product(
  '10000000-0000-4000-8000-000000000002',
  '2030-01-01T00:00:00Z'
);

reset role;

do $$
begin
  if not exists (
    select 1
    from public.products
    where id = '10000000-0000-4000-8000-000000000001'
      and title = '공개 후 수정된 경매'
      and description = '공개 후 수정된 설명'
      and current_price = 35000
      and starting_price = 10000
      and inspection_notes = array['공개 후 점검 완료']
      and measurements = '{"legacy": 99}'::jsonb
  ) then
    raise exception '공개 상품의 점검·수정 또는 현재가·기존 데이터 보존이 실패했습니다.';
  end if;

  if exists (
    select 1 from public.products
    where id = '10000000-0000-4000-8000-000000000002'
  ) then
    raise exception '거래 이력이 없는 공개 상품이 삭제되지 않았습니다.';
  end if;

  if has_function_privilege('anon', 'public.update_operator_product(uuid,timestamptz,text,text,text,text,uuid,text,bigint,bigint,timestamptz,text[],text[],text,text,text,jsonb,text[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.delete_managed_product(uuid,timestamptz)', 'EXECUTE')
  then
    raise exception '익명 역할에 상품 관리 함수 실행 권한이 남아 있습니다.';
  end if;
end;
$$;

do $$
declare
  v_updated_at timestamptz;
begin
  select updated_at into v_updated_at
  from public.products
  where id = '10000000-0000-4000-8000-000000000001';

  begin
    perform public.delete_managed_product(
      '10000000-0000-4000-8000-000000000001',
      v_updated_at
    );
    raise exception '입찰 이력이 있는 공개 상품 삭제가 성공했습니다.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> '입찰 기록이 있는 상품은 삭제할 수 없습니다.' then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.delete_managed_product(
      '10000000-0000-4000-8000-000000000003',
      '2030-01-01T00:00:00Z'
    );
    raise exception '주문 이력이 있는 공개 상품 삭제가 성공했습니다.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> '주문·결제·배송 이력이 있는 상품은 삭제할 수 없습니다.' then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.update_operator_product(
      '10000000-0000-4000-8000-000000000004',
      '2030-01-01T00:00:00Z',
      '변경 시도', '설명', '의류', 'Brand',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'fixed', 40000, 1000, '2030-01-01T00:00:00Z',
      array['https://example.com/sold.jpg'],
      array['https://example.com/sold-thumb.jpg'],
      'M', 'A', 'small', '{}'::jsonb, '{}'::text[]
    );
    raise exception '판매 완료 상품 수정이 성공했습니다.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> '마감 또는 판매 완료된 상품 기록은 수정할 수 없습니다.' then
        raise;
      end if;
  end;
end;
$$;

do $$
declare
  v_updated_at timestamptz;
begin
  select updated_at into v_updated_at
  from public.products
  where id = '10000000-0000-4000-8000-000000000001';

  begin
    perform public.update_operator_product(
      '10000000-0000-4000-8000-000000000001',
      v_updated_at,
      '가격 변경 시도', '설명', '의류', 'Brand',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'auction', 11000, 1000, '2030-01-01T00:00:00Z',
      array['https://example.com/updated.jpg'],
      array['https://example.com/updated-thumb.jpg'],
      'M', 'A', 'small', '{}'::jsonb, '{}'::text[]
    );
    raise exception '공개 상품 판매 설정 변경이 성공했습니다.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> '공개 중에는 숍·판매 방식·가격·입찰 단위·공개 시각을 변경할 수 없습니다.' then
        raise;
      end if;
  end;
end;
$$;

select 'published product management contracts passed' as result;

