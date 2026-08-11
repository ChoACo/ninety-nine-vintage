# 전체 포렌식 조치·배포 실행 기록

기준일: 2026-08-10 (Asia/Seoul)
범위: 전체 포렌식 결과에 대한 코드·DB 조치와 최종 배포 게이트

## 1. 기준선

- 목표 기준: `C:\Users\rlaal\.codex\attachments\5fbbdcf4-5e64-4f3d-9be3-241ea6e11a76\goal-objective.md`
- 저장소: `C:\Users\rlaal\Documents\Codex\ninety-nine-homepage`
- 기준 커밋: `ce65024 docs: record second forensic operating evidence`
- 기준 포렌식 문서: `docs/full-system-forensic-audit-20260810.md`, `docs/forensic-result-1-20260810.md`, `docs/forensic-result-2-20260810.md`
- 기준 테스트: core 339개 중 333 pass, 6 skip; lint/build 통과; migration parity 161개
- 기준 운영 오류: `/admin/owner/site-status` 404, `/stores/dami-shop` 500, operator scope 오류, 12시간 큐 라벨 충돌, account 부분 오류

## 2. 1차 조치 완료

### 2.1 소유자 센터 범위 조회

- 경로: `src/app/api/admin/operator/store-scope/route.ts`
- 문제: owner가 사용자 RLS 클라이언트로 매장 목록을 조회하여 `store_scope_unavailable`가 발생할 수 있었다.
- 조치: owner 지원 목록은 인증된 `auth.admin` 서버 클라이언트로 활성 매장만 조회하도록 변경했다. 운영자 소속 매장 조회는 기존 사용자 범위를 유지한다.
- 검증: `tests/core/operator-store-scope.test.mjs` 통과.

### 2.2 site-status 깊은 링크

- 경로: `src/app/(admin)/admin/owner/site-status/page.tsx`
- 문제: API와 대시보드 패널은 존재하지만 지정 URL 페이지가 없어 404였다.
- 조치: 대시보드의 단일 관리 화면으로 redirect하는 동적 페이지를 추가했다. 중복 편집 화면은 만들지 않았다.
- 검증: production 배포 후 404가 사라지고 `/admin/owner`로 이동하는지 확인한다.

### 2.3 입금 확인 큐 12시간 계약

- 경로: `supabase/migrations/20260810200000_limit_owner_payment_confirmation_queue_to_12_hours.sql`
- 문제: `get_owner_payment_confirmation_queue()`가 모든 open 요청을 반환하면서 UI는 모두 12시간 이상으로 표시했다.
- 조치: `first_requested_at <= clock_timestamp() - interval '12 hours'`를 RPC의 서버 필터로 추가하고 동일 권한·GRANT를 재선언했다.
- UI 경로: `src/components/admin/owner/OwnerPaymentConfirmationQueue.tsx`
- UI 조치: 재시도 버튼과 실패 상태를 추가했다. 자동 입금확정은 추가하지 않았다.
- 검증: `tests/core/payment-confirmation-escalation.test.mjs` 통과; 원격 Supabase migration 적용 완료.

### 2.4 공개 매장 페이지 권한 계약

- 경로: `src/services/stores.ts`
- 문제: 공개 매장 조회가 `description`·`is_active`를 선택했지만 원격 공개 column grant에는 해당 필드가 없어 `dami-shop` 페이지가 500이었다.
- 조치: slug 단건 조회로 변경해 불필요한 전체 매장 조회를 제거했다.
- DB 경로: `supabase/migrations/20260810201000_grant_public_storefront_columns.sql`
- DB 조치: 공개 storefront에 필요한 `id, name, slug, description, is_active`만 `anon, authenticated`에 부여했다. 운영자·주소·정산 필드는 공개하지 않았다.
- 검증: publishable key로 `dami-shop` 단건 조회가 오류 없이 반환됨; 원격 migration 적용 완료.

### 2.5 owner의 직원센터 지원 진입

- 경로: `src/components/admin/employee/EmployeeOwnerScopeBridge.tsx`, `src/app/(admin)/admin/employee/layout.tsx`
- 문제: owner가 직원센터를 열 수 있지만 명시적 매장 범위를 선택할 UI가 없어 직원 API 호출이 scope 오류로 끝날 수 있었다.
- 조치: owner에게만 기존 `OperatorStoreScopeSelector`를 직원센터 상단에 표시한다. 실제 직원 계정에는 표시하지 않는다.
- 검증: lint 통과; 배포 후 owner support scope 선택과 직원 화면 GET을 실제 세션에서 확인한다.

### 2.6 account 부분 오류 안내

- 경로: `src/components/features/account/AccountDashboard.tsx`
- 문제: member 전용 API가 `member_required`를 반환해도 수치가 0/00으로 표시되고 일반적인 부분 오류로만 안내됐다.
- 조치: 응답 계약에서 `member_required`를 식별하고, 수치를 `—`로 표시하며 소유자 센터에서 임시 회원 권한을 활성화하라는 사용자 안내를 표시한다. 내부 오류 코드는 노출하지 않는다.
- 검증: lint 통과; member mode 활성/비활성 역할별 브라우저 확인이 남아 있다.

### 2.7 소유자 운영자센터 범위 모드 정합성

- 재현: 운영자 URL에서 소유자 세션이 `store_scope_unavailable`(HTTP 503)을 반환했다. `/api/admin/session`은 `roleCode=owner`였지만, 해당 계정의 `operator_store_scope_preferences.access_mode`가 과거 운영자 값인 `assigned`로 남아 있었다.
- 영향 경로: `src/app/api/admin/operator/store-scope/route.ts`의 `owner_support` 검증 실패 → 센터 선택기가 오류 상태에 고정 → 운영자 API의 `require_active_operator_store_scope()`도 연쇄 실패.
- 경로: `supabase/migrations/20260811090000_reconcile_owner_operator_store_scope_mode.sql`
- 조치: 기존 owner 행의 모드를 `owner_support`로 보정하고 만료시켜 재선택을 요구한다. `get_operator_store_scope()`도 역할이 바뀐 계정의 이전 모드를 클라이언트로 반환하지 않고 현재 역할의 정규 모드(`owner_support` 또는 `assigned`)로 반환한다.
- 검증: 원격 계정의 모드가 `owner_support`로 보정된 뒤 소유자 운영자센터에서 센터 목록이 표시되고 `다미네` 선택 후 운영자 요약 API가 정상 응답했다.

### 2.8 소유자 입금 확인 콘솔 연결 및 매장 범위 충돌 해소

- 재현: `/admin/owner/payments`가 12시간 초과 요청 배너만 표시하고 실제 입금 확정·부분 입금·원장 조정·취소 UI를 제공하지 않았다. 기존 전체 콘솔은 `/admin/operator/payments`에만 있었지만 해당 직접 URL은 운영자 fulfillment로 redirect되어 소유자 업무 경로에서 사용할 수 없었다.
- 영향 경로: `src/components/admin/owner/OwnerPaymentConfirmationQueue.tsx`의 긴급 큐 아래에 처리 화면이 없었고, 운영자 결제 API 3개가 `authenticateOperatorStoreRequest`를 사용해 소유자 세션에도 선택 매장을 요구했다.
- 코드 경로: `src/app/(admin)/admin/owner/payments/page.tsx`, `src/components/admin/operator/OperatorPaymentsConsole.tsx`, `src/lib/commerce/server.ts`, `src/app/api/admin/operator/payments/route.ts`, `src/app/api/admin/operator/payments/[kind]/[id]/confirm/route.ts`, `src/app/api/admin/operator/transfers/[id]/ledger/route.ts`.
- 조치: 소유자 결제 페이지에 기존 검증된 `OperatorPaymentsConsole`을 `ownerSurface` 모드로 마운트했다. `authenticateOwnerPaymentRequest`를 추가해 소유자 전용 결제 API는 운영자 선택 매장 범위를 요구하지 않도록 했으며, 최종 소유자 권한·CAS·멱등·원장 검증은 기존 DB RPC에 그대로 위임했다. 운영자 일반 API의 매장 범위 강제는 유지했다.
- 회귀 계약: `tests/core/operator-payment-member-operations.test.mjs`, `tests/core/unified-inventory-fulfillment-v2.test.mjs`, `tests/core/operator-store-scope.test.mjs`에 소유자 결제 경로와 매장 범위 예외를 명시했다.
- 검증: 전체 core test 338개 중 332 pass, 6 skip; lint 및 production build 통과. 실제 운영 입금 확정 mutation은 실행하지 않았다.

### 2.9 소유자 미입금 결제 대기 취소

- 요구: 결제 대기 상태로 남은 고정가 상품 주문을 소유자가 사유와 함께 일방 취소하고 상품을 다시 판매 가능 상태로 돌린다.
- 적용 범위: `commerce` 고정가 결제만 지원한다. 입금액이 1원이라도 있거나 부분 입금·경매 낙찰·배송비 결제인 건은 이 경로에서 취소하지 않고 기존 환불·낙찰 승계 절차를 사용한다.
- DB 경로: `supabase/migrations/20260811120000_owner_cancel_pending_commerce_payment.sql`
- API 경로: `src/app/api/admin/operator/payments/[kind]/[id]/cancel/route.ts`
- UI 경로: `src/components/admin/operator/OperatorPaymentsConsole.tsx`
- 조치: 소유자 전용 RPC가 주문·입금 요청·상품을 잠그고 CAS(version)와 원장 누적액/건수를 재검증한다. `awaiting_transfer` + `awaiting_payment` + 원장 0원일 때만 `cancelled` 처리하며, 주문 항목을 취소하고 닫혀 있던 고정가 상품을 안전하게 `active`로 복구한다. 사유·actor·멱등 키·fingerprint·이전 상태는 append-only 취소 이벤트로 보존하고 구매자에게 알림을 남긴다.
- 보완: 취소된 `cancelled`/`cancelled_unpaid` 상태는 결제 큐 조회에서도 제외하여 취소 후 대기 목록에 재노출되지 않도록 했다. 경로: `src/app/api/admin/operator/payments/route.ts`.
- 추가 보완: 브라우저 `window.prompt/confirm` 의존을 제거하고 인페이지 취소 사유·확정 대화상자로 교체했다. 서버 계약과 동일하게 사유 3자 미만은 전송 전 차단한다. 경로: `src/components/admin/operator/OperatorPaymentsConsole.tsx`.
- 검증: 전체 core test 339개 중 333 pass, 6 skip; lint/build 통과; migration parity 161개. 인증 소유자 화면에서 3개 대기 행과 인페이지 `입금 요청 취소 확정` 흐름을 확인했으며 실제 취소 mutation은 실행하지 않았다. 대상 주문 `ff6df77e`에 대해 동일 RPC를 owner claim으로 호출한 뒤 transaction rollback하여 DB 상태 변화가 없음을 확인했다.

## 3. migration 적용 증거

- `supabase db push --linked --dry-run`: 현재 pending migration 없음.
- `supabase db push --linked --yes`: `20260811090000_reconcile_owner_operator_store_scope_mode.sql` 적용 완료.
- `supabase db push --linked --yes`: `20260811120000_owner_cancel_pending_commerce_payment.sql` 적용 완료.
- `npm run verify:migrations`: `PASS migration parity (161 linked migrations)`.
- Supabase CLI가 Docker catalog cache를 갱신하지 못했다는 경고가 있었으나 원격 migration 적용 자체는 완료되었다. 로컬 Docker 기반 reset 검증은 별도 환경 게이트로 남긴다.

## 4. 남은 실행 단계

1. 전체 core test, lint, TypeScript/production build 재실행. (완료: 339/333/6, lint/build 통과)
2. `KAKAO_OIDC_REDIRECT_URI`는 Vercel Production에 존재함을 확인하고, local verifier는 안전한 도메인 값 주입으로 재현한다.
3. 새 commit 생성 후 Vercel production 배포 완료. (완료: `c88c490`)
4. `/BUILD_ID`, 공개 URL, site-status redirect, `dami-shop` 200, 비인증 API 401을 확인 완료. (완료)
5. 실제 인증 세션에서 owner scope 선택은 재검증 완료했다. payment queue 12시간 필터, employee 업무, account member mode는 운영 데이터 보호를 위해 별도 세션 검증 대상으로 남긴다.
6. Vercel alias·BUILD_ID·migration parity·rollback 기준을 아래 배포 증거에 기록한다. (완료; 아래 owner payment 인증 smoke 포함)

## 5. 배포 증거

- 1차 production 배포: Vercel `dpl_5W1jKm4mZ9wF86s4V94W9siiT9QC`, alias `https://www.ninety-nine-vintage.store`, BUILD_ID `89d4933...` 확인.
- 최종 production 배포: Vercel `dpl_4vaQoK44LhPe5NF1tifaUAqFvMjf`, alias `https://www.ninety-nine-vintage.store`, 상태 `Ready`.
- 소유자 입금 확인 콘솔 배포: Vercel `dpl_GPysWuRVUHQSxTV7unfHX61dhgHt`, alias `https://www.ninety-nine-vintage.store`, 상태 `Ready`, 배포 커밋 `c88c490`.
- 소유자 미입금 취소 1차 배포: Vercel `dpl_2eQeqPCaq48CB39rf8tR8RmxZNft`, alias `https://www.ninety-nine-vintage.store`, 상태 `Ready`, 배포 커밋 `ef0bc81`.
- 최신 보완 배포: Vercel `dpl_6LzoSRKPDdSYJZmAXxeSHWbBWKkx`, alias `https://www.ninety-nine-vintage.store`, 상태 `Ready`, 배포 커밋 `5cc91ea`.
- 취소 UI 보완 배포: Vercel `dpl_A7wy8Z8cCpqt11Mj6PagtAmAYPjP`, alias `https://www.ninety-nine-vintage.store`, 상태 `Ready`, 배포 커밋 `f2eb9b4`.
- 최신 소유자 미입금 취소 도메인 BUILD_ID: `f2eb9b4` (Vercel CLI 배포 시 `VERCEL_GIT_COMMIT_SHA=f2eb9b4`을 런타임에 명시해 배포 커밋과 일치시킴).
- 최신 공개 smoke: `/home`, `/feed`, `/shop`, `/chat`, `/account`, `/cart`, `/stores/dami-shop`, 지정 owner/operator/employee URL 31개 모두 HTTP 200.
- 최신 비인증 API smoke: chat/cart/account/admin/cron/member-mode 지정 API 12개 모두 HTTP 401.
- owner payment 인증 smoke: `/admin/owner/payments` HTTP 200; 인증 세션 화면에 `소유자 / 입금 확인`, 현재 페이지 입금 대기 3건, 각 행의 `입금 확인 완료` 버튼이 표시됨. `/api/admin/owner/payment-confirmation-requests` 비인증 요청은 HTTP 401.
- owner payment browser console: 배포 후 인증 세션에서 오류·경고 로그 없음. 상세보기 버튼과 처리 버튼의 노출만 점검했으며 실제 입금 확정·금액 변경·원장 취소 mutation은 실행하지 않음.
- owner payment cancellation smoke: 인증 세션에서 `입금 요청 취소` 버튼 3건 표시 확인. 비인증 POST는 HTTP 403으로 차단되며 실제 취소 요청은 실행하지 않음.
- owner cancellation dialog smoke: 첫 번째 대기 행에서 native prompt 없이 `입금 요청 취소 확인` dialog와 `취소 사유` textbox, 3자 미만 확정 버튼 비활성 상태를 확인했으며 닫기로 종료했다.
- 최신 alias smoke: `/BUILD_ID` HTTP 200 및 `f2eb9b4`, `/admin/owner/payments` HTTP 200.
- `/admin/owner/site-status`: HTTP 404가 아니며, HTML 응답에 `/admin/owner` 307 redirect 신호가 포함됨.
- Vercel inspect: production target `Ready`, `https://www.ninety-nine-vintage.store` alias 연결 확인.
- rollback 기준: 직전 정상 deployment는 Vercel `dpl_2yD4xT3B43vaXfSdAyfamJVsjvUN`이며, 새 배포 이상 시 해당 deployment로 즉시 promote할 수 있다.

## 5. 판정 규칙

- 코드·문서만 완료된 상태는 목표 완료로 표시하지 않는다.
- 운영 배포 후 HTTP 404/500이 없고, BUILD_ID가 배포 커밋과 일치하며, migration parity가 0 pending일 때만 정상 배포 완료로 판정한다.
- 인증 역할별 업무 mutation은 운영 데이터 보호를 위해 별도 격리 증거가 없는 경우 “미검증”으로 명시한다.
