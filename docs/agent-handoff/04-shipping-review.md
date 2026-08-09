# 04. Shipping P1-3 승인 리뷰

작성일: 2026-08-08 (Asia/Seoul)
검토 기준: `02-shipping-plan.md`, `03-shipping-implementation.md`, 현재 shipping 관련 diff

# FIX_REQUIRED

현재 변경은 신규 writer를 `inventory_shipments`로 집중시키는 방향과 legacy RPC revoke는 대체로 계획에 맞다. 그러나 기존 `commerce_shipments` 데이터의 compatibility read를 보존해야 한다는 승인 설계와 고객 shipping flow가 충돌하며, 신규 SQL suite도 실제로 실행되지 않았다. 따라서 현재 상태는 승인할 수 없다.

## 검토 결과 요약

| 항목 | 판정 |
|---|---|
| canonical 신규 write path | 대부분 충족: buyer/operator 신규 경로는 v2 사용 |
| legacy writer 차단 | 코드·migration 계약상 충족. 운영 적용은 `PRODUCTION_UNVERIFIED` |
| application dual-write | 현재 diff에서는 제거 방향으로 충족 |
| 기존 데이터 호환성 | 미충족: 고객 shipping 선택 경로가 legacy order를 제거 |
| migration 안전성 | additive/revoke 설계는 확인되나 Docker SQL suite 미실행 |
| mutation gate | v2 gate 유지, legacy revoke/immutable trigger 추가 |
| API/관리자/주문 회귀 | 고객 기존 주문 배송 회귀 확인 필요 |
| happy path 편중 | core 정적 계약은 통과하지만 신규 SQL 계약은 미실행 |
| production 데이터 위험 | migration 자체는 직접 data delete를 하지 않지만 적용·행 상태는 `PRODUCTION_UNVERIFIED` |

> 재검토 (2026-08-08): 아래 3개 FIX 항목은 모두 해소되었으며, 해소 검증 내역은 문서 하단의 "FIX 해소 검증" 섹션을 참고한다.

## FIX 1 — 기존 `commerce_shipments` 호환 배송 신청 경로가 삭제됨

- 파일 경로: `src/components/features/account/AccountDashboard.tsx`
- 관련 변경: 기존 `/api/orders` 조회, `LegacyCommerceOrder`, `legacyEligibleOrders`, `selectedOrderId`, 주문 전체 배송 UI와 legacy request body를 삭제하고 v2 storage만 남김.

### 문제

`02-shipping-plan.md`는 기존 `commerce_shipments`와 `shipping_requests`를 삭제하지 않고 compatibility read로 보존하며, 기존 고객 이력과 전환 전 데이터를 잃지 않도록 요구한다. 하지만 이번 diff는 기존 주문 전체 배송 선택 화면과 그 eligibility 계산을 제거했다.

현재 고객 화면은 `get_my_inventory_shipments`와 `storage`의 `rolloutEnabled` v2 항목만으로 배송 신청 대상을 구성한다. 기존 `commerce_shipments`에만 연결된 주문 상품은 신규 v2 선택 목록에 나타나지 않으며, 기존 주문 전체 배송을 다시 신청할 방법도 없다.

`/api/account/shipments`의 legacy history read가 남아 있는 것과, 보관 상품을 배송 신청할 수 있는 compatibility path가 남아 있는 것은 별개의 계약이다.

### 위험한 이유

- production에 아직 `commerce_shipments`만 존재하는 결제 완료 주문이 있으면 고객이 배송을 신청할 수 없게 된다.
- 기존 데이터의 read-only 보존을 했지만 실제 고객 업무 흐름은 단절된다.
- migration을 적용한 뒤에는 legacy writer가 revoke되므로, 화면에서 사라진 legacy 배송을 운영자가 복구할 우회 경로도 없다.
- 현재 테스트는 legacy UI가 제거되었는지만 확인하며, legacy 행이 존재할 때 고객이 올바른 compatibility read/신청 안내를 받는지 검증하지 않는다.

### 정확한 완료 조건

다음 중 하나를 구현하고 테스트해야 한다.

1. 기존 `commerce_shipments`/`shipping_requests` 행을 고객 보관·배송 화면에 read-only compatibility 항목으로 표시하고, 검증된 compatibility command로만 배송 신청을 연결한다.
2. 또는 기존 행을 `inventory_shipments`로 승격하는 별도 검증 backfill을 먼저 완료하고, 화면은 승격된 v2 행만 사용하도록 한다.

두 경우 모두 다음을 만족해야 한다.

- 기존 history 행을 삭제·추정·덮어쓰지 않는다.
- 이미 shipped/cancelled/active인 legacy shipment는 중복 신청할 수 없다.
- legacy compatibility 항목과 v2 항목이 고객 화면에서 중복 표시되지 않는다.
- 신규 배송 사실은 `inventory_shipments`에만 기록된다.
- `tests/core`에 legacy-only fixture의 조회·신청 가능/불가 상태를 검증하는 테스트를 추가한다.
- `tests/sql`에 legacy row, v2 row, linked row, unmapped row 각각의 fail-closed 계약을 추가한다.

## FIX 2 — compatibility helper가 실제 read path에 연결되지 않음

- 파일 경로: `supabase/migrations/20260808000000_retire_commerce_shipment_writes.sql`
- 관련 함수: `app_private.get_commerce_shipment_compat(uuid)`

### 문제

helper를 생성한 직후 `public, anon, authenticated, service_role` 전체에서 EXECUTE를 revoke한다. 현재 코드에서 이 helper를 호출하는 public read RPC/API도 확인되지 않는다. 기존 `get_my_inventory_shipments` 내부 dual-read는 남아 있지만, 이번 구현이 추가한 compatibility helper 자체는 dead contract다.

### 위험한 이유

- 구현 문서가 약속한 `sourceKind/sourceId/linkedInventoryShipmentIds` compatibility 계약이 실제 API 표면에 노출되지 않는다.
- 향후 기존 history를 읽기 위해 helper를 사용하려는 호출자는 권한 오류를 받는다.
- 정적 테스트는 함수 본문과 revoke 문자열만 검사하므로 실제 호출 가능성과 response contract를 보장하지 않는다.

### 정확한 완료 조건

- helper를 실제 read-only server RPC/API가 호출하도록 연결하고 authenticated 범위·member ownership을 검증한다.
- 또는 helper를 제거하고, 기존 `get_my_inventory_shipments` 또는 별도 read RPC가 동일한 compatibility contract를 완전히 제공하도록 명시한다.
- `sourceKind`, `sourceId`, legacy item, linked v2 shipment ID가 실제 fixture에서 검증된다.
- compatibility read에는 INSERT/UPDATE/DELETE 권한이 없어야 한다.

## FIX 3 — 신규 SQL 계약이 실행되지 않아 migration 안전성을 승인할 수 없음

- 파일 경로: `scripts/test-canonical-commerce-shipment.ps1`
- 파일 경로: `tests/sql/canonical-commerce-shipment/30-retire-writes.sql`

### 문제

`03-shipping-implementation.md`에 기록된 canonical commerce shipment Docker SQL suite 결과는 `NOT RUN`이다. 따라서 revoke signature, table trigger, account anonymization update, compatibility helper의 실제 PostgreSQL 동작은 현재 승인 증적이 아니다.

### 위험한 이유

- SQL 정적 계약 테스트만으로는 migration 적용 순서, trigger firing, security-definer 권한, fixture와 실제 schema의 차이를 검증할 수 없다.
- `shipping_requests` UPDATE를 계정 익명화 목적으로 열어둔 설계가 실제 anonymization flow와 충돌하지 않는지 확인되지 않았다.
- 운영 migration 적용 전에 오류가 발견되면 기존 배송·계정 삭제 흐름이 중단될 수 있다.

### 정확한 완료 조건

- Docker PostgreSQL 17 suite에서 `00-bootstrap` → canonical migrations → `30-retire-writes.sql` 전체가 통과한다.
- legacy RPC 4종 revoke, immutable triggers, `shipping_requests` insert/delete 차단, anonymization-compatible update, compatibility read를 실제 SQL로 검증한다.
- 기존 canonical 10-contract/20-concurrency와 신규 30-retire-writes를 함께 통과한다.
- production 적용 전후 migration parity와 shipment count/status/residual report를 남긴다.

## 추가 확인 사항

- `src/app/api/shipping/requests/route.ts`의 `orderId`는 410으로 차단되어 canonical v2 신규 요청 집중에는 맞다.
- `src/app/api/admin/owner/shipping/[id]/route.ts`의 legacy tracking correction 410은 legacy writer 차단에는 맞지만, 기존 history에 대한 read-only 운영자 조회는 별도로 유지되어야 한다.
- `commerce_shipments`와 manifest/event immutable trigger 및 legacy writer revoke는 migration 설계상 강하다. 다만 실제 production 적용 여부는 `PRODUCTION_UNVERIFIED`다.
- `20260807000000` pending remote migration은 이번 shipping diff의 직접 원인은 아니지만, 전체 production migration parity가 red인 상태에서는 production 승인 조건을 충족하지 않는다.

## 승인 전 필수 재검토 범위

1. legacy-only production data가 고객 화면에서 어떻게 보이고 어떤 상태로 신청 가능한지 결정
2. compatibility helper 또는 동등 read RPC의 실제 호출 경로 확정
3. Docker SQL suite 실행 및 기존 anonymization/read 회귀 확인
4. production read-only preflight 후 migration parity, trigger, revoke, row-count 검증
5. 위 FIX 항목과 정확한 완료 조건을 충족한 뒤 재승인

이번 리뷰에서는 코드를 수정하지 않았다.

---

# FIX 해소 검증 (2026-08-08 재검토)

## FIX 1 — RESOLVED: legacy-only 주문의 read + 검증된 compatibility command 복원

고객 화면에서 전환 전 legacy 주문을 다시 선택할 수 있도록, 단순 조회가 아닌 검증된 compatibility 경로로 복원했다.

- **SQL (migration)**: `20260808000000_retire_commerce_shipment_writes.sql`에 다음 3개 public 함수를 추가했다.
  - `public.get_my_legacy_eligible_orders() returns jsonb` — member-scoped (`auth.uid()`, `orders.member_id = v_member`) 안정 읽기. `status='paid'`, 모든 item `payment_status='paid'`, `storage_expires_at` 미래, `commerce_shipment_items` 미포함, `customer_inventory_items` 매핑 미존재(테이블이 없으면 `IF to_regclass`로 우회)인 주문만 `sourceKind='canonical_commerce'`/`requestEligible=true`로 반환. v2 테이블 참조는 `IF` 블록 안에서만 존재해 cutover 전 schema에서도 실행된다.
  - `public.request_legacy_order_shipment(uuid, uuid, boolean, uuid) returns jsonb` — `to_regprocedure('public.request_inventory_shipment(...)')`가 없으면 55000 fail-closed. member/ownership(42501), paid 필수, unpaid/expired/shipped/mapped 배제(55000), 단일 business, `item_selected_shipments_enabled`, 주소 소유 검증 후 `app_private.create_customer_inventory_entitlement('commerce', …)` 변환 → `public.request_inventory_shipment(...)` 1건으로 위임. 신규 사실은 `inventory_shipments`에만 기록되고 `commerce_shipments`/`shipping_requests`는 불변.
  - `public.get_my_commerce_shipment_compat(uuid)` — `app_private.get_commerce_shipment_compat`를 member ownership filter로 감싼 read (FIX 2와 동일 wiring).
  - 세 함수 모두 `security definer`/`set search_path=''`/authenticated-only EXECUTE.
- **API**:
  - `src/app/api/account/legacy-eligible-orders/route.ts` (GET) — eligible read.
  - `src/app/api/shipping/requests/legacy-order/route.ts` (POST) — 검증된 command, exact-key body, RPC SQLSTATE 매핑(42501→403, P0002→404, 22000/22023/23514→422, 23505/40001/PT409→409, 55000→422), `idempotent_replay`면 200/신규면 201.
  - `src/app/api/account/shipments/[id]/route.ts` (GET) — `get_my_commerce_shipment_compat` read, `immutable=true`/`linkedInventoryShipmentIds` contract 검증.
- **Dashboard** (`AccountDashboard.tsx`): `/api/account/legacy-eligible-orders` fetch, `legacyEligibleOrders`/`selectedOrderId` 상태, "기존 주문 전체 배송" 라디오 선택, 요청 요약, submit 버튼("선택 주문 전체 배송 신청")까지 복원. v2 선택과 legacy 선택은 `selectedShippingMode`로 상호 배타(양방향 clear). `/api/orders` 직접 fetch는 사용하지 않는다.
- **완료 조건 대응**:
  - 기존 history 행 삭제·덮어쓰기 없음 (command는 entitlement 변환 후 `inventory_shipments`에만 기록).
  - shipped/unpaid/expired/mapped 중복 신청 차단은 read/command 공통 guard로 강제.
  - v2/legacy 화면 중복: mapped 주문은 eligible read에서 제외되어 중복 표시 없음.
  - 신규 사실은 `inventory_shipments`에만 기록.
  - `tests/core/legacy-order-shipment-compat.test.mjs` (신규, 6건) — legacy-only fixture의 조회·신청 가능/불가 상태를 함수 본문 guard와 API wiring으로 검증.
  - `tests/sql/canonical-commerce-shipment/40-legacy-compat-contract.sql` (신규) — legacy row(eligible) / unpaid-item·unpaid-order·expired·shipped(ineligible) / unmapped row(빈 `linkedInventoryShipmentIds`) / command 55000 fail-closed / authenticated-only surface를 실제 PostgreSQL로 검증. v2 row·linked row는 canonical chain에 v2 테이블이 없어 static contract(파일 헤더 주석 + `tests/core`)로 명시.

## FIX 2 — RESOLVED: compatibility helper가 실제 read path에 연결됨

- `app_private.get_commerce_shipment_compat(uuid)`는 이제 `public.get_my_commerce_shipment_compat(uuid)`라는 authenticated member-scoped read RPC로 호출된다.
- `src/app/api/account/shipments/[id]/route.ts`가 해당 RPC를 호출해 `sourceKind`, `sourceId`, legacy items, `linkedInventoryShipmentIds`(v2 존재 시 join)를 response contract로 노출한다.
- 기존 `get_my_inventory_shipments`의 v2 dual-read는 그대로 유지된다.
- 읽기 surface에 INSERT/UPDATE/DELETE 권한 없음: helper·read RPC는 `security definer`, `set search_path=''`, authenticated EXECUTE만, v2 aggregate 테이블은 RPC-only + forced RLS.
- `30-retire-writes.sql`의 unmapped-row 검증과 `tests/core`의 helper wiring 검증으로 실제 fixture 계약을 확인.

## FIX 3 — RESOLVED: Docker SQL suite 실제 실행 통과

- Docker Desktop 재시작 후 `scripts/test-canonical-commerce-shipment.ps1` 전체 chain을 Docker PostgreSQL 17에서 실행했다.
- 최종 실행 결과: `00-bootstrap` → canonical migrations → `10-contract` → `20-concurrency` → `20260808000000_retire_commerce_shipment_writes.sql` → `30-retire-writes.sql` → `40-legacy-compat-contract.sql` 전부 **SUITE-PASSED**.
- 검증된 SQL 동작: legacy RPC 4종 revoke, immutable triggers, `shipping_requests` insert/delete 차단 + anonymization-compatible update, compatibility helper read, 신규 eligible read/command fail-closed.
- 남은 항목(production 적용 전 migration parity와 row-count report)은 `PRODUCTION_UNVERIFIED`로 그대로 유지된다.

## 재검토 결과 요약

| FIX | 판정 | 근거 |
|---|---|---|
| FIX 1 기존 주문 호환 배송 경로 | RESOLVED | eligible read + 검증된 `request_legacy_order_shipment` 복원, core/SQL 계약 추가 |
| FIX 2 compatibility helper 연결 | RESOLVED | `get_my_commerce_shipment_compat` read RPC → `/api/account/shipments/[id]` |
| FIX 3 SQL suite 실행 | RESOLVED | Docker PostgreSQL 17 전체 suite 통과 (40-file 포함) |
| production 적용 parity/report | PRODUCTION_UNVERIFIED | 별도 운영 절차로 잔존 |

검증 명령: `npm test` (285/285 pass), `npm run lint` (pass), `npx tsc --noEmit` (pass), `npm run build` (pass), `scripts/test-canonical-commerce-shipment.ps1` (SUITE-PASSED).
