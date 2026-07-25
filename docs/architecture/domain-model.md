# 현재 목표 도메인 모델

## 핵심 관계

```text
Business
├─ Store ── StoreMembership ── User(owner/operator/employee)
└─ shared payment and shipping settings

Member ── Cart ── Product(origin Store)
Member ── Order/auction payment ── PaymentLedger(manual transfer)
Paid source ── CustomerInventoryItem ── InventoryItemFulfillment(origin Store)
CustomerInventoryItem ── InventoryShipmentItem ── InventoryShipment
InventoryShipment ── ShipmentStoreWork(origin Store)
CustomerInventoryItem ── InventoryExceptionCase ── ManualRefund
StoreFinancialEntry ── origin Store | shared shipping revenue
```

## 핵심 엔터티

- `Business`: 외부 셀러가 아닌 단일 사업체 경계다.
- `Store`: 상품 등록, 보관, 출고, 상품 매출의 책임 단위다. 화면의 센터와 같은 의미다.
- `StoreMembership`: 사용자와 매장 관계 및 `manage_products`, `publish_products`, `prepare_orders`, `confirm_payments`, `create_shipments`, `manage_staff`, `view_reports` 같은 세부 권한을 보유한다.
- `Product`: 반드시 원등록 매장을 가진다. 상태 등급·하자·실측·사진은 객관적 상품 정보이지 제3자 보증이 아니다.
- `Order`: 여러 매장 상품을 포함하는 고객의 단일 구매 계약이다.
- `PaymentLedger`: 수동 입금 예정액, 누적액, 입금자명, 확인·취소·정정 이력을 보존한다.
- `CustomerInventoryItem`: 결제 확정으로 정확히 한 번 생성되는 상품별 고객 보관 권리다.
- `InventoryItemFulfillment`: 원등록 매장의 준비·보관·배송 요청 포함·출고 상태와 append-only 사건을 보존한다.
- `InventoryShipment`: 고객이 고른 여러 보관 상품의 배송 요청이다. 매장 경계를 넘을 수 있고 송장 하나를 가진다.
- `ShipmentStoreWork`: 배송 요청에서 특정 원등록 매장이 자기 상품에 수행하는 출고 작업이다.
- `InventoryExceptionCase`: 분실, 오프라인 판매, 추가 확인, 환불 필요 같은 상품별 보류 사건이다.
- `StoreFinancialEntry`: 상품 결제·취소·환불은 원등록 매장, 배송비는 사업체 공용 계정에 남기는 불변 원장이다.

## 호환성 필드

과거 중앙 물류 마이그레이션의 `fulfillment_center_id`, `center_stored`, `co_located` 값은 기존 FK와 감사 이력을 깨지 않기 위한 내부 호환 키다. 애플리케이션에는 센터 주소·매장 간 경로·중앙 입고 기능을 노출하지 않으며, 최신 직접-매장 RPC가 이 값을 서비스 내부에서만 관리한다.

## 상태 분리

주문, 결제, 고객 보관 권리, 매장 처리, 배송 요청, 송장, 예외·환불 상태를 한 필드에 합치지 않는다. 통합 상태는 서버가 하위 상태에서 계산하며 브라우저가 금액이나 완료 여부를 결정하지 않는다.
