# 현행 코드 감사

조사 기준: `refactoring-cleanup` 브랜치, 커밋 `342b6de`

조사 방식: 코드 및 로컬 마이그레이션 정적 조사. 운영 DB 상태와 인증이 필요한 화면 동작은 이번 문서 작업에서 재검증하지 않았다.

> 구현 추적: `feature/manual-transfer-only` 브랜치에서 P0-2 코드와 마이그레이션을 작성했다. 아래 내용은 구현 전 기준선이며, 새 마이그레이션의 운영 DB 적용과 배포가 끝나기 전에는 운영 상태가 변경된 것으로 간주하지 않는다.

> 2026-07-21 후속 추적: `codex/fix-manual-transfer-atomic-confirmation` 브랜치에서 P0-5의 직접 확정 차단, 처리자별 브라우저 재시도 키를 포함한 입금 영수증 멱등성, 원장 합계·버전 CAS, 다매장 공용 입금 큐, 정방향/역분개 잠금 순서, 경매 부분입금 자동 만료 보류와 원래 기한 snapshot, 숨은 Owner 테스트 계정의 운영자 RPC 차단, 확정된 통합 주문 역분개 시 고객 정정 알림, 주문-입금요청 단일 RPC 경계를 구현했다. 고정가 체크아웃은 경매 blackout 중에도 선택한 고정가 상품만 정확히 마감할 수 있고, 서버 service-key 직접 테이블 접근 권한은 저장소가 실제 사용하는 21개 읽기와 6개 mutation 종류로 명시했다.

> 새 `20260721134000`~`20260721143000` 6개 마이그레이션은 운영 DB 미적용이다. 64개 기존 마이그레이션을 재생한 격리 PostgreSQL 17.10에서 6개 전체 적용, 기존/신규 부분입금 기한 보존, 잔액 0원 역분개 복원, 동시 영수증 CAS, 멱등 replay 응답의 원장 버전, replay 시점의 현재 매장 권한 재검사, 숨은 테스트 계정 경계, service-role ACL을 검증했다. 구 역분개로 만든 0원 `awaiting_manual_transfer` 주문과 `settled` 구매 제안 fixture는 2단계가 상태를 바꾸지 않고 실패하며 hold DDL이 rollback되고 cron이 비활성 상태로 유지되는 것도 확인했다. 이 검증은 실제 Supabase/PostgREST와 pg_cron C 확장 worker가 아닌 순수 SQL cron 모형을 사용했으므로 운영 적용·배포·인증 화면 검증을 대신하지 않는다. 적용 전 운영자·Owner mutation을 중지하고 0단계에서 `process-auction-purchase-offers` pg_cron을 비활성화한 뒤 실행 호출을 드레인해야 한다. 해당 불일치는 사전 데이터 감사와 승인된 reconciliation이 필요하다. 구매 제안 연결 입금의 잘못된 부분입금을 되돌려 자동 만료로 복귀시키는 Owner 재정산 상태와 경매·배송비 원장 이력/정정 UI는 아직 없다.

## 요약

조사 기준선의 코드는 통합 장바구니, 매장 정보가 포함된 통합 주문, 수동 계좌이체 원장, 직원/운영자 역할, 고객 보관과 배송 요청을 이미 갖고 있다. 그러나 확정 목표에 필요한 중앙 출고지, 매장→중앙 인계 상태, 주문당 단일 송장 제약, 매장 멤버십 기반 세부 권한은 없다. 기준선에서 PortOne은 격리된 미래 코드가 아니라 런타임에서 전환 가능한 완전한 결제 경로였다. 후속 P0-2 로컬 구현은 이를 수동이체 단일 활성 경로로 닫았지만 운영 DB 적용과 배포는 아직 하지 않았다.

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
- 후속 P0-5 구현은 고정가 통합 주문의 공용 입금 큐를 시스템 관리자와 모든 활성 운영자에게 전역으로 제공한다. 주문 참여 매장 여부로 제한하지 않으며, 직원(`employee`)은 `store_memberships`와 `confirm_payments` 권한 기반이 생기기 전까지 API와 RPC에서 제외한다. 근거: `src/app/api/admin/operator/orders/route.ts`, `src/app/api/admin/operator/transfers/[id]/ledger/route.ts`, `supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql`.
- 공용 큐는 타 매장 상품 원문 전체가 아니라 결제 대조에 필요한 주문·회원 식별자, 상품 요약, 예정/누적/잔액, 상태, 계좌 스냅샷과 원장 감사 정보만 명시적 필드 목록으로 투영한다. 원장 합계·행 수와 주문별 상품 요약은 Data API 행 제한과 무관한 집계 RPC에서 계산하며, 직접 테이블 RLS는 회원 본인의 주문·입금 기록만 허용한다. 브라우저는 입금 mutation 직전에 현재 인증 계정을 다시 확인하고 로그아웃·계정 전환 때 공용 큐를 비운다. 근거: `src/app/api/admin/operator/orders/route.ts`, `src/components/admin/operator/OperatorOrdersConsole.tsx`, `supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql`.
- 단순 확인 API는 의도적으로 차단되고 실제 입금자명·금액을 원장에 쓰도록 요구한다. 근거: `src/app/api/admin/operator/orders/[id]/confirm/route.ts`, `src/app/api/admin/operator/transfers/[id]/ledger/route.ts`.
- 경매 부분입금은 첫 입금 시 주문 기한과 구매 제안 기한의 정확한 원값을 주문 행에 보존한 뒤 현재 기한만 `NULL`로 보류한다. 원기한 자체가 `NULL`인 면제 주문도 hold 시각으로 미보류 상태와 구분한다. 구매 제안 미연결 주문의 순원장이 0원이 되면 저장한 원값을 복원하며, 구매 제안 연결 역분개는 전용 Owner 재정산 계약 전까지 실패-폐쇄한다. 근거: `supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql`.
- 숨은 Owner 테스트 회원은 Owner 전용 proxy 계약을 유지한다. 일반 운영자는 대기 목록뿐 아니라 ID를 알고 있어도 경매 잔액 조회·입금 기록·역분개 RPC에서 차단된다. 근거: `supabase/migrations/20260718060000_hidden_owner_delegation_and_test_member.sql`, `supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql`.

### PortOne

다음 두 항목은 구현 전 조사 기준선 설명이다. 후속 P0-2 로컬 구현에서는 PortOne 공개 실행 경로를 비활성화하고 어댑터와 기록만 보존했으며, 운영 배포는 대기 중이다.

- 기준선에서 PortOne은 어댑터 보관 상태가 아니라 체크아웃 준비, 브라우저 결제, 서버 동기화, 웹훅, 결제 완료 화면까지 연결된 활성 후보 경로였다. 근거: `src/app/api/orders/checkout/route.ts`, `src/app/api/payments/prepare/route.ts`, `src/app/api/payments/sync/route.ts`, `src/app/api/webhook/portone/route.ts`, `src/app/(shop)/payment/complete/page.tsx`, `src/lib/portone/`.
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
2. 직원의 입금 확인과 중앙 출고 권한 기본값.
3. 중앙 출고 담당자를 별도 역할로 둘지 기존 사용자에게 권한만 부여할지.
4. 주문 즉시 배송과 보관 후 배송의 배송비 부과 시점 및 중복 방지 규칙.
5. 일부 상품 문제·취소 시 고객과 합의가 지연될 때 나머지 상품의 최대 대기 정책.
6. `inspection_notes`와 condition grade를 유지하되 승인 절차로 오해되지 않게 할 UI 용어.
7. 기존 `pending` 상품 상태를 `draft`로 의미 변경할지, 즉시 공개 생성과 별도 임시 저장을 추가할지.

추측으로 채우지 않고 각 항목이 결정된 뒤 마이그레이션과 API 계약을 작성한다.
