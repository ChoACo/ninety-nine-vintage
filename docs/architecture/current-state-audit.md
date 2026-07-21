# 현행 코드 감사

조사 기준: `refactoring-cleanup` 브랜치, 커밋 `342b6de`

조사 방식: 코드 및 로컬 마이그레이션 정적 조사. 운영 DB 상태와 인증이 필요한 화면 동작은 이번 문서 작업에서 재검증하지 않았다.

> 구현 추적: `feature/manual-transfer-only` 브랜치에서 P0-2 코드와 마이그레이션을 작성했다. 아래 내용은 구현 전 기준선이며, 새 마이그레이션의 운영 DB 적용과 배포가 끝나기 전에는 운영 상태가 변경된 것으로 간주하지 않는다.

## 요약

현재 코드는 통합 장바구니, 매장 정보가 포함된 통합 주문, 수동 계좌이체 원장, 직원/운영자 역할, 고객 보관과 배송 요청을 이미 갖고 있다. 그러나 확정 목표에 필요한 중앙 출고지, 매장→중앙 인계 상태, 주문당 단일 송장 제약, 매장 멤버십 기반 세부 권한은 없다. PortOne은 격리된 미래 코드가 아니라 현재 런타임에서 전환 가능한 완전한 결제 경로다.

## 영역별 확인 결과

### 저장소와 런타임

- Next.js App Router, Supabase, PortOne SDK, Zustand를 사용한다. 근거: `package.json`.
- README는 Vercel을 운영 런타임으로 설명하지만 Cloudflare OpenNext 스크립트와 설정도 존재한다. 근거: `README.md`, `package.json`, `open-next.config.ts`, `wrangler.jsonc`.
- 패키지 관리자는 `npm@11.16.0`으로 선언되어 있다. 근거: `package.json`.
- 로컬 Supabase 마이그레이션은 조사 시점에 62개다. `db/schema.ts`는 의도적으로 비어 있으므로 현재 데이터 계약의 실질적 근거는 Drizzle 스키마가 아니라 순서대로 적용되는 `supabase/migrations/*.sql`이다. 근거: `supabase/migrations/`, `db/schema.ts`, `drizzle/meta/_journal.json`.

### 인증과 권한

- 데이터베이스 역할은 `owner`, `operator`, `employee`, `band_member`, `member`다. 근거: `src/lib/supabase/auth.ts`, `src/lib/commerce/server.ts`, `supabase/migrations/20260718030000_add_role_levels_revenue_enforcement.sql`.
- 직원은 `reports_to_operator_id`로 한 운영자에게 연결되고, 서버의 `effectiveOperatorId`가 그 운영자 ID를 사용한다. 근거: `src/lib/commerce/server.ts`, `supabase/migrations/20260718060000_hidden_owner_delegation_and_test_member.sql`.
- 매장은 단일 `operator_id`를 가진다. 매장 멤버십 테이블이나 직원별 세부 권한은 확인되지 않았다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`.
- 운영자 계정 수를 두 개로 맞추려는 프로비저닝 전제가 주석에 있으나 스키마 자체가 시스템 관리자 1명·운영자 정확히 2명을 일반 제약으로 표현하지는 않는다. 근거: `supabase/migrations/20260718010000_allow_configured_operator_ids.sql`.

### 상품

- 상품은 `store_id`, 보관 분류, 치수, 상태 등급, 검수 메모를 가진다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`.
- 운영자/직원 인증을 통과한 사용자는 자기 유효 운영자에 연결된 매장 범위에서 상품을 생성할 수 있다. 근거: `src/app/api/admin/operator/products/route.ts`, `supabase/migrations/20260721030000_harden_operator_product_mutations.sql`.
- 생성 상품은 즉시 `active`가 아니라 `pending`으로 저장된다. 공개는 별도 API/RPC를 호출하며 현재 API는 `owner` 또는 `operator`만 허용한다. 따라서 “권한 있는 직원의 즉시 등록·공개” 목표와 충돌한다. 근거: `src/app/api/admin/operator/products/route.ts`, `src/app/api/admin/operator/products/[id]/publish/route.ts`, `supabase/migrations/20260721020000_harden_operator_product_publishing.sql`.
- `inspection_notes`는 존재하지만 이것이 승인 워크플로인지 단순 상품 정보인지 UI 의미를 추가 확인해야 한다.

### 장바구니와 통합 주문

- 장바구니는 고객·상품 복합 키이며 매장별 장바구니로 분리되지 않는다. API는 고정가 상품 예약 RPC를 사용한다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`, `src/app/api/cart/route.ts`.
- `commerce_orders`는 고객별 통합 주문이며 `commerce_order_items`가 상품과 `store_id`를 가진다. 별도 `store_orders` 또는 매장 처리 업무 엔터티는 없다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`.
- 주문 생성은 여러 상품 ID를 한 RPC에 전달하고 멱등 키를 사용한다. 근거: `src/app/api/orders/checkout/route.ts`, `supabase/migrations/20260720180000_add_commerce_portone_checkout.sql`의 최종 `create_commerce_order` 정의.
- 경매 낙찰 정산은 고정가 통합 주문과 별도 테이블/흐름을 유지한다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`의 테이블 주석과 경매 관련 후속 마이그레이션. 통합 주문 정책에 경매 낙찰을 언제 합칠지는 아직 불명확하다.

### 수동 계좌이체

- 결제 모드는 `manual_transfer | portone`이며 런타임 설정으로 전환 가능하다. 근거: `src/lib/commerce/paymentMode.ts`, `src/app/api/orders/checkout/route.ts`, `supabase/migrations/20260720170000_server_sync_manual_transfer_runtime.sql`.
- 수동입금은 통합 주문별 `commerce_order_transfers`와 append-only 성격의 `manual_transfer_payment_ledger`를 사용한다. 일부 입금, 확인, 취소/역분개 상태가 있다. 근거: `supabase/migrations/20260719150000_commerce_runtime.sql`, `supabase/migrations/20260720150000_manual_transfer_operator_ledger.sql`, `supabase/migrations/20260720160000_manual_transfer_shipping_fee_ledger.sql`.
- 운영자 주문 API는 자기 매장 상품이 포함된 통합 주문과 해당 통합 주문의 입금 원장을 조회한다. 한 주문이 여러 매장에 걸치면 각 관련 운영자에게 같은 주문 입금 정보가 보일 수 있다. 근거: `src/app/api/admin/operator/orders/route.ts`.
- 단순 확인 API는 의도적으로 차단되고 실제 입금자명·금액을 원장에 쓰도록 요구한다. 근거: `src/app/api/admin/operator/orders/[id]/confirm/route.ts`, `src/app/api/admin/operator/transfers/[id]/ledger/route.ts`.
- 모든 활성 운영자가 모든 통합 입금을 조회해야 하는지, 주문에 포함된 매장 운영자만 조회해야 하는지는 현재 구현과 제품 문구 사이에 해석 여지가 있다. 구현 전에 확정해야 한다.

### PortOne

- PortOne은 현재 어댑터 보관 상태가 아니라 체크아웃 준비, 브라우저 결제, 서버 동기화, 웹훅, 결제 완료 화면까지 연결된 활성 후보 경로다. 근거: `src/app/api/orders/checkout/route.ts`, `src/app/api/payments/prepare/route.ts`, `src/app/api/payments/sync/route.ts`, `src/app/api/webhook/portone/route.ts`, `src/app/(shop)/payment/complete/page.tsx`, `src/lib/portone/`.
- DB에도 PortOne 결제 준비와 이중 수동입금 방지 트리거가 있다. 근거: `supabase/migrations/20260720180000_add_commerce_portone_checkout.sql`.
- 목표인 “수동이체만 활성, PortOne 격리 보존”을 만족하려면 런타임 전환, UI 노출, 공개 API 진입점을 단계적으로 차단하되 DB 기록과 어댑터 코드는 보존해야 한다.

### 보관

- 결제된 주문 상품은 `storage_expires_at`을 가지며 소형 14일, 대형 7일이라는 기존 주석 정책이 있다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`.
- 고객 보관 API는 결제된 주문 상품과 경매 낙찰 상품을 함께 반환한다. 근거: `src/app/api/account/storage/route.ts`.
- 물리적 중앙 출고지, 선반/위치, 중앙 입고자, 입고 시각을 표현하는 엔터티는 확인되지 않았다. 현재 보관 만료는 시간 중심 모델이다.

### 배송

- `shipping_requests`와 `shipping_request_items`는 여러 상품을 한 배송 요청에 묶고 택배사·송장번호를 요청에 저장한다. 근거: `supabase/migrations/20260718000000_add_member_operations_and_staff_products.sql`, `src/app/api/shipping/requests/route.ts`.
- 운영자 배송 API는 배송 요청 단위로 송장을 입력하고 발송 처리한다. 근거: `src/app/api/admin/operator/shipping/route.ts`.
- 중앙 출고지 테이블, 매장 인계, 중앙 입고, 전 상품 집하 완료 후 송장 생성 제약은 확인되지 않았다.
- DB에서 주문당 또는 배송 요청당 활성 송장 정확히 1개를 보장하는 별도 `shipments` 엔터티/유니크 제약은 확인되지 않았다. 현재 송장 필드는 `shipping_requests`에 직접 있다.
- 배송비는 상품 주문 시점과 보관 상품 배송 요청 시점에 서로 다른 흐름이 존재한다. 근거: `commerce_orders.shipping_fee`, `shipping_fee_payments`, `src/app/api/shipping/requests/route.ts`. 통합 정책에서 언제 배송비를 한 번 받는지 명확화가 필요하다.

### 운영자 콘솔

- 상품, 주문, 매출, 배송, 회원, 상담 화면이 존재한다. 근거: `src/app/(admin)/admin/operator/layout.tsx`와 하위 페이지, `src/components/admin/operator/`.
- 현재 콘솔은 매장 준비→중앙 인계→중앙 입고→합포장 흐름을 제공하지 않는다.
- 중앙 출고 담당자가 운영자 역할과 별도인지, 두 운영자 중 권한 보유자가 담당하는지는 확정되지 않았다. 역할을 새로 만들기 전에 세부 권한으로 해결 가능한지 결정해야 한다.

## 구현 전 반드시 확정할 미결 사항

1. 경매 낙찰 상품을 고정가 장바구니의 같은 주문에 합칠 수 있는가, 아니면 결제 전 통합 주문으로 승격하는가.
2. 공용 입금 목록을 모든 운영자가 보는가, 주문 관련 매장 운영자만 보는가.
3. 직원의 입금 확인과 중앙 출고 권한 기본값.
4. 중앙 출고 담당자를 별도 역할로 둘지 기존 사용자에게 권한만 부여할지.
5. 주문 즉시 배송과 보관 후 배송의 배송비 부과 시점 및 중복 방지 규칙.
6. 일부 상품 문제·취소 시 고객과 합의가 지연될 때 나머지 상품의 최대 대기 정책.
7. `inspection_notes`와 condition grade를 유지하되 승인 절차로 오해되지 않게 할 UI 용어.
8. 기존 `pending` 상품 상태를 `draft`로 의미 변경할지, 즉시 공개 생성과 별도 임시 저장을 추가할지.

추측으로 채우지 않고 각 항목이 결정된 뒤 마이그레이션과 API 계약을 작성한다.
