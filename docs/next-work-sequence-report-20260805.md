# 후속 작업 진행 순서 보고서

작성일: 2026-08-05
기준 커밋: `60cc766`

## 1. 실행 상태 (2026-08-05 갱신)

이 문서는 후속 작업 순서를 확정하고, 단계 0(현행 기준선 동결)과 단계 1(회귀 기준)의 산출물을 포함한다.

- 단계 0·1 산출물: 이 문서 4·5절 참조.
- 단계 2~7: 이 문서 6절 참조.
- 이번 실행에서 상거래 코드, DB 마이그레이션, API, UI는 변경하지 않았다.

## 2. 보고 목적

다음 항목을 다루기 전에, 데이터 계약·서버 mutation·운영자 UI·검증·원격 반영의 순서를 확정한다.

- P1-3 통합 출고 상태와 단일 송장 제약
- P1-4 기존 보관 만료와 물리 보관 상태 통합
- 경매·배송비 원장 이력 및 정정 UI
- 최신 커밋의 원격 푸시

## 3. 진행 원칙

- 현재 운영 기준인 직접 매장 출고·보관 모델을 기준으로 삼고, 중앙 집하 시안 문서는 역사 기록으로만 취급한다.
- 기존 적용 마이그레이션은 수정하지 않고 새 순방향 마이그레이션으로만 변경한다.
- UI보다 DB 제약과 서버 RPC/API의 불변식을 먼저 확정한다.
- 기존 배송 mutation의 우회 경로를 남긴 채 새 경로를 추가하지 않는다.
- 원장 기록은 기존 행을 수정하거나 삭제하지 않고, 정정·역분개·재정산을 별도 이력으로 남긴다.
- 각 단계는 마이그레이션 계약, API 계약, 권한, 동시성, 실패-폐쇄 조건을 검증한 뒤 다음 단계로 넘어간다.
- 원격 푸시는 구현과 검증이 모두 끝난 마지막 단계에서만 수행한다.

## 4. 단계 0 산출물: 현행 기준선 동결

조사 결과 기존 문서의 전제("canonical Shipment 미구현, 단일 송장 제약 없음")는 실제와 다르다. 현행 코드베이스는 `inventory_shipments` v2(현행 표준)와 `commerce_shipments`(canonical·호환용)를 이미 구현했으며, 단일 활성 배송·단일 송장·운송장 유일성은 DB 제약으로 강제된다. 아래는 검증된 현행 상태표·권한표·차단 목록이다.

### 4.1 배송 상태표

#### `inventory_shipments` (v2, 현행 표준) — `20260722084550_add_unified_inventory_fulfillment_v2.sql:275-320`

| 상태 | 설명 | courier/tracking | packed_at/by | shipped_at/by | cancelled_at/reason |
| --- | --- | --- | --- | --- | --- |
| `requested` | 요청 (기본값은 `collecting`) | null | null | null | null |
| `collecting` | 상품 집하 중 (기본값) | null | null | null | null |
| `ready_to_pack` | 전 상품 출고 완료 | null | null | null | null |
| `packed` | 합포장 완료 | null | 필수 | null | null |
| `shipped` | 발송 완료 | 필수 | 필수 | 필수 | null |
| `cancelled` | 취소 | null | null | null | 필수 |
| `reconciliation_required` | 미조정 | null | null | null | null |

- 상태 전이: `request_inventory_shipment`(`20260724063531:531-786`) → `collecting`; `release_inventory_shipment_items`(`:294-472`)·`refresh_inventory_shipment_status`(`20260722084550:1944-1982`) → `ready_to_pack`/자동 `cancelled`; `pack_inventory_shipment`(`20260724063531:872-981`) → `packed`; `ship_inventory_shipment`(`:983-1072`) → `shipped`.
- **상품당 활성 배송 1건**: `inventory_shipment_items_one_active_idx`(`20260722084550:357-359`) — `line_status in ('requested','held','ready','packed')`에 대해 inventory_item_id 유니크.
- **운송장 유일성**: `inventory_shipments_tracking_idx`(`:322-324`) — `status='shipped'`일 때 (courier, tracking_number) 유니크.
- **정산 단일성**: `inventory_shipments_settlement_check`(`:303-308`) — `manual_transfer`/`shipping_credit`/`waiver` 중 정확히 1개만.
- **append-only 이벤트**: `inventory_shipment_events_append_only` 트리거(`:702-710`), 직접 DML 거부(`reject_inventory_v2_append_only_mutation`).
- **mutation gate**: `20260805010000_enforce_inventory_shipment_mutation_gate.sql` — `packed`/`shipped` 상태 진입 또는 courier/tracking 변경 시 owner 또는 `create_shipments` 권한(사업체/센터) 필수.

#### 라인·매장 작업 상태

| 테이블 | 상태값 | 근거 |
| --- | --- | --- |
| `inventory_shipment_items.line_status` | `requested, held, ready, excluded, packed, shipped, cancelled` | `20260722084550:338-340` |
| `inventory_shipment_store_works.status` | `collecting, outbound_complete, cancelled` | `:370` |
| `inventory_item_fulfillments.current_stage` | `reconciliation_required, entitled, preparing, in_transit_to_center, center_received, center_stored, packed, shipped, cancelled` | `:204-207` |
| `inventory_item_fulfillments.location_kind` | `store, transit, center, unknown` | `:208` |

#### `commerce_shipments` (canonical·immutable 호환) — `20260722060000:202-215`

- 상태: `requested → packed → shipped`, `cancelled`, `reconciliation_required`.
- **주문당 1 배송**: `commerce_shipment_orders.order_id` 유니크(`20260722060000:387`).
- **운송장 유일성**: `commerce_shipments_tracking_key` partial unique on `shipped`(`:353-358`).
- 요청 RPC는 `service_role`만 실행(`20260722070000:395-405`); pack/ship은 `has_business_permission('create_shipments')`, tracking 정정은 `is_owner()`.
- manifest 완전성·분류·추적 유일 트리거 존재. `shipping_requests`는 이 계약과 불일치하면 `55000` 차단(projection guard `:1972-2009`).

#### `shipping_requests` (레거시)

- 상태: `requested → shipped`(`20260718000000:337-353`). courier/tracking 유일 트리거(`20260718073000:449-490`).
- 레거시 mutation RPC는 전부 revoke됨(아래 4.5).

### 4.2 보관 상태표

#### `customer_inventory_items` — `20260722084550:123-172`

| 항목 | 값/규칙 |
| --- | --- |
| `ownership_status` | `active, refund_pending, refunded, cancelled` |
| `source_kind` | `commerce / auction / legacy_portone` (정확히 1개 소스) |
| `storage_class_snapshot` | `small / large` |
| `storage_duration_days` | `7 / 14` (large 7일, small 14일) |
| `storage_started_at` / `storage_expires_at` | `expires = started + duration` CHECK 강제(`:166-169`) |
| `work_due_date` | KST 날짜 기준 업무 마감일 |

#### `inventory_item_fulfillments` — `:198-240`

- `current_stage`(위 4.1), `location_kind`, `storage_location_code`(`center_stored`에 필수), `outbound_released`, `is_blocked`/`block_reason`.
- **결제 완료 시 보관 권리 생성**: `customer_inventory_items` + `inventory_item_fulfillments`를 새 주문/입금 확정 시 생성.
- 배송 요청 후보: `current_stage in ('entitled','preparing','center_received') and not outbound_released`이고 활성 배송 라인이 없는 항목(`20260724063531:84-92`).
- 레거시 고객 보관 API는 `get_my_inventory_overview`(`src/app/api/account/storage/route.ts:110`)로 새 모델을 읽고, 미이관 경매 낙찰은 `get_my_won_products`로 병합 표시.

### 4.3 원장 상태표

| 테이블 | 성격 | 근거 |
| --- | --- | --- |
| `manual_transfer_payment_ledger` | append-only, `reversal_of` 연결, signed 합계·행 수 CAS | `20260720150000`, `20260722020000` |
| `shipping_fee_payments` / 배송비 원장 | append-only, 크레딧·수동이체 정산 | `20260720160000`, `20260722120747` |
| `store_financial_entries` | 환불·재정산 기록 | `20260722084550:2308` |

- **정방향 writer**: `record_manual_transfer_payment`, `record_shipping_fee_payment`(→`record_single_shipping_credit_payment`·`record_inventory_shipping_fee_receipt`), `confirm_unified_manual_payment(_v2)`(라우터), `confirm_combined_auction_payment`, `confirm_prepaid_shipping_credit_payment`.
- **역방향 writer**: `reverse_manual_transfer_payment`, `reverse_shipping_fee_payment`(→`reverse_single_shipping_credit_payment`), `review_shipping_fee_refund`.
- **CAS·멱등**: 관찰된 원장 합계·행 수·버전 CAS + 처리자별 UUIDv4 멱등 키(`src/lib/manualTransferReceipt.ts`, `src/app/api/admin/operator/transfers/[id]/ledger/route.ts`).
- **실패-폐쇄**: 구매 제안 연결 경매와 배송 요청 연결 배송비의 역분개는 Owner 재정산 상태 모델 전까지 자동 처리 금지(`20260721140000`, `20260722020000`).
- **미구현 갭**: Owner 재정산 상태 모델, 경매·배송비 원장 이력/정정 UI.

### 4.4 권한표

| 함수 | 허용 대상 | 근거 |
| --- | --- | --- |
| `access_role_for_user` | `owner/operator/employee/band_member/member`; owner-member-mode 시 `member` | `20260724123534:79-102` |
| `is_owner` / `is_operator` / `is_employee` / `is_staff` | 역할별 | `20260718030000:544-655` |
| `is_member` | owner/operator/employee는 `member_accounts` 없이 commerce 허용(2026-08-05); band_member/member는 기존 계약 | `20260805000000:9-39` |
| `can_view_shared_fulfillment` | `owner/operator/employee` | `20260724063531:23-36` |
| `has_store_permission(store_id, perm)` | owner 또는 store_membership 플래그 또는 출고 그룹(`prepare_orders/receive_at_center/create_shipments`) | `20260803173529:596-618` |
| `has_business_permission(business_id, perm)` | owner 또는 business 내 membership 플래그 | `20260722040000:842-901` |
| `can_confirm_shared_payment` | owner만 | `20260803173529:621-629` |

| 작업 | 권한 게이트 | 근거 |
| --- | --- | --- |
| 배송 요청(`request_inventory_shipment`) | `is_member()` | `20260724063531:566-568` |
| 상품 출고(`release_inventory_shipment_items`) | `is_owner()` 또는 `has_store_permission('prepare_orders')` | `:346-348` |
| 합포장(`pack_inventory_shipment`) | `can_view_shared_fulfillment()` | `:891-893` |
| 발송(`ship_inventory_shipment`) | `can_view_shared_fulfillment()` | `:1003-1005` |
| 송장 정정(`revise_inventory_shipment_tracking`) | `can_view_shared_fulfillment()` | `20260724082849:616-618` |
| mutation gate(상태 진입/송장 변경) | owner 또는 `create_shipments`(사업체/센터) | `20260805010000:7-33` |
| canonical tracking 정정(`correct_commerce_shipment_tracking`) | `is_owner()` + 역할 `owner` | `20260722070000:1623-1630` |
| canonical 요청(`request_commerce_order_shipment`) | `service_role` JWT만 | `:395-405` |
| 원장 기록·역분개 | 처리자(owner/운영자) RPC + CAS/멱등; 직접 DML 불가 | `20260722020000` |

### 4.5 폐기·차단 대상 목록 (우회 writer)

이미 폐쇄·차단된 항목:

- 레거시 shipping RPC revoke: `request_product_shipping`(3종), `mark_shipping_request_shipped`, `upsert_shipping_tracking_batch`, `get_shipping_work`, `get_pending_shipping_work`, `count_shipping_work`, `owner_*_hidden_test_shipping` — `20260722070000:2117-2135`.
- `service_role`의 `shipping_requests` UPDATE revoke — `:2138`.
- fulfillment 5종 테이블 RPC/트리거 전용(force RLS, CREATE POLICY 없음) — `20260722030000:734-743`.
- canonical commerce shipment 5종 force RLS + `service_role` 포함 revoke — `20260722060000:993-1010`.
- `inventory_shipments`/`inventory_shipment_events` append-only 직접 DML 거부 — `20260722084550:691-710`.

후속 작업에서 재점검할 대상:

- `service_role` 직접 쓰기 grant: `account_access_roles` insert, `kakao_member_profiles` insert/update, `shipping_fee_payments` insert, `shipping_requests` update(레거시 경로), `site_status`, `support_messages` insert — `20260721143000:60-65`. **`shipping_requests` update와 `shipping_fee_payments` insert는 새 Shipment 계약과 병행 시 우회 위험.**
- `products` update service_role grant — `20260724110000:3`(상품 AI 메타데이터 경로).

### 4.6 남은 정책 공백

- 기존 레거시 `shipping_requests`·canonical `commerce_shipments` 행을 v2 `inventory_shipments`로 전환할 때의 상호 관계(정상 승격/검토/차단 구분) 확정 필요.
- v2 송장 수정·삭제 허용 상태(`revise_inventory_shipment_tracking`)와 canonical 정정의 경계 명문화.
- `storage_expires_at` 만료 상품과 물리 상태(`center_stored` 등)의 우선순위·고객 노출 규칙.
- 배송비 원장 정정 대상·승인 주체·고객 알림·재정산 상태 모델.
- 경매 원장 정정이 낙찰·결제·상품 상태에 미치는 범위와 자동 처리 금지 조건.

## 5. 단계 1 산출물: 회귀 기준

### 5.1 기존 테스트 계약 (보존 기준)

| 테스트 | 검증 계약 |
| --- | --- |
| `tests/core/unified-inventory-fulfillment-v2.test.mjs` | v2 RPC 전용·force RLS·revoke, 요청 100개 상한, v2 요청이 legacy RPC 미호출 |
| `tests/core/canonical-commerce-shipment.test.mjs` | canonical 5종 force RLS, manifest/분류/추적 유일, RPC 권한 경계, legacy RPC revoke |
| `tests/core/shipping-request-contract.test.mjs` | 레거시 시그니처·idempotency advisory lock |
| `tests/core/member-bid-shipping-operations.test.mjs` | 7일/37일 아카이브·purge, `inventory-delivery-retention` cron |
| `tests/core/member-shipping-payment-storage.test.mjs` | 크레딧 수량 결제, 배송비 포함 결제 |
| `tests/core/manual-transfer-reversal-contract.test.mjs`, `manual-transfer-queue-snapshot.test.mjs`, `manual-transfer-atomic-confirmation.test.mjs` | CAS·멱등·역분개 결박·큐 snapshot |
| `tests/core/store-membership-permissions.test.mjs`, `service-role-table-grants.test.mjs` | 권한 플래그·service_role 최소 권한 |
| `tests/sql/canonical-commerce-shipment/*`, `queue-snapshot/*`, `reversal-target-binding/*` | 격리 SQL 계약·동시성 |

### 5.2 회귀 시나리오 목록 (후속 작업에서 강제 유지)

정상 흐름:

1. 배송 요청 → 상품 출고 → 전 상품 출고 확인 → 합포장 → 송장 입력 → 발송 완료.
2. 여러 매장 상품을 한 배송 요청으로 결합, 매장 작업별 `outbound_complete` 집계.
3. 배송 크레딧/수동이체/waiver 정산 단일성.

실패·차단:

4. 출고 전 합포장 시도 → `UNRELEASED_ITEMS` + `blockedItemIds` 반환.
5. 부분 발송: 일부 상품 미출고 → 합포장·발송 거부.
6. 중복 송장: 같은 운송장 재사용 → 유니크 위반 차단.
7. 동시 송장 생성/등록 → PT409/23505/40001 충돌 응답.
8. stale CAS(관찰 버전 불일치) → 실패-폐쇄.
9. 멱등 재시도: 같은 키 재사용 → 동일 영수증, 다른 payload 키 재사용 → 거부.
10. 권한 위반: 직원·무권한 매장이 타 매장 송장/원장 mutation → 42501.
11. 직접 테이블 DML / service_role bypass → RLS·trigger 차단.
12. 보관 만료 상품이 배송 후보에 포함 → 제외 확인.
13. 배송 요청 중인 상품이 보관 목록·중복 요청 후보에서 제외.

레거시 우회:

14. 레거시 `shipping_requests` 직접 mutation → projection guard `55000`.
15. canonical `commerce_shipments`가 v2와 불일치하게 변하는 시도 → 트리거 차단.

## 6. 권장 작업 흐름 (단계 2~7)

### 단계 2. P1-3 데이터 계약과 서버 불변식

canonical Shipment와 단일 송장 제약의 기반은 이미 `inventory_shipments` v2·`commerce_shipments`로 존재한다. 후속 구현은 다음에 집중한다.

- v2가 강제하지 않는 나머지 송장 생성 gate를 확인한다(전 상품 입고·최종 확인·합포장 선행 조건의 잔여 우회 경로).
- 기존 Owner 직접 배송 변경·레거시 송장 경로를 새 계약으로 전환하거나 명시적으로 폐쇄한다.
- 기존 데이터는 자동 추정하지 않고, 정상 승격·검토 필요·차단 상태로 구분해 backfill한다.
- 모든 신규 mutation에 권한, 행 잠금/CAS, 처리자별 멱등 키, append-only fulfillment 이벤트를 적용한다.

**완료 게이트:** 누락 상품은 송장을 만들 수 없고, 동시 요청에서도 활성 Shipment·송장이 하나만 생성되며, 기존 우회 writer가 실패한다.

### 단계 3. P1-3 API·운영자·고객 화면 연결

- 운영자 화면에 입고 누락, 합포장 대기, 송장 가능, 발송 상태를 분리 표시.
- 송장 등록 버튼은 서버가 반환한 현재 자격이 있을 때만 활성화.
- 충돌·중복·부분 발송 거절을 재조회 안내로 표시.
- 고객 화면은 발송 준비 중·발송·배송 완료의 공개 상태로 매핑.
- 송장 수정·삭제 허용 상태와 되돌림 이벤트 명시.

**완료 게이트:** UI 버튼을 우회한 직접 API 호출도 동일 결과를 받고, 모바일·데스크톱에서 정상/실패/재시도가 확인된다.

### 단계 4. P1-4 보관 상태 통합

- 결제 완료, 입고, 보관 시작, 보관 만료, 배송 요청, 출고, 예외 상태의 관계를 정의.
- `storage_expires_at`(`customer_inventory_items.storage_expires_at`)과 물리 입고·보관 이벤트를 연결하고, 과거 데이터는 증거가 없는 경우 추정하지 않는다.
- 보관 중인 상품만 배송 요청 후보가 되도록 서버에서 검증.
- 여러 주문 보관 상품을 한 배송 요청으로 묶을 때 중복 배송비·중복 출고 방지.
- 만료·배송 중·문제 등록 상품의 처리와 고객 노출 상태 확정.

**완료 게이트:** 고객 보관 목록, 배송 요청 후보, 운영자 출고 큐, Shipment 대상이 같은 상태 원천을 사용하고 모순 조합을 생성할 수 없다.

### 단계 5. 원장 이력·정정 도메인과 UI

- 경매 원장과 배송비 원장의 불변 행, 원정산, 역원장, 정정 요청, 승인/재정산 상태를 모델링.
- 정정 사유, 실행자, 실행 시각, 대상 원장, 이전/변경 후 합계·행 수를 보존.
- 이미 고객 알림이나 상품·주문 상태에 영향을 준 정정은 자동 확정하지 않고 Owner 재정산 상태로 보낸다.
- 처리자 권한, 대상 매장 범위, CAS, 멱등 재시도, 다른 payload 키 재사용 차단을 서버에 적용.
- Owner 화면에 원장 타임라인·정정 가능 여부·영향 범위·승인/차단/재정산 동선 제공.
- 운영자 화면에는 허용된 조회만 제공, 원장 직접 수정 없음.
- 고객 정정 알림과 주문·결제 상태 재표시를 별도 검증.

**완료 게이트:** 기존 원장을 덮어쓰지 않고 정정 전후를 재현할 수 있으며, 승인되지 않은 정정과 경매 연결 배송비의 위험한 자동 역분개가 차단된다.

### 단계 6. 통합 검증과 문서 최신화

- SQL 계약, FK/CHECK/유니크 제약, RLS/ACL, migration parity 검증.
- 동시 송장 생성, 동시 배송 요청, 중복 정정, stale CAS, 멱등 재시도 검증.
- 누락 상품, 부분 발송, 만료 보관, 배송비 중복, 경매 정정, 권한 위반의 실패-폐쇄 검증.
- lint, TypeScript, build, 기존 전체 테스트, 관련 브라우저 QA 실행.
- 운영 DB 적용 전후 smoke 기준과 additive 롤백 원칙 기록.
- `implementation-roadmap.md`, `current-state-audit.md`, `order-payment-fulfillment-flow.md`, 작업 현황 보고서를 실제 완료 상태에 맞게 갱신.

**완료 게이트:** 코드·DB·문서 상태가 일치하고, 운영 적용 전 검증 증적과 잔여 리스크가 기록된다.

### 단계 7. 커밋 검토 후 원격 푸시

- `git status`, 전체 diff, 최근 로그, 테스트 결과, migration 목록 재검토.
- 의도하지 않은 파일·비밀값·`.env`·빌드 산출물 미포함 확인.
- 단계별 의미가 드러나는 작은 커밋 단위와 저장소 커밋 스타일 확인.
- 사용자 최종 반영 승인 후 `origin/main`과 차이 확인 후 푸시.
- 푸시 후 원격 커밋, CI/배포 상태, 공개 smoke 결과를 별도 기록.

**완료 게이트:** 로컬·원격 검증 결과가 기록되고, 실패 시 원인과 다음 조치가 남는다.

## 7. 최종 순서 요약

```text
정책·계약 동결 (완료: 이 문서 4절)
→ 현행 writer/회귀 기준 조사 (완료: 이 문서 5절)
→ P1-3 단일 송장 서버 제약 잔여분
→ P1-3 운영자·고객 UI
→ 보관 만료·물리 보관 상태 통합
→ 경매·배송비 원장 이력/정정 모델과 UI
→ 전체 통합 검증 및 문서 갱신
→ 최종 검토·승인 후 원격 푸시
```

## 8. 순서를 바꾸지 않는 이유

- 단일 송장 제약 전에 UI를 만들면 기존 배송 API가 화면을 우회해 중복 송장을 만들 수 있다.
- 보관 상태 통합 전에 원장 정정 UI를 만들면 배송비 중복·보관 만료·출고 상태의 기준이 흔들린다.
- 원장 정정 모델 전에 UI를 만들면 append-only 이력과 Owner 재정산 계약을 화면이 선점하게 된다.
- 통합 검증 전에 원격 푸시를 하면 현재 커밋과 후속 변경의 운영 반영 경계가 불명확해진다.

따라서 실제 구현은 위 순서를 기본으로 하며, 단계 0에서 정책이 변경될 경우 이후 단계의 계약과 순서를 다시 검토한 뒤 시작한다.
