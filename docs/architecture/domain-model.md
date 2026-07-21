# 목표 도메인 모델

이 문서는 확정된 운영 원칙을 구현하기 위한 목표 모델이다. 현재 구현 여부는 [현행 감사](./current-state-audit.md)를 따른다.

## 핵심 관계

```text
Business
├─ Store 1 ── StoreMembership ── User(operator/staff)
├─ Store 2 ── StoreMembership ── User(operator/staff)
└─ FulfillmentCenter (초기 1곳)

Customer ── Cart ── Product(Store)
Customer ── Order ── OrderItem(Product, Store)
                    └─ StoreFulfillmentWork(Store)
Order ── Payment(manual transfer)
Order ── Shipment(정상 완료 주문당 1건)
OrderItem ── FulfillmentEvent ── FulfillmentCenter
```

## 엔터티 책임

### Business

단일 사업체 경계다. 초기에는 하나뿐이어도 매장과 중앙 출고지가 같은 사업체에 속한다는 사실을 명시한다. 외부 셀러 정산 경계로 사용하지 않는다.

### Store

상품의 운영 소유 단위다. 상품 등록·수정과 주문 상품 준비 업무를 구분한다. 결제와 고객 배송의 소유 단위는 아니다.

### StoreMembership

사용자와 매장의 관계 및 권한을 표현한다. 목표 필드는 `store_id`, `user_id`, `role(operator|staff)`, 세부 권한, 활성 상태다. 직원의 소속을 운영자 ID 하나에만 간접 연결하지 않고 매장 범위로 명시할 수 있어야 한다.

### Product

반드시 `store_id`를 가진다. 작성자는 권한 있는 자기 매장 사용자여야 한다. 승인 상태가 아니라 작성·공개·판매 상태를 가진다. 검수 메모와 상태 등급은 상품 정보이며 플랫폼 승인 절차가 아니다.

권장 상태:

- `draft`: 작성 중
- `active`: 공개·판매 중
- `reserved`: 장바구니 또는 결제 시간 제한으로 잠김
- `sold`: 결제가 확정된 판매 완료
- `hidden`: 운영상 비공개
- `archived`: 판매 이후 기록 보존

경매 종료 상태는 경매 도메인과 명확히 매핑하고 상품 공개 승인 상태와 혼합하지 않는다.

### Cart

고객당 통합 장바구니다. 서로 다른 매장의 상품을 함께 보유한다. 단일 재고 상품의 예약 만료와 중복 판매 방지는 서버가 관리한다.

### Order

고객에게 보이는 단일 구매 계약이다. 구매자, 합계, 배송비, 최종 금액, 배송지, 통합 결제 상태를 소유한다. 매장 수에 따라 분할되지 않는다.

### OrderItem

주문 당시 상품·가격·원천 매장을 스냅샷으로 보존한다. 상품별 취소와 물리적 이동을 추적하는 최소 단위다.

### StoreFulfillmentWork

통합 주문 안에서 특정 매장이 처리해야 할 상품 묶음이다. 결제나 별도 고객 주문이 아니다. 권장 상태는 `waiting_payment`, `preparing`, `ready_for_transfer`, `in_transit_to_center`, `center_received`, `issue`, `cancelled`다.

### Payment

통합 주문에 연결되는 결제 시도 또는 원장이다. 현재 구현체는 `manual_transfer`만 활성화한다. 입금 예정액, 누적 입금액, 입금자명, 확인 상태와 감사 기록을 보유한다. 향후 PortOne 어댑터가 같은 주문 결제 계약을 구현할 수 있어야 한다.

### FulfillmentCenter

매장 인계 이후 상품의 집하·보관·합포장·출고 책임 단위다. 초기 기본 출고지 한 곳을 지원하되 데이터 모델에서 주소와 활성 상태를 명시한다.

### FulfillmentEvent

상품별 물리적 이동과 확인 기록이다. 누가 언제 매장에서 확인했고, 중앙으로 인계했으며, 중앙에서 수령했는지 기록한다. 수정 가능한 현재 상태만 두지 말고 이벤트 또는 감사 로그를 함께 남긴다.

### StorageHolding

결제 완료 후 중앙 출고지에 보관되는 고객 소유 상품이다. `order_item_id`, `fulfillment_center_id`, 시작·만료 시각, 보관 위치, 출고 가능 상태를 가진다. 여러 과거 주문의 보관 상품도 새로운 배송 요청 하나로 합칠 수 있다.

### Shipment

중앙 출고지에서 고객으로 가는 최종 배송이다. 정상 흐름에서는 배송 요청 또는 통합 주문당 하나이며 송장도 하나다. 여러 `OrderItem`을 포함하되 매장별 Shipment를 만들지 않는다.

## 상태 분리

다음 상태는 한 필드에 합치지 않는다.

- 주문 계약 상태: 생성, 취소, 완료
- 결제 상태: 입금 대기, 일부 입금, 확인, 정정/취소
- 매장 처리 상태: 준비, 인계, 중앙 입고
- 중앙 출고 상태: 집하, 문제, 포장, 출고
- 배송 상태: 송장 생성, 발송, 배송 완료
- 상품별 보관 상태: 보관 중, 만료, 배송 요청됨

통합 상태는 하위 상태에서 서버가 계산하거나 엄격한 전이 함수로 변경한다. 브라우저가 금액이나 완료 여부를 직접 결정하지 않는다.
