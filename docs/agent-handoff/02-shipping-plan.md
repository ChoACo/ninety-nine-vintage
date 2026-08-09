# 02. Shipping P1-3 설계 확정

작성일: 2026-08-08 (Asia/Seoul)
기준 HEAD: `c36a2db5f6a9a808fe0768a2c19927524c67ee89`
조사 단계: 설계 확정만 수행. 코드·migration·운영 데이터는 수정하지 않음.

## 판정 범위와 증거 수준

- `LOCAL_CONFIRMED`: 현재 checkout의 코드, migration, 테스트에서 확인한 사실.
- `PRODUCTION_UNVERIFIED`: 운영 DB, 운영 환경변수, 실제 운영 행/트래픽을 이 작업에서 확인하지 못한 사실.
- 인계 문서의 운영 확인 주장은 코드와 분리해 참고했으며, 이 문서에서는 운영 상태를 독립 확인하지 못한 항목을 `PRODUCTION_UNVERIFIED`로 표시한다.

현재 `npm run verify:migrations`는 `20260807000000`을 pending remote로 보고한다. 이 migration은 Shipment migration이 아니라 장바구니 제한 migration이다. Shipment gate `20260805010000`의 운영 적용 여부는 인계 문서에 적용되었다고 기록되어 있으나, 이번 단계에서 운영 DB에 쓰거나 별도 운영 조회를 수행하지 않았으므로 `PRODUCTION_UNVERIFIED`다.

## 1. 세 Shipment 모델의 실제 역할

### 1.1 `inventory_shipments` — 최종 canonical source of truth

`20260724063531_simplify_direct_store_fulfillment.sql`의 `request_inventory_shipment`, `pack_inventory_shipment`, `ship_inventory_shipment` 및 `get_my_inventory_shipments`, `get_inventory_shipment_queue`가 현재 직접-매장 fulfillment의 주 계약이다. 상품별 active line, 원등록 매장, 출고 여부, 합포장, 송장, CAS, idempotency, append-only 이벤트가 이 모델에 모인다.

따라서 P1-3의 최종 canonical은 다음으로 확정한다.

> `inventory_shipments` + `inventory_shipment_items` + `inventory_shipment_events`를 배송 사실의 유일한 신규 기록 원천으로 사용한다.

새 고객 배송 요청, 운영자 포장·발송, 송장 정정, 고객·운영자 배송 조회는 이 canonical 계약을 기준으로 한다.

### 1.2 `commerce_shipments` — 기존 canonical 호환 역사/읽기 모델

`20260722060000_add_canonical_commerce_shipments.sql`과 `20260722070000_activate_canonical_commerce_shipments.sql`은 주문 단위 canonical shipment를 구현했고, `shipping_requests`와 주문·상품 manifest를 결박한다. 그러나 현재 direct-store v2가 도입된 뒤에도 고객 API의 `orderId` legacy branch가 `request_commerce_order_shipment`를 호출하고 있다.

최종 역할은 다음으로 제한한다.

- 기존 `commerce_shipments` 행의 immutable 호환 역사 보존.
- 기존 주문 중심 화면·감사·분쟁 조회에 필요한 read-only compatibility source.
- 신규 shipment 생성·포장·발송·송장 정정의 writer가 아님.
- `inventory_shipments`와 새로 dual-write하지 않음.

기존 `commerce_shipments`를 무조건 `inventory_shipments`로 복사하지 않는다. 상품별 inventory ownership, 현재 fulfillment stage, shipment line, tracking, settlement가 모두 증명되는 행만 별도 승격 대상으로 분류한다.

### 1.3 `shipping_requests` — 폐기 예정 legacy intent/projection

`shipping_requests`는 가장 오래된 배송 요청 행이며, canonical migration에서 `commerce_shipments`와 연결된 compatibility projection으로 취급된다. 현재 직접 UPDATE는 제한되고, canonical shipment의 shipped/tracking 사실과 불일치하는 변경을 projection guard가 차단한다.

최종 역할은 다음으로 제한한다.

- 기존 고객·정산·감사 참조를 위한 read-only legacy history.
- 이미 존재하는 legacy row의 보존 및 필요 시 compatibility 조회.
- 신규 요청, 상태 변경, 송장 입력, 송장 정정의 writer가 아님.
- 신규 `inventory_shipments`에 대응하는 새 `shipping_requests`를 만들지 않음.

## 2. Writer와 Reader 전환 판단

### 현재 writer

| 모델 | 현재 writer | 최종 판단 |
|---|---|---|
| `inventory_shipments` | `request_inventory_shipment`, `pack_inventory_shipment`, `ship_inventory_shipment`, `revise_inventory_shipment_tracking` | 유지. 유일한 신규 writer |
| `commerce_shipments` | `request_commerce_order_shipment`, `pack_commerce_shipment`, `ship_commerce_shipment`, `correct_commerce_shipment_tracking` | 신규 호출 차단. 기존 행은 read-only |
| `shipping_requests` | legacy RPC 및 canonical function 내부 projection update | 직접 writer 차단. 신규 projection 생성 금지 |

### 현재 reader

- 고객 배송 API `src/app/api/account/shipments/route.ts`는 `get_my_inventory_shipments`를 호출하고, SQL 함수 내부에서 v2와 legacy canonical 결과를 함께 공개 형식으로 변환한다. 이 dual-read는 전환 기간에 유지한다.
- 고객 배송 요청 API `src/app/api/shipping/requests/route.ts`는 현재 `inventoryItemIds` v2 branch와 `orderId` legacy branch를 모두 수용한다.
- 운영자 배송 API `src/app/api/admin/operator/shipping/route.ts`는 v2 queue와 v2 pack/ship/tracking correction만 사용한다.
- Owner test-member 경로 및 과거 주문·배송 화면의 `orderId` 의존성은 전환 전 검색·분류해야 한다.

최종 reader 규칙:

1. 신규 화면·API는 `inventory_shipments` canonical result만 사용한다.
2. 기존 legacy row를 보여줄 때만 compatibility adapter/read RPC가 `commerce_shipments` 또는 `shipping_requests`를 읽는다.
3. compatibility read 결과에는 `sourceKind`와 `sourceId`를 남겨 canonical v2 행과 역사 행을 혼동하지 않는다.
4. 두 모델의 같은 배송 사실을 합산하거나 중복 표시하지 않도록 stable identity/link를 사용한다.

## 3. Mutation gate와 legacy writer 차단

`20260805010000_enforce_inventory_shipment_mutation_gate.sql`의 DB trigger는 v2의 packed/shipped 진입과 courier/tracking 변경을 owner 또는 `create_shipments` 권한으로 제한한다. 이 gate는 유지하되, 애플리케이션 API 검사만으로 완료로 간주하지 않는다.

전환 migration은 다음을 순서대로 수행해야 한다.

1. 새 feature flag 또는 rollout 상태를 `closed`로 두고 compatibility read만 허용한다.
2. `src/app/api/shipping/requests/route.ts`의 `orderId` legacy branch를 제거하거나 명시적으로 `410/422` 차단한다.
3. `request_commerce_order_shipment`를 신규 public/service-role 호출 경로에서 revoke한다.
4. `pack_commerce_shipment`, `ship_commerce_shipment`, `correct_commerce_shipment_tracking`의 신규 실행 권한을 revoke한다.
5. legacy `request_product_shipping`, `mark_shipping_request_shipped`, `upsert_shipping_tracking_batch`, `get_shipping_work` 계열은 계속 revoke 상태로 유지한다.
6. `shipping_requests` 직접 UPDATE/INSERT 권한과 canonical function 내부의 신규 projection write를 차단한다.
7. 이미 존재하는 legacy 행은 삭제하지 않고, 필요한 상태 조회는 read-only RPC/view로만 제공한다.

DB trigger와 RPC revoke가 모두 있어야 한다. route 차단만으로는 service-role 또는 다른 서버 경로의 우회를 방지할 수 없다.

## 4. Dual-write 판단

### 결정: application dual-write 금지

새 shipment에 대해 다음 조합을 허용하지 않는다.

```text
새 요청 → inventory_shipments 기록
       + commerce_shipments 기록
       + shipping_requests 기록
```

이 방식은 두 상태의 CAS·idempotency·tracking·settlement가 어긋날 위험이 있고, 어느 행이 사실인지 다시 판단해야 하므로 P1-3 목표와 맞지 않는다.

필요한 compatibility projection은 다음 중 하나로 제한한다.

- 기존 행에 대한 read-only adapter/RPC.
- 기존 legacy 행과 v2 행의 관계를 명시하는 additive link table.
- 운영자가 검토한 승격 행에 한한 일회성 backfill.

v2의 새 사실을 legacy 테이블에 복사하는 일반 dual-write trigger는 추가하지 않는다.

## 5. 기존 production 데이터 승격 정책

운영 행의 실제 개수·상태·관계는 이번 단계에서 확인하지 않았으므로 전체 production inventory는 `PRODUCTION_UNVERIFIED`다. 다음 사전 조사 없이는 backfill을 실행하지 않는다.

- `shipping_requests` 전체 행과 status별 수량
- `commerce_shipments` 전체 행과 status별 수량
- `commerce_shipment_items`와 `commerce_shipment_orders` 완전성
- `inventory_shipments`와 active line 중복 여부
- order/item/product/store/member의 FK 및 settlement 관계
- shipped tracking 유일성 및 변경 이벤트
- 이미 v2와 legacy 양쪽에 존재하는 동일 배송 후보

각 legacy 행은 다음 세 분류 중 하나로만 처리한다.

### A. 자동 승격 가능

- 모든 shipment item이 정확히 하나의 `customer_inventory_items`와 연결됨.
- member, business, origin store, settlement가 일치함.
- status·tracking·timestamps·line 상태를 손실 없이 v2 상태로 표현할 수 있음.
- active shipment unique 제약을 위반하지 않음.
- 기존 이벤트와 idempotency 증거를 보존할 수 있음.

이 경우에도 원본 legacy 행은 삭제하지 않고, v2 행과의 immutable link를 남긴다.

### B. 수동 검토 필요

- 일부 item mapping이 불완전함.
- 과거 중앙 집하/직접 매장 모델이 혼재함.
- shipment status와 order/item status가 불일치함.
- tracking 또는 settlement 사실은 있으나 현재 v2 상태로 안전하게 표현되지 않음.

운영자가 증거를 확인하기 전에는 v2 active shipment로 만들지 않는다.

### C. 승격 금지/legacy 보존

- 삭제된 상품·회원·주문 또는 불완전 FK.
- 중복 tracking 또는 중복 active shipment.
- 원본 사실을 추정해야만 복원 가능한 행.
- 정산·환불·분쟁 이력이 연결되어 있어 자동 변환 시 의미가 바뀌는 행.

이 행은 compatibility read-only history로 남긴다. 데이터 손실을 피하기 위해 자동 삭제·덮어쓰기·status 추정은 하지 않는다.

## 6. Migration 필요 여부

### 결론: 필요함. 단, additive migration만 허용

필요한 migration 구성은 다음과 같다.

1. `shipment_compatibility_links`와 같은 immutable link 구조 또는 동등한 기존 구조를 추가한다.
   - `legacy_kind`
   - `legacy_id`
   - `inventory_shipment_id`
   - `classification`
   - `evidence_snapshot`
   - `linked_by`
   - `linked_at`
   - unique 제약
2. legacy RPC/function 실행 권한을 revoke한다.
3. `shipping_requests` 및 `commerce_shipments`의 새 mutation을 DB에서 차단한다.
4. compatibility read RPC/view를 추가한다.
5. backfill은 별도 migration 또는 명시적 검증 script로 수행하되, 사전 count·충돌 검사·transaction·residual 검사를 포함한다.

기존 적용 migration을 수정하거나 삭제하지 않는다. 테이블 drop, 기존 행 delete, 기존 history overwrite는 이 단계 설계에서 금지한다.

## 7. 데이터 손실 없는 전환 순서

```text
현행 writer/reader 및 production count 확인
  → compatibility link/read 계약 추가
  → v2 canonical read contract 고정
  → legacy 신규 writer 차단
  → 모든 신규 요청을 v2로 전환
  → legacy 행을 A/B/C로 분류
  → A만 검증된 link/backfill
  → dual-read 기간 운영
  → 중복·residual·tracking·settlement 검증
  → legacy read 사용처 제거
  → legacy 테이블은 history 보존 상태로 유지
```

전환 중에도 고객이 기존 배송 이력을 잃지 않도록 compatibility read를 먼저 배포하고 writer를 나중에 차단한다. 단, writer 차단과 신규 v2 요청 전환은 같은 rollout 경계에서 활성화해 새 legacy 행이 다시 생기지 않게 한다.

## 8. Rollback 전략

rollback은 데이터 삭제가 아니라 애플리케이션 rollout 되돌리기로 한정한다.

- 새 v2 API/UI에 문제가 있으면 이전 애플리케이션 버전으로 되돌릴 수 있어야 한다.
- v2 행, link 행, legacy history는 rollback을 이유로 삭제하지 않는다.
- legacy writer를 다시 열어 dual-write 상태로 되돌리지 않는다.
- rollback 중 신규 요청을 일시 차단하고, canonical v2 행과 compatibility link의 residual을 조사한다.
- migration은 additive이므로 함수 revoke를 되돌릴 때도 별도 승인·검증 migration으로만 수행한다.
- 실제 production rollback 가능 여부와 현재 배포 버전은 `PRODUCTION_UNVERIFIED`다.

## 9. 반드시 추가할 테스트

### SQL 계약

- v2만 신규 shipment를 생성할 수 있음.
- legacy RPC 전부 revoke 및 직접 table DML 차단.
- `shipping_requests` projection이 v2 사실과 다르게 변경될 수 없음.
- `commerce_shipments` history가 직접 mutation되지 않음.
- link table의 legacy ID·v2 ID 유일성.
- 자동 승격 A/B/C 분류가 추정 없이 fail-closed.
- 기존 shipped tracking과 settlement가 승격 후 동일함.

### 동시성·멱등성

- 같은 v2 요청 동시 실행 시 active shipment 하나.
- 같은 idempotency key replay는 동일 결과.
- 다른 payload의 같은 key 재사용은 거부.
- 동시에 legacy 요청과 v2 요청을 보내도 두 shipment가 생성되지 않음.
- tracking 중복·stale CAS·pack/ship 경쟁이 실패-폐쇄.

### API·UI

- `inventoryItemIds` 요청은 v2 RPC만 호출.
- `orderId` legacy body는 차단되고 기존 history 조회에는 영향이 없음.
- 고객 화면에서 v2와 legacy history가 중복 표시되지 않음.
- 운영자 화면의 pack/ship/tracking correction은 v2만 호출.
- owner compatibility history는 읽을 수 있지만 mutation control이 없음.

### 운영 검증

- migration parity
- 적용 전후 shipment별 count 및 status report
- active shipment/tracking 중복 zero
- link residual 및 unmapped 행 report
- 실제 고객·운영자 smoke test
- rollback rehearsal는 production이 아닌 격리 DB에서 수행

## 10. 작업 완료 조건

P1-3은 다음 조건을 모두 만족해야 완료로 표시한다.

- 신규 shipment의 source of truth가 `inventory_shipments` 하나로 고정됨.
- 신규 API·UI·RPC가 legacy writer를 호출하지 않음.
- legacy RPC와 직접 DML 우회가 DB 권한/trigger에서 차단됨.
- 기존 legacy history를 삭제하지 않고 고객·운영자 화면에서 중복 없이 읽을 수 있음.
- 승격 대상·검토 대상·보존 대상의 분류와 증거가 남아 있음.
- active shipment 1건, tracking unique, full release/pack/ship gate가 동시성 테스트를 통과함.
- migration parity와 production smoke가 통과함.
- 현재 운영 배포 버전과 적용 migration이 확인됨.
- 문서·코드·DB 계약이 서로 일치함.

IMPLEMENTATION ORDER:
1. Production read-only preflight와 전체 shipment count/dependency snapshot
2. Compatibility link/read 계약 및 회귀 테스트 추가
3. v2 canonical API/read 계약 고정
4. Legacy API branch와 legacy RPC 신규 호출 차단
5. DB privilege/trigger로 legacy mutation 이중 차단
6. A/B/C 승격 분류 및 A 대상 검증 backfill
7. Dual-read 검증, 중복·residual·tracking·settlement 검사
8. 실제 production migration parity 및 smoke 검증
9. 문서 상태 갱신 후 P1-3 완료 판정

ACCEPTANCE CRITERIA:
- `inventory_shipments`가 신규 배송 사실의 유일한 canonical writer/source of truth다.
- `commerce_shipments`와 `shipping_requests`는 기존 history compatibility read만 제공한다.
- 신규 dual-write가 없고 legacy writer 우회가 DB에서 실패한다.
- 기존 데이터는 삭제·덮어쓰기 없이 분류·link·검증된다.
- 고객/운영자 화면에서 기존 history와 신규 v2 shipment가 중복되지 않는다.
- 동시성·CAS·idempotency·tracking unique·권한·migration parity 테스트가 모두 통과한다.

DO NOT MODIFY:
- 기존 적용 migration 파일
- 기존 `shipping_requests`, `commerce_shipments`, `inventory_shipments` history 행
- 기존 ledger, refund, settlement, fulfillment event 행
- legacy history를 근거 없이 v2 상태로 추정하는 backfill
- application dual-write 또는 legacy writer 재활성화
- production 데이터에 대한 무승인 mutation

PRODUCTION VERIFICATION REQUIRED:
- `20260805010000_enforce_inventory_shipment_mutation_gate.sql`의 실제 production 적용 및 trigger 활성 상태
- 현재 production의 세 shipment 모델별 행 수, status 분포, FK/dependency, active/tracking 중복
- production migration parity 전체 결과
- production env와 실제 호출 route의 v2/legacy traffic 여부
- 실제 고객 배송 이력 read와 운영자 pack/ship/tracking correction smoke
- compatibility link/backfill 전후 residual 및 데이터 손실 없음
- 실제 배포 버전, rollback 가능한 이전 버전, cron/job 상태
