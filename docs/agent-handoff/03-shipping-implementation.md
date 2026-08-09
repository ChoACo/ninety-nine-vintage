# 03. Shipping P1-3 Stage 2 구현

작성일: 2026-08-08 (Asia/Seoul)

BASE COMMIT: `c36a2db5f6a9a808fe0768a2c19927524c67ee89`

FINAL HEAD: `c36a2db5f6a9a808fe0768a2c19927524c67ee89` (변경사항은 uncommitted 상태로 남겨둠; 커밋은 사용자 요청이 있을 때만 수행)

## 판정 범위

- `LOCAL_CONFIRMED`: checkout의 코드, migration, 테스트에서 확인한 사실.
- `PRODUCTION_UNVERIFIED`: 운영 DB, 운영 환경변수, 실제 운영 행/트래픽을 이번 단계에서 확인하지 못한 사실.

## FILES CHANGED

- `supabase/migrations/20260808000000_retire_commerce_shipment_writes.sql` (신규)
- `src/app/api/shipping/requests/route.ts`
- `src/app/api/admin/owner/shipping/[id]/route.ts`
- `src/components/features/account/AccountDashboard.tsx`
- `scripts/test-canonical-commerce-shipment.ps1`
- `tests/core/canonical-commerce-shipment.test.mjs`
- `tests/core/unified-inventory-fulfillment-v2.test.mjs`
- `tests/core/p1-3-shipment-contract.test.mjs`
- `tests/sql/canonical-commerce-shipment/30-retire-writes.sql` (신규)

## MIGRATIONS ADDED

- `20260808000000_retire_commerce_shipment_writes.sql`

## TESTS ADDED

- `tests/sql/canonical-commerce-shipment/30-retire-writes.sql` — SQL 계약 테스트 (docker suite에 `30-retire-writes.sql` 단계로 배선)
- `tests/core/p1-3-shipment-contract.test.mjs` — Stage 2 migration revoke/guard/compat helper 계약, legacy API 410 차단 계약
- `tests/core/canonical-commerce-shipment.test.mjs` — buyer/owner API가 legacy RPC 미호출, legacy `orderId`/owner tracking 경로 410, 고객 UI v2-only surface 계약 갱신
- `tests/core/unified-inventory-fulfillment-v2.test.mjs` — dashboard v2-only 어서션 갱신

## TEST RESULTS

- `npm test` — pass 279 / fail 0 (tests/core/*.test.mjs 전체)
- `npm run lint` — pass (eslint . 경고 없음)
- `npx tsc --noEmit` — pass (오류 없음)
- `npm run build` — pass (Next.js production build 완료)
- canonical-commerce-shipment docker SQL suite — `NOT RUN` (Docker daemon 미기동; `docker version`에서 npipe 접속 실패). 실행 가능 환경에서 `npm run verify:canonical-shipment-db:docker` 또는 `scripts/test-canonical-commerce-shipment.ps1`로 재실행 필요.

## PLAN DEVIATIONS

1. `request_commerce_order_shipment`는 부분 제한이 아니라 완전 revoke (from public, anon, authenticated, service_role). 계획 대비 안전한 쪽으로 강화 — src에 남은 caller가 없어 보존 이유가 사라짐.
2. `pack/ship/correct_commerce_*` 동일하게 완전 revoke. `get_commerce_shipment_queue`는 read-only 유지 (revoke하지 않음).
3. 신규 compatibility read helper는 `app_private.get_commerce_shipment_compat(uuid)` 단일 함수로 구현하고 생성 직후 revoke-all. legacy link 재사용은 신규 테이블 없이 `customer_inventory_items.legacy_commerce_shipment_id` → `inventory_shipment_items` join으로 해결.
4. `shipping_requests` guard는 `before insert or delete`로 한정 (UPDATE는 `anonymize_member_shipping_history`의 계정 삭제 member_id null 처리용으로 열어둠). `commerce_shipments` 및 manifest/event 4개 테이블은 `before insert or update or delete`로 fail-closed (table owner 포함).
5. `commerce_shipment_events` append-only carve-out은 두지 않고 나머지 테이블과 동일한 immutable guard 적용. 기존 events RLS가 강하므로 안전하고, 테스트 fixture는 10-계약 단계의 fixture를 조회하도록 조정.
6. `commerce_shipment_items` trigger는 manifest 행을 직접 커버.
7. 기준 HEAD와 동일 커밋 유지 (커밋 안 함) — 이 문서만 추가.

## KNOWN RISKS

- Docker 미기동으로 신규 SQL 계약 테스트(`30-retire-writes.sql`)는 로컬 실행 전 검증되지 않음. migration SQL 자체는 기존 gate-migration 패턴을 그대로 따르며 core 계약 테스트로 문법·구조를 확인.
- `20260807000000_cart_reservation_abuse_limits.sql`는 여전히 local-only로 `npm run verify:migrations`가 red — 이번 작업 범위 외 기존 격차.
- 운영 DB에 아직 적용·검증되지 않은 신규 migration — 재미그레이션 환경(전 단계 포함)에서 전체 성공해야 안전.

## PRODUCTION VERIFICATION REQUIRED

- `20260808000000_retire_commerce_shipment_writes.sql`의 production 적용 및 trigger(`shipping_requests_retired_writes`, `commerce_shipments_immutable_history`, `commerce_shipment_orders_immutable_history`, `commerce_shipment_items_immutable_history`, `commerce_shipment_events_immutable_history`, `commerce_shipment_reconciliation_cases_immutable_history`) 활성 상태.
- revoke 후 legacy RPC 4종이 운영 env에서 42501/function not found로 실패하는지, v2 경로는 정상 동작하는지 smoke.
- `get_commerce_shipment_compat(uuid)`가 기존 운영 history 행에서 sourceKind/sourceId/items/linkedInventoryShipmentIds를 올바르게 반환하는지 확인.
- 기존 `20260805010000_enforce_inventory_shipment_mutation_gate.sql`의 운영 적용 및 trigger 활성 상태 (이전 단계에서 `PRODUCTION_UNVERIFIED`로 남은 항목).
- production migration parity 전체 결과와, 세 shipment 모델별 행 수·status 분포·active/tracking 중복 검사.
- 고객 배송 이력 read, 운영자 pack/ship/tracking correction smoke, 기존 history 비파괴(행 수 동일) 확인.
- 계정 삭제 flow(`anonymize_member_shipping_history`)가 shipping_requests UPDATE 경유로 정상 동작하는지 확인 (guard가 UPDATE를 열어두었기 때문).
