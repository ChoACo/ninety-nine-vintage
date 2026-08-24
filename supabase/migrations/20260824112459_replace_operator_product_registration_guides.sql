delete from public.staff_board_posts
where id = '99000000-0000-4000-8000-000000000001';

insert into public.staff_board_posts (
  id, kind, title, body, author_role, is_pinned, image_paths, created_at, updated_at
) values
(
  '99000000-0000-4000-8000-000000000002',
  'notice',
  '[모바일 필독] 판매센터 상품 등록 방법',
  E'모바일에서 즉시구매 상품을 등록하는 순서입니다. 아래 사진의 빨간 표시를 따라 진행해 주세요.\n\n1. 모바일 홈 왼쪽 위에서 전체 메뉴를 엽니다.\n2. 로그인 메뉴에서 업무를 선택합니다.\n3. 판매센터 상단의 업무 메뉴를 열고 상품 및 재고 > 새 상품 등록을 누릅니다.\n4. 즉시구매 상품 등록을 선택합니다.\n5. 사진 선택에서 대표 사진을 먼저 올립니다. 최대 15장이며 첫 사진이 대표 이미지가 됩니다.\n6. 상품명, 성별·상품군, 카테고리와 실측 치수를 입력합니다. 실측 단위는 cm입니다.\n7. 즉시구매 가격, 상품 설명, 보관 크기를 확인합니다. 하자·오염은 실제 해당 항목만 선택합니다.\n8. 즉시 공개 또는 예약 공개 시각을 확인하고 등록 버튼을 누릅니다.\n9. 등록 완료 창이 나오면 상품 목록에서 공개 상태, 사진과 가격을 다시 확인합니다.\n\n등록 전 필수 확인\n- 상품명과 가격 오타\n- 대표 사진과 사진 순서\n- 카테고리와 실측 단위(cm)\n- 하자·오염 누락 여부\n- 즉시 공개 또는 예약 공개 선택',
  'owner',
  true,
  array[
    '/guides/operator/product-registration-mobile/01-home-open-menu.png',
    '/guides/operator/product-registration-mobile/02-select-work.png',
    '/guides/operator/product-registration-mobile/03-open-operator-menu.png',
    '/guides/operator/product-registration-mobile/04-new-product-menu.png',
    '/guides/operator/product-registration-mobile/05-select-instant-purchase.png',
    '/guides/operator/product-registration-mobile/06-upload-product-photo.png',
    '/guides/operator/product-registration-mobile/08-price-storage-defects.png',
    '/guides/operator/product-registration-mobile/07-product-info-measurements.png',
    '/guides/operator/product-registration-mobile/09-publish-and-submit.png',
    '/guides/operator/product-registration-mobile/10-registration-complete.png'
  ],
  '2026-08-24 20:30:00+09',
  '2026-08-24 20:30:00+09'
),
(
  '99000000-0000-4000-8000-000000000003',
  'notice',
  '[PC 필독] 판매센터 상품 등록 방법',
  E'PC에서 즉시구매 상품을 등록하는 순서입니다. 아래 사진의 빨간 표시를 따라 진행해 주세요.\n\n1. 홈페이지 상단에서 업무를 선택해 판매센터로 이동합니다.\n2. 왼쪽 메뉴의 상품 및 재고 > 새 상품 등록에서 즉시구매 상품 등록을 선택합니다.\n3. 사진 선택에서 대표 사진을 먼저 올립니다. 최대 15장이며 첫 사진이 대표 이미지가 됩니다.\n4. 상품명, 성별·상품군, 카테고리와 실측 치수를 입력합니다. 실측 단위는 cm입니다.\n5. 즉시구매 가격, 상품 설명, 보관 크기를 확인합니다. 하자·오염은 실제 해당 항목만 선택합니다.\n6. 즉시 공개 또는 예약 공개 시각을 확인하고 등록 버튼을 누릅니다.\n7. 등록 완료 창이 나오면 상품 목록에서 공개 상태, 사진과 가격을 다시 확인합니다.\n\n등록 전 필수 확인\n- 상품명과 가격 오타\n- 대표 사진과 사진 순서\n- 카테고리와 실측 단위(cm)\n- 하자·오염 누락 여부\n- 즉시 공개 또는 예약 공개 선택',
  'owner',
  true,
  array[
    '/guides/operator/product-registration-pc/02-new-product-menu.png',
    '/guides/operator/product-registration-pc/03-select-instant-purchase.png',
    '/guides/operator/product-registration-pc/04-upload-product-photo.png',
    '/guides/operator/product-registration-pc/06-price-storage-defects.png',
    '/guides/operator/product-registration-pc/08-registration-complete.png'
  ],
  '2026-08-24 20:29:00+09',
  '2026-08-24 20:29:00+09'
)
on conflict (id) do update set
  title = excluded.title,
  body = excluded.body,
  image_paths = excluded.image_paths,
  is_pinned = excluded.is_pinned,
  updated_at = excluded.updated_at;
