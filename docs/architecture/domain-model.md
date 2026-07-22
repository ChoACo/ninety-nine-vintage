# 목표 도메인 모델

이 문서는 확정된 운영 원칙을 구현하기 위한 목표 모델이다. 현재 구현 여부는 [현행 감사](./current-state-audit.md)를 따른다.

## 핵심 관계

```text
Business
├─ Store A ── StoreMembership ── User(operator/staff)
├─ Store B ── StoreMembership ── User(operator/staff)
├─ StoreFulfillmentRoute(Store → Center, transfer|co_located)
└─ FulfillmentCenter B (유일한 중앙 발송지)

Customer ── Cart ── Product(origin Store)
Customer ── Order ── OrderItem(Product, origin Store) ── Payment(manual transfer)
Customer ── Auction/second-chance payment
Payment source ── CustomerInventoryItem(Product, paid entitlement)
CustomerInventoryItem ── InventoryItemFulfillment ── FulfillmentCenter B
CustomerInventoryItem ── InventoryShipmentItem ── InventoryShipment(고객 배송 요청)
InventoryShipment ── ShipmentStoreWork(origin Store)
CustomerInventoryItem ── InventoryExceptionCase ── ManualRefund
StoreFinancialEntry ── origin Store | central delivery revenue
```

## 엔터티 책임

### Business

단일 사업체 경계다. 초기에는 하나뿐이어도 매장과 중앙 출고지가 같은 사업체에 속한다는 사실을 명시한다. 외부 셀러 정산 경계로 사용하지 않는다.

### Store

상품의 운영 소유 단위다. 상품 등록·수정, 매장별 준비·인계 업무, 상품 매출 귀속을 구분한다. 결제와 고객 배송의 소유 단위는 아니다.

### StoreMembership

사용자와 매장의 관계 및 권한을 표현한다. 목표 필드는 `store_id`, `user_id`, `role(operator|staff)`, 세부 권한, 활성 상태다. 직원의 소속을 운영자 ID 하나에만 간접 연결하지 않고 매장 범위로 명시할 수 있어야 한다.

### Product

반드시 `store_id`를 가진다. 작성자는 권한 있는 자기 매장 사용자여야 한다. 승인 상태가 아니라 작성·공개·판매 상태를 가진다. 상태 등급, 하자, 실측, 사진은 객관적인 상품 정보이며 제3자 확인이나 품질 보증을 뜻하지 않는다.

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

고객에게 보이는 단일 구매 계약이다. 구매자, 상품 합계, 최종 금액, 통합 결제 상태를 소유한다. 매장 수에 따라 분할되지 않는다. 배송비와 배송지는 결제 시점이 아니라 고객의 상품 단위 배송 요청에 연결한다.

### OrderItem

주문 당시 상품·가격·원천 매장을 스냅샷으로 보존한다. 상품별 취소와 물리적 이동을 추적하는 최소 단위다.

### StoreFulfillmentWork

통합 주문 또는 배송 요청에서 특정 원등록 매장이 처리해야 할 상품 묶음이다. 결제나 별도 고객 주문이 아니다. A는 `preparing → ready_for_transfer → in_transit_to_center`, B는 `preparing → ready_for_transfer`의 현장 인계로 진행하며, B 중앙 수령과 보관은 별도 상품별 사건으로 기록한다.

### Payment

통합 주문, 경매·차순위 구매, 또는 배송비에 연결되는 결제 시도 또는 원장이다. 현재 구현체는 `manual_transfer`만 활성화한다. 입금 예정액, 누적 입금액, 입금자명, 확인 상태와 감사 기록을 보유한다. 공용 운영 대기열은 결제 종류와 관계없이 이 원장을 조회하며, 확정은 원장 CAS·멱등 키와 상품별 보관 권리 생성을 함께 처리한다. PortOne은 과거 이력과 향후 격리 어댑터로만 보존한다.

### FulfillmentCenter

매장 인계 이후 상품의 집하·보관·합포장·출고 책임 단위다. 초기 기본 출고지 한 곳을 지원하되 데이터 모델에서 주소와 활성 상태를 명시한다.

### FulfillmentEvent

상품별 물리적 이동과 확인 기록이다. 누가 언제 매장에서 확인했고, 중앙으로 인계했으며, 중앙에서 수령했는지 기록한다. 수정 가능한 현재 상태만 두지 말고 이벤트 또는 감사 로그를 함께 남긴다.

### CustomerInventoryItem

결제 확정으로 생성되는 상품별 구매자 보관 권리다. 고정가 주문 상품, 경매·차순위 확정 결제, 과거 결제 source 중 하나를 불변으로 참조하며 source마다 정확히 하나만 생성된다. 원등록 매장, 결제 배분액, 결제 시각, 소유권 상태를 보존한다. 실제 B 입고 전에도 구매자 보관함에 `보관 준비 중`으로 보일 수 있으나 물리 보관 사실을 추정하지 않는다.

### InventoryItemFulfillment

상품별 물리 상태와 책임 구간이다. route 스냅샷, 중앙센터, 현재 상태, 보관 위치, 최초 B 보관 시각, 버전을 보존하고 append-only 이벤트를 남긴다. 보관 기간은 최초 `center_stored`에서 시작하며 재입고로 초기화하지 않는다.

### InventoryShipment

고객이 선택한 `CustomerInventoryItem`의 배송 요청이다. 여러 주문과 구매 유형의 상품을 포함할 수 있고, 한 요청은 B에서 하나의 합포장과 하나의 송장을 가진다. 한 상품은 진행 중인 요청 하나에만 포함되며, 같은 원 주문의 나머지 상품은 이후 다른 요청으로 보낼 수 있다. 포장과 송장은 활성 상품의 B 보관, 원등록 매장 작업 완료, 배송비 확정, 미해결 예외 없음이 모두 충족될 때만 가능하다.

### ShipmentStoreWork

하나의 `InventoryShipment`에서 원등록 매장이 수행하는 집합 작업이다. 매장은 자기 상품만 부분 또는 전체 선택해 `collecting → outbound_complete`로 전이한다. 이 작업은 고객 결제나 배송 요청을 분할하지 않으며, 완료되면 B 포장 대기열의 선행 조건 하나를 충족한다.

### InventoryExceptionCase와 ManualRefund

상품 검수 필요, 분실, 오프라인 판매, 추가 대기, 환불 필요를 상품 단위로 기록한다. 활성 사건은 해당 배송 상품을 보류하고, 재개·다음 배송으로 제외·환불 중 하나의 명시적 해결만 허용한다. `ManualRefund`는 입금 원장 역분개와 별개의 고객 출금 기록이며, 원등록 매장·센터는 보고하고 Owner만 승인·완료한다.

### StoreFinancialEntry

불변 매출 원장이다. 상품 결제·환불은 `origin_store_id`에, 배송비·배송비 면제 조정은 중앙 사업체 계정에 기록한다. 입금 확인을 수행한 운영자나 매장에는 매출을 귀속하지 않는다.

## 상태 분리

다음 상태는 한 필드에 합치지 않는다.

- 주문 계약 상태: 생성, 취소, 완료
- 결제 상태: 입금 대기, 일부 입금, 확인, 정정/취소
- 구매자 소유권 상태: 활성 보관, 환불 대기, 환불 완료, 취소
- 매장 처리 상태: 준비, 인계, 중앙 이동
- 중앙 물리 상태: 중앙 수령, B 보관, 문제, 포장, 출고
- 배송 상태: 송장 생성, 발송, 배송 완료
- 상품별 배송 상태: 선택 가능, 배송 요청됨, 보류, 제외, 발송됨
- 예외·환불 상태: 검수 필요, 분실, 오프라인 판매, 추가 대기, 환불 요청·승인·완료

통합 상태는 하위 상태에서 서버가 계산하거나 엄격한 전이 함수로 변경한다. 브라우저가 금액이나 완료 여부를 직접 결정하지 않는다.
