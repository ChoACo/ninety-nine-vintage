insert into public.staff_board_posts (
  id, kind, title, body, author_role, is_pinned, image_paths, created_at, updated_at
) values
(
  '99000000-0000-4000-8000-000000000004',
  'notice',
  '[구매자 필독] 라이브 옥션 입찰·결제·보관·배송 방법',
  E'처음 참여하는 분도 아래 사진의 빨간 표시를 순서대로 따라 하면 됩니다. 화면에 표시되는 금액과 마감 시각은 상품·센터 정책에 따라 달라질 수 있습니다.\n\n1. 모바일 홈에서 라이브 옥션을 선택합니다.\n2. 참여할 상품에서 경매 참여를 누르고 상품 상태와 현재가를 확인합니다.\n3. 원하는 입찰 금액을 정하고 취소 불가 약관을 확인합니다.\n4. 최종 확인 창에서 금액을 다시 본 뒤 입찰을 확정합니다. 입찰은 확정 후 취소할 수 없습니다.\n5. 상품 화면에서 내 입찰 반영 여부와 현재 최고가를 확인합니다.\n6. 경매 종료 후 낙찰되면 MY > 결제하기에서 낙찰 상품과 금액을 확인합니다.\n7. 입금자명을 입력하고 상품 금액, 센터별 배송비, 총 결제 금액을 확인합니다.\n8. 안내된 계좌에 표시된 총액을 결제 마감 전 한 번만 입금합니다. 입금자명도 화면과 같아야 확인이 빠릅니다.\n9. 운영자가 입금을 확인하면 상품이 보관함에 들어갑니다. 보관함에서 D-day와 무료 보관 기한을 확인합니다.\n10. 배송받을 상품을 선택하고 저장된 배송지를 확인한 뒤 배송을 신청합니다.\n11. 배송 접수 완료 안내를 확인하고 이후 MY > 배송 현황에서 진행 상태와 송장을 확인합니다.\n\n꼭 확인해 주세요\n- 입찰은 최종 확정 후 취소할 수 없습니다.\n- 결제 마감이 지나면 낙찰이 취소되거나 이용이 제한될 수 있습니다.\n- 배송비와 무료 보관 기간은 화면에 표시된 센터 정책이 기준입니다.\n- 여러 상품을 보관한 뒤 함께 배송받으려면 보관함에서 원하는 상품을 선택해 신청하세요.\n- 계좌, 총액, 입금자명이 다르면 입금 확인이 늦어질 수 있습니다.',
  'owner',
  true,
  array[
    '/guides/buyer/live-auction/01-open-live-auction.png',
    '/guides/buyer/live-auction/02-select-auction-product.png',
    '/guides/buyer/live-auction/03-set-bid-amount.png',
    '/guides/buyer/live-auction/04-confirm-final-bid.png',
    '/guides/buyer/live-auction/05-bid-success.png',
    '/guides/buyer/live-auction/06-review-winning-item.png',
    '/guides/buyer/live-auction/07-enter-depositor.png',
    '/guides/buyer/live-auction/08-bank-transfer-info.png',
    '/guides/buyer/live-auction/09-vault-storage-period.png',
    '/guides/buyer/live-auction/10-request-shipping.png',
    '/guides/buyer/live-auction/11-shipping-request-success.png'
  ],
  '2026-08-24 21:05:00+09',
  '2026-08-24 21:05:00+09'
),
(
  '99000000-0000-4000-8000-000000000005',
  'notice',
  '[구매자 필독] 아카이브숍 장바구니·결제·배송 방법',
  E'아카이브숍의 1점 한정 상품을 장바구니로 구매하고 배송받는 순서입니다. 아래 사진의 빨간 표시를 따라 진행해 주세요.\n\n1. 아카이브숍에서 원하는 상품의 상태 등급, 가격, 판매 가능 여부를 확인합니다.\n2. 상품 상세에서 사진, 상태 설명, 가격과 보관 안내를 확인하고 장바구니에 담습니다.\n3. 장바구니에서 상품 수령 방법을 선택합니다. 바로 받으려면 즉시 발송을 선택하고 배송지를 확인합니다.\n4. 상품 금액, 센터별 배송비, 예상 결제 금액과 필수 약관을 확인한 뒤 결제하기를 누릅니다.\n5. 주문이 만들어지면 주문번호와 안내 계좌를 확인하고 정확한 금액을 결제 마감 전 입금합니다.\n6. 운영자가 입금을 확인하면 MY > 주문 내역에서 결제 완료·배송 접수 중 상태를 확인할 수 있습니다. 출고 후에는 배송 현황에서 송장을 확인합니다.\n\n보관함 묶음배송을 이용하려면\n- 상품 수령 방법에서 보관함 보관 후 묶음 배송을 선택합니다.\n- 결제 확인 후 상품이 보관함에 들어오면 다른 보관 상품과 함께 선택해 배송을 신청합니다.\n- 무료 보관 기간과 배송비는 장바구니 및 보관함 화면에 표시된 센터 정책을 확인해 주세요.\n\n꼭 확인해 주세요\n- 빈티지 상품은 단 1점이며 결제 완료 순으로 소유권이 확정됩니다.\n- 주문 후 화면에 표시된 결제 마감 안에 입금해 주세요.\n- 즉시 발송은 선택한 배송지로 바로 접수되므로 주소와 연락처를 결제 전에 확인하세요.\n- 상품 금액과 배송비를 나누지 말고 안내된 총액을 한 번만 입금하세요.',
  'owner',
  true,
  array[
    '/guides/buyer/archive-cart/01-select-product.png',
    '/guides/buyer/archive-cart/02-add-to-cart.png',
    '/guides/buyer/archive-cart/03-choose-immediate-shipping.png',
    '/guides/buyer/archive-cart/04-review-and-pay.png',
    '/guides/buyer/archive-cart/05-bank-transfer-order.png',
    '/guides/buyer/archive-cart/06-order-paid-shipping.png'
  ],
  '2026-08-24 21:04:00+09',
  '2026-08-24 21:04:00+09'
)
on conflict (id) do update set
  title = excluded.title,
  body = excluded.body,
  image_paths = excluded.image_paths,
  is_pinned = excluded.is_pinned,
  updated_at = excluded.updated_at;
