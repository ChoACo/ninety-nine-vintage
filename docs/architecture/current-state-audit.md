# 현행 코드 감사

조사 기준: `refactoring-cleanup` 브랜치, 커밋 `342b6de`

조사 방식: 코드 및 로컬 마이그레이션 정적 조사. 운영 DB 상태와 인증이 필요한 화면 동작은 이번 문서 작업에서 재검증하지 않았다.

> 구현 추적: `feature/manual-transfer-only` 브랜치에서 P0-2 코드와 마이그레이션을 작성했다. 아래 내용은 구현 전 기준선이며, 새 마이그레이션의 운영 DB 적용과 배포가 끝나기 전에는 운영 상태가 변경된 것으로 간주하지 않는다.

> 2026-07-21 후속 추적: `codex/fix-manual-transfer-atomic-confirmation` 브랜치에서 P0-5의 직접 확정 차단, 처리자별 브라우저 재시도 키를 포함한 입금 영수증 멱등성, 원장 합계·버전 CAS, 다매장 공용 입금 큐, 정방향/역분개 잠금 순서, 경매 부분입금 자동 만료 보류와 원래 기한 snapshot, 숨은 Owner 테스트 계정의 운영자 RPC 차단, 확정된 통합 주문 역분개 시 고객 정정 알림, 주문-입금요청 단일 RPC 경계를 구현했다. 고정가 체크아웃은 경매 blackout 중에도 선택한 고정가 상품만 정확히 마감할 수 있고, 서버 service-key 직접 테이블 접근 권한은 저장소가 실제 사용하는 21개 읽기와 6개 mutation 종류로 명시했다.

> 2026-07-22 운영 추적: `20260721134000`~`20260721143000`은 운영 DB에 적용했고 `06519e5`를 Production에 배포했다. 이어 `20260722010000_shared_commerce_payment_queue_snapshot.sql`을 운영 DB에 적용하고 코드 커밋 `625942c`를 Vercel Production 배포 `dpl_9d3ghP2GQNTLaT3tpdK8itjT81Tr`로 공개 도메인에 연결했다. 마이그레이션 parity, 함수 ACL, 유효 인덱스 2개, `active_count=0`, `active_overflow=false`, `integrity_error=false`, 공개 통합 검사, `site/status` DB 연결, 비인증 운영자 API 401, 인증된 운영자 주문 화면과 대시보드 읽기 검증은 통과했다. 처리 대기 건이 없어 실제 입금 mutation은 운영 환경에서 실행하지 않았다. 구매 제안 연결 입금의 잘못된 부분입금을 되돌려 자동 만료로 복귀시키는 Owner 재정산 상태와 경매·배송비 원장 이력/정정 UI는 아직 없다.

> 2026-07-22 역분개 후속 운영 추적: `20260722020000_harden_manual_transfer_reversal.sql`을 운영 DB에 적용하고 코드 커밋 `fe88ae9`를 최초 Vercel Production 배포 `dpl_8CnZjNxyCLFcW6WxAHf67Cyvp99j`로 공개했다. 현재 공개 도메인 alias는 Ready 재배포 `dpl_3thy1uLNCRe4Bcj1y6NgkYSKEQze`에 연결돼 있다. 역분개 RPC는 URL의 transfer 종류·ID와 원본 ledger를 같은 mutation 안에서 결박하고, 화면이 관찰한 signed 원장 합계·행 수 CAS와 처리자별 멱등 재시도를 강제한다. PostgreSQL 18.4 임시 클러스터와 Docker Desktop 4.83.0·Engine 29.6.2의 PostgreSQL 17.10 격리 Compose 환경에서 계약과 실제 다중 세션 경쟁 검증을 모두 통과했다. Docker runner는 성공 후 프로젝트·컨테이너·네트워크·볼륨을 제거했다. 공개 통합 검사, `site/status` DB 연결, 비인증 mutation 차단과 인증된 운영자 주문·대시보드 읽기 검증도 통과했다. 운영 원장이 비어 있어 실제 역분개 mutation은 실행하지 않았다.

> 2026-07-22 중앙 물류 기반 구현 추적: `20260722030000_add_central_fulfillment_foundation.sql`은 `businesses`, 주소 설정 전 `configuration_required`인 기본 `fulfillment_centers`, 주문·매장별 `store_fulfillment_works`, 주문 상품별 `order_item_fulfillments`, append-only `fulfillment_events`를 순방향으로 추가한다. 결제 상태나 보관 만료를 실물 입고로 추정하지 않고, 명시적 취소·발송 사실 외 기존 상품은 `reconciliation_required/unknown`으로만 분류한다. 새 테이블은 Owner 읽기만 허용하며 신규 주문 초기화 trigger, 물류 전이 RPC, 기존 송장 gate는 실제 센터 주소와 P0-3 세부 권한을 확정한 후 별도 단계에서 활성화한다. 정적 계약, PostgreSQL 18.4 임시 클러스터, Docker PostgreSQL 17.10 격리 suite가 같은 backfill·FK·CHECK·append-only·RLS/ACL 계약을 통과했고 두 runner 모두 임시 자원을 제거했다. 커밋 `95a8239` 이후 연결된 운영 DB에도 이 마이그레이션을 적용했으며 로컬·원격 73개 이력 일치와 운영 스키마의 강제 RLS, Owner 조회 정책, `service_role` 직접 권한 부재를 재확인했다. 따라서 이 변경은 P1-1 기반이지 중앙 집하 운영 완료나 단일 송장 강제 완료가 아니다.

> 2026-07-22 중앙 물류 활성화 운영 추적: `20260722040000_add_store_memberships_permissions.sql`과 `20260722050000_activate_central_fulfillment_intake.sql`을 운영 적용했다. 전자는 `store_memberships`와 8개 세부 권한, Owner 전용 권한 변경 RPC, 감사 이력, 매장·사업체 권한 helper를 활성화한다. 기존 `stores.operator_id`가 실제 운영자인 매장은 운영자와 그 직원의 소속으로 이관하되 중앙 입고·송장 권한은 추론하지 않는다. `operator_id`가 Owner인 레거시 매장은 유효한 예외로 보존하고 잘못된 운영자 소속을 만들지 않으며 Owner의 암시적 전역 권한으로만 접근한다. 후자는 신규 주문 상품 초기화와 결제 상태 projection, 운영자 준비 완료·중앙 인계, Owner 센터 실제 주소 설정·입고·보관·문제 등록/해제 RPC와 사용자 컨텍스트 API/UI를 활성화한다. 모든 mutation은 버전 CAS, 처리자별 멱등 키, append-only 이벤트를 사용하고 직접 테이블 DML과 `service_role` 실행은 열지 않는다. 다만 canonical Shipment, 주문/배송 요청당 활성 송장 1건 제약, 전 상품 집하·합포장 선행 조건과 구 배송 API/RPC 우회 차단은 아직 구현되지 않았다.

## 요약

조사 기준선의 코드는 통합 장바구니, 매장 정보가 포함된 통합 주문, 수동 계좌이체 원장, 직원/운영자 역할, 고객 보관과 배송 요청을 이미 갖고 있었다. 후속 `20260722030000`~`20260722050000` 운영 적용으로 중앙 출고 기반, 명시적 매장 소속·세부 권한, 신규 주문 projection, 매장 준비·인계와 Owner 중앙 입고·보관 화면은 활성화됐다. 아직 남은 핵심 차이는 canonical Shipment, 주문/배송 요청당 송장 1건 강제, 전 상품 중앙 집하·합포장 gate, 기존 배송 mutation 우회 차단이다. 기준선에서 PortOne은 격리된 미래 코드가 아니라 런타임에서 전환 가능한 완전한 결제 경로였다. 후속 P0-2는 운영 DB와 Production까지 반영해 수동이체만 활성화했고 PortOne 어댑터와 기록은 비활성 상태로 보존한다.

## 영역별 확인 결과

### 저장소와 런타임

- Next.js App Router, Supabase, PortOne SDK, Zustand를 사용한다. 근거: `package.json`.
- README는 Vercel을 운영 런타임으로 설명하지만 Cloudflare OpenNext 스크립트와 설정도 존재한다. 근거: `README.md`, `package.json`, `open-next.config.ts`, `wrangler.jsonc`.
- 패키지 관리자는 `npm@11.16.0`으로 선언되어 있다. 근거: `package.json`.
- 로컬 Supabase 마이그레이션은 조사 시점에 62개다. `db/schema.ts`는 의도적으로 비어 있으므로 현재 데이터 계약의 실질적 근거는 Drizzle 스키마가 아니라 순서대로 적용되는 `supabase/migrations/*.sql`이다. 근거: `supabase/migrations/`, `db/schema.ts`, `drizzle/meta/_journal.json`.

### 인증과 권한

- 데이터베이스 역할은 `owner`, `operator`, `employee`, `band_member`, `member`다. 근거: `src/lib/supabase/auth.ts`, `src/lib/commerce/server.ts`, `supabase/migrations/20260718030000_add_role_levels_revenue_enforcement.sql`.
- 직원은 `reports_to_operator_id`로 한 운영자에게 연결되고, 서버의 `effectiveOperatorId`가 그 운영자 ID를 사용한다. 근거: `src/lib/commerce/server.ts`, `supabase/migrations/20260718060000_hidden_owner_delegation_and_test_member.sql`.
- 조사 기준선의 매장은 단일 `operator_id`만 가졌지만, 운영 반영된 `20260722040000`은 `store_memberships`와 `manage_products`, `publish_products`, `prepare_orders`, `confirm_payments`, `receive_at_center`, `create_shipments`, `manage_staff`, `view_reports`를 추가했다. 실제 운영자 담당 매장은 운영자·직원 소속으로 이관하며 Owner 담당 레거시 매장은 별도 소속을 만들지 않고 Owner 암시적 권한으로 보존한다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`, `supabase/migrations/20260722040000_add_store_memberships_permissions.sql`.
- 운영자 계정 수를 두 개로 맞추려는 프로비저닝 전제가 주석에 있으나 스키마 자체가 시스템 관리자 1명·운영자 정확히 2명을 일반 제약으로 표현하지는 않는다. 근거: `supabase/migrations/20260718010000_allow_configured_operator_ids.sql`.

### 상품

- 상품은 `store_id`, 보관 분류, 치수, 상태 등급, 상태·하자 메모를 가진다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`.
- 운영자/직원 인증을 통과한 사용자는 자기 유효 운영자에 연결된 매장 범위에서 상품을 생성할 수 있다. 근거: `src/app/api/admin/operator/products/route.ts`, `supabase/migrations/20260721030000_harden_operator_product_mutations.sql`.
- 기존 구현은 생성 상품을 `pending`으로 저장한 뒤 운영자 전용 공개 RPC를 다시 호출해 “권한 있는 직원의 즉시 등록·공개” 목표와 충돌했다. 후속 `20260722130000_activate_direct_product_publishing.sql`과 상품 관리 API/UI는 `pending`을 초안으로만 표현하고 `publish_products` 권한이 있는 운영자·직원이 저장 직후 동일한 공개 RPC를 호출하도록 재구현했다. 이 순방향 마이그레이션은 아직 운영 DB에 적용하지 않았다.
- `inspection_notes` 필드명은 호환성을 위해 유지하지만 UI에서는 상태 등급·오염·수선·사용감 등 객관적인 `상태·하자 메모`로만 표현하며 승인·전문가 검수·품질 보증 의미를 제거했다.

### 장바구니와 통합 주문

- 장바구니는 고객·상품 복합 키이며 매장별 장바구니로 분리되지 않는다. API는 고정가 상품 예약 RPC를 사용한다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`, `src/app/api/cart/route.ts`.
- `commerce_orders`는 고객별 통합 주문이며 `commerce_order_items`가 상품과 `store_id`를 가진다. 조사 기준선에는 별도 매장 처리 업무가 없었으나 후속 `20260722030000`과 `20260722050000`은 주문·매장별 `store_fulfillment_works`와 신규 주문 자동 projection을 활성화했다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`, `supabase/migrations/20260722030000_add_central_fulfillment_foundation.sql`, `supabase/migrations/20260722050000_activate_central_fulfillment_intake.sql`.
- 주문 생성은 여러 상품 ID를 한 RPC에 전달하고 멱등 키를 사용한다. 근거: `src/app/api/orders/checkout/route.ts`, `supabase/migrations/20260720180000_add_commerce_portone_checkout.sql`의 최종 `create_commerce_order` 정의.
- 경매 낙찰 정산은 고정가 통합 주문과 별도 테이블/흐름을 유지한다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`의 테이블 주석과 경매 관련 후속 마이그레이션. 통합 주문 정책에 경매 낙찰을 언제 합칠지는 아직 불명확하다.

### 수동 계좌이체

- DB에는 향후 재활성화를 위한 `manual_transfer | portone` 모드와 PortOne 기록이 남아 있지만, 현재 서버 설정 동기화·체크아웃·공개 결제 API는 수동이체만 활성화한다. 근거: `src/lib/commerce/paymentMode.ts`, `src/app/api/orders/checkout/route.ts`, `supabase/migrations/20260720170000_server_sync_manual_transfer_runtime.sql`.
- 수동입금은 통합 주문별 `commerce_order_transfers`와 append-only 성격의 `manual_transfer_payment_ledger`를 사용한다. 일부 입금, 확인, 취소/역분개 상태가 있다. 근거: `supabase/migrations/20260719150000_commerce_runtime.sql`, `supabase/migrations/20260720150000_manual_transfer_operator_ledger.sql`, `supabase/migrations/20260720160000_manual_transfer_shipping_fee_ledger.sql`.
- 후속 P0-5 구현은 고정가 통합 주문의 공용 입금 큐를 시스템 관리자와 모든 활성 운영자에게 전역으로 제공한다. 주문 참여 매장 여부로 제한하지 않는다. `20260722040000`으로 `confirm_payments` 플래그 기반은 생겼지만 기존 공용 입금 API/RPC의 직원 허용 조건까지 전환하지 않았으므로 직원(`employee`)은 계속 제외된다. 근거: `src/app/api/admin/operator/orders/route.ts`, `src/app/api/admin/operator/transfers/[id]/ledger/route.ts`, `supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql`, `supabase/migrations/20260722040000_add_store_memberships_permissions.sql`.
- 공용 큐는 타 매장 상품 원문 전체가 아니라 결제 대조에 필요한 주문·회원 식별자, 상품 요약, 예정/누적/잔액, 상태, 계좌 스냅샷과 원장 감사 정보만 명시적 필드 목록으로 투영한다. 원장 합계·행 수와 주문별 상품 요약은 Data API 행 제한과 무관한 집계 RPC에서 계산하며, 직접 테이블 RLS는 회원 본인의 주문·입금 기록만 허용한다. 브라우저는 입금 mutation 직전에 현재 인증 계정을 다시 확인하고 로그아웃·계정 전환 때 공용 큐를 비운다. 근거: `src/app/api/admin/operator/orders/route.ts`, `src/components/admin/operator/OperatorOrdersConsole.tsx`, `supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql`.
- 운영 반영된 P1의 `get_shared_commerce_payment_queue_page`는 활성/완료 lane, 전체 signed 원장 합계·행 수(CAS), 전송별 최근 원장 100건을 하나의 SQL 문장 snapshot으로 읽는다. 활성 401번째 건은 부분 목록 없이 실패-폐쇄하고, 완료 이력은 `(activity_at, transfer_id)` 내림차순 keyset으로 더 불러온다. 상품 요약은 기존 `get_shared_commerce_payment_order_summaries` 후속 호출이므로 API 전체가 하나의 DB snapshot이라는 의미는 아니다. 각 페이지 호출도 독립된 live snapshot이어서 페이지 사이에 새로 완료된 건은 첫 cursor 위에 생길 수 있으며 새로고침으로 회수한다. `activity_at`은 요청·확정·최신 원장 시각의 최댓값을 계산하지만 현재 스키마에 `cancelled_at`이 없어 원장 없는 취소 건은 요청 시각으로 정렬되는 한계가 있다. 근거: `supabase/migrations/20260722010000_shared_commerce_payment_queue_snapshot.sql`, `src/app/api/admin/operator/orders/route.ts`.
- 단순 확인 API는 의도적으로 차단되고 실제 입금자명·금액을 원장에 쓰도록 요구한다. 근거: `src/app/api/admin/operator/orders/[id]/confirm/route.ts`, `src/app/api/admin/operator/transfers/[id]/ledger/route.ts`.
- 경매 부분입금은 첫 입금 시 주문 기한과 구매 제안 기한의 정확한 원값을 주문 행에 보존한 뒤 현재 기한만 `NULL`로 보류한다. 원기한 자체가 `NULL`인 면제 주문도 hold 시각으로 미보류 상태와 구분한다. 구매 제안 미연결 주문의 순원장이 0원이 되면 저장한 원값을 복원하며, 구매 제안 연결 역분개는 전용 Owner 재정산 계약 전까지 실패-폐쇄한다. 근거: `supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql`.
- 숨은 Owner 테스트 회원은 Owner 전용 proxy 계약을 유지한다. 일반 운영자는 대기 목록뿐 아니라 ID를 알고 있어도 경매 잔액 조회·입금 기록·역분개 RPC에서 차단된다. 근거: `supabase/migrations/20260718060000_hidden_owner_delegation_and_test_member.sql`, `supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql`.
- 후속 P1의 두 역분개 RPC는 요청 종류와 URL 대상 ID, 원본 ledger의 종류·transfer ID를 부모 행 잠금 안에서 함께 검증하고, signed 원장 합계와 원장 행 수가 화면 snapshot과 일치할 때만 반대 원장을 추가한다. 새 역분개 재시도 키는 처리자별 UUIDv4로 격리하며 같은 대상·원장·사유 replay만 같은 역분개 ID로 재확인하고, 다른 payload의 키 재사용은 실패-폐쇄한다. 브라우저는 대상·원장·사유·CAS snapshot을 포함한 fingerprint에 키를 보존하고 엄격한 성공 응답 뒤에만 제거한다. 근거: `supabase/migrations/20260722020000_harden_manual_transfer_reversal.sql`, `src/app/api/admin/operator/transfers/[id]/ledger/route.ts`, `src/lib/manualTransferReceipt.ts`.

### PortOne

다음 두 항목은 구현 전 조사 기준선 설명이다. 후속 P0-2는 PortOne 공개 실행 경로를 비활성화하고 어댑터와 기록만 보존한 상태로 운영 배포까지 완료했다.

- 기준선에서 PortOne은 어댑터 보관 상태가 아니라 체크아웃 준비, 브라우저 결제, 서버 동기화, 웹훅, 결제 완료 화면까지 연결된 활성 후보 경로였다. 근거: `src/app/api/orders/checkout/route.ts`, `src/app/api/payments/prepare/route.ts`, `src/app/api/payments/sync/route.ts`, `src/app/api/webhook/portone/route.ts`, `src/app/(shop)/payment/complete/page.tsx`, `src/lib/portone/`.
- DB에도 PortOne 결제 준비와 이중 수동입금 방지 트리거가 있다. 근거: `supabase/migrations/20260720180000_add_commerce_portone_checkout.sql`.
- 목표인 “수동이체만 활성, PortOne 격리 보존”을 만족하려면 런타임 전환, UI 노출, 공개 API 진입점을 단계적으로 차단하되 DB 기록과 어댑터 코드는 보존해야 한다.

### 보관

- 결제된 주문 상품은 `storage_expires_at`을 가지며 소형 14일, 대형 7일이라는 기존 주석 정책이 있다. 근거: `supabase/migrations/20260719130000_multistore_commerce_storage.sql`.
- 고객 보관 API는 결제된 주문 상품과 경매 낙찰 상품을 함께 반환한다. 근거: `src/app/api/account/storage/route.ts`.
- 조사 기준선에는 물리적 중앙 출고지, 선반/위치, 중앙 입고자, 입고 시각을 표현하는 엔터티가 없고 보관 만료만 시간 중심으로 존재했다. 후속 `20260722030000`은 중앙 출고지, 상품별 현재 위치·보관 위치 코드와 이벤트 기반을 추가했고, 운영 반영된 `20260722050000`은 Owner의 실제 센터 주소 구성과 상품별 입고·보관·문제 처리 mutation을 활성화했다. 기존 `storage_expires_at`과 이 물리 상태의 통합은 P1-4로 남아 있다.

### 배송

- `shipping_requests`와 `shipping_request_items`는 여러 상품을 한 배송 요청에 묶고 택배사·송장번호를 요청에 저장한다. 근거: `supabase/migrations/20260718000000_add_member_operations_and_staff_products.sql`, `src/app/api/shipping/requests/route.ts`.
- 운영자 배송 API는 배송 요청 단위로 송장을 입력하고 발송 처리한다. 근거: `src/app/api/admin/operator/shipping/route.ts`.
- 조사 기준선에 없던 중앙 출고지, 매장 인계, 중앙 입고는 `20260722030000`과 `20260722050000`으로 활성화됐다. 전 상품 집하·최종 확인·합포장 뒤에만 송장을 만들 수 있게 하는 제약은 아직 없다.
- DB에서 주문당 또는 배송 요청당 활성 송장 정확히 1개를 보장하는 별도 `shipments` 엔터티/유니크 제약은 확인되지 않았다. 현재 송장 필드는 `shipping_requests`에 직접 있다.
- 배송비는 상품 주문 시점과 보관 상품 배송 요청 시점에 서로 다른 흐름이 존재한다. 근거: `commerce_orders.shipping_fee`, `shipping_fee_payments`, `src/app/api/shipping/requests/route.ts`. 통합 정책에서 언제 배송비를 한 번 받는지 명확화가 필요하다.
- 후속 `20260722030000`~`20260722050000`도 기존 `shipping_requests`, Owner 직접 UPDATE API, 운영자 송장 RPC를 차단하거나 canonical Shipment로 승격하지 않는다. 따라서 기존 송장 경로가 중앙 입고·최종 확인·합포장을 검사하지 않고 우회할 수 있는 위험은 P1-3 완료 전까지 그대로 남는다.

### 운영자 콘솔

- 상품, 주문, 매출, 배송, 회원, 상담 화면에 더해 운영자 중앙 출고 준비·인계 화면과 Owner 중앙 입고·보관·문제 처리 화면이 존재한다. 근거: `src/app/(admin)/admin/operator/fulfillment/`, `src/app/(admin)/admin/owner/fulfillment/`, `src/app/api/admin/operator/fulfillment/`, `src/app/api/admin/owner/fulfillment/`.
- 현재 콘솔은 매장 준비→중앙 인계→Owner 중앙 입고→보관까지 제공하지만 합포장·Shipment·단일 송장 단계는 제공하지 않는다.
- 데이터 권한은 별도 역할 대신 `prepare_orders`, `receive_at_center`, `create_shipments` 플래그로 표현한다. 현재 중앙 입고 웹 API/UI는 엄격한 Owner 인증 경계이며, 다른 권한 보유자를 위한 중앙 화면은 아직 열지 않았다.

## 구현 전 반드시 확정할 미결 사항

1. 경매 낙찰 상품을 고정가 장바구니의 같은 주문에 합칠 수 있는가, 아니면 결제 전 통합 주문으로 승격하는가.
2. [2026-07-22 결정] 직원의 `confirm_payments`, `prepare_orders`, `receive_at_center`, `create_shipments` 기본값은 모두 `false`다. 실제 운영자는 준비·입금 권한을 받고 중앙 입고·송장 권한은 받지 않는다.
3. [2026-07-22 결정] 중앙 출고 담당자용 새 역할을 만들지 않고 기존 사용자에게 세부 권한을 부여한다. 현재 중앙 입고 화면은 Owner만 사용한다.
4. 주문 즉시 배송과 보관 후 배송의 배송비 부과 시점 및 중복 방지 규칙.
5. 일부 상품 문제·취소 시 고객과 합의가 지연될 때 나머지 상품의 최대 대기 정책.
6. `inspection_notes`와 condition grade를 유지하되 승인 절차로 오해되지 않게 하는 `상태·하자` UI 용어.
7. 기존 `pending` 상품 상태를 `draft`로 의미 변경할지, 즉시 공개 생성과 별도 임시 저장을 추가할지.

추측으로 채우지 않고 각 항목이 결정된 뒤 마이그레이션과 API 계약을 작성한다.
