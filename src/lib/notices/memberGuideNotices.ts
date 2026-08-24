export const MEMBER_GUIDE_NOTICE_IDS = [
  "99000000-0000-4000-8000-000000000002",
  "99000000-0000-4000-8000-000000000003",
  "99000000-0000-4000-8000-000000000004",
  "99000000-0000-4000-8000-000000000005",
] as const;

export type MemberGuideNoticeId = (typeof MEMBER_GUIDE_NOTICE_IDS)[number];

export type MemberGuideNotice = {
  id: MemberGuideNoticeId;
  title: string;
  body: string;
  image_paths: string[];
  created_at: string;
  updated_at: string;
};

export const MEMBER_GUIDE_NOTICE_ORDER = new Map<string, number>(
  MEMBER_GUIDE_NOTICE_IDS.map((id, index) => [id, index]),
);

export const GUIDE_IMAGE_CAPTIONS: Readonly<Record<string, string>> = {
  "/guides/operator/product-registration-mobile/01-home-open-menu.png": "모바일 홈 왼쪽 위 전체 메뉴를 엽니다.",
  "/guides/operator/product-registration-mobile/02-select-work.png": "로그인 메뉴에서 업무를 선택합니다.",
  "/guides/operator/product-registration-mobile/03-open-operator-menu.png": "판매센터 상단의 업무 메뉴를 엽니다.",
  "/guides/operator/product-registration-mobile/04-new-product-menu.png": "상품 및 재고에서 새 상품 등록을 선택합니다.",
  "/guides/operator/product-registration-mobile/05-select-instant-purchase.png": "즉시구매 상품 등록을 선택합니다.",
  "/guides/operator/product-registration-mobile/06-upload-product-photo.png": "대표 사진을 포함해 상품 사진을 올립니다.",
  "/guides/operator/product-registration-mobile/08-price-storage-defects.png": "상품명, 카테고리와 실측 정보를 입력합니다.",
  "/guides/operator/product-registration-mobile/07-product-info-measurements.png": "가격, 설명, 보관 크기와 하자 여부를 확인합니다.",
  "/guides/operator/product-registration-mobile/09-publish-and-submit.png": "공개 방식을 확인한 뒤 등록 버튼을 누릅니다.",
  "/guides/operator/product-registration-mobile/10-registration-complete.png": "등록 완료 안내가 표시되면 상품 목록에서 다시 확인합니다.",
  "/guides/operator/product-registration-pc/02-new-product-menu.png": "PC 홈 상단에서 업무를 선택합니다.",
  "/guides/operator/product-registration-pc/03-select-instant-purchase.png": "새 상품 등록 메뉴에서 즉시구매 등록 화면으로 이동합니다.",
  "/guides/operator/product-registration-pc/04-upload-product-photo.png": "대표 사진을 포함해 상품 사진을 올립니다.",
  "/guides/operator/product-registration-pc/06-price-storage-defects.png": "상품 정보, 가격, 설명, 보관 크기와 하자 여부를 확인합니다.",
  "/guides/operator/product-registration-pc/08-registration-complete.png": "등록 완료 안내가 표시되면 상품 목록에서 다시 확인합니다.",
  "/guides/buyer/live-auction/01-open-live-auction.png": "모바일 홈에서 라이브 옥션으로 이동합니다.",
  "/guides/buyer/live-auction/02-select-auction-product.png": "참여할 경매 상품의 경매 참여를 선택합니다.",
  "/guides/buyer/live-auction/03-set-bid-amount.png": "입찰 금액을 정하고 취소 불가 약관을 확인합니다.",
  "/guides/buyer/live-auction/04-confirm-final-bid.png": "최종 입찰 금액을 다시 확인한 뒤 입찰을 확정합니다.",
  "/guides/buyer/live-auction/05-bid-success.png": "내 입찰 반영 여부와 현재 최고가를 확인합니다.",
  "/guides/buyer/live-auction/06-review-winning-item.png": "경매 종료 후 MY 결제하기에서 낙찰 상품과 금액을 확인합니다.",
  "/guides/buyer/live-auction/07-enter-depositor.png": "입금자명을 입력하고 상품 금액과 배송비를 확인합니다.",
  "/guides/buyer/live-auction/08-bank-transfer-info.png": "안내된 계좌, 입금자명, 총액과 결제 마감을 확인해 한 번만 입금합니다.",
  "/guides/buyer/live-auction/09-vault-storage-period.png": "입금 확인 후 보관함에서 상품과 남은 무료 보관 기간을 확인합니다.",
  "/guides/buyer/live-auction/10-request-shipping.png": "보낼 상품과 배송지를 선택한 뒤 배송을 신청합니다.",
  "/guides/buyer/live-auction/11-shipping-request-success.png": "배송 접수 완료 안내를 확인하고 이후 배송 현황에서 진행 상태를 확인합니다.",
  "/guides/buyer/archive-cart/01-select-product.png": "아카이브숍에서 상태와 가격을 보고 원하는 상품을 선택합니다.",
  "/guides/buyer/archive-cart/02-add-to-cart.png": "상세 화면에서 상품 상태와 보관 안내를 확인하고 장바구니에 담습니다.",
  "/guides/buyer/archive-cart/03-choose-immediate-shipping.png": "장바구니에서 즉시 발송과 배송지를 확인합니다.",
  "/guides/buyer/archive-cart/04-review-and-pay.png": "상품 금액, 배송비, 최종 결제액과 필수 약관을 확인하고 결제합니다.",
  "/guides/buyer/archive-cart/05-bank-transfer-order.png": "생성된 주문번호와 안내 계좌를 확인해 정확한 금액을 입금합니다.",
  "/guides/buyer/archive-cart/06-order-paid-shipping.png": "MY 주문 내역에서 결제 완료와 배송 접수 상태를 확인합니다.",
};
