# 전체 포렌식 조치·배포 실행 기록

기준일: 2026-08-10 (Asia/Seoul)
범위: 전체 포렌식 결과에 대한 코드·DB 조치와 최종 배포 게이트

## 1. 기준선

- 목표 기준: `C:\Users\rlaal\.codex\attachments\5fbbdcf4-5e64-4f3d-9be3-241ea6e11a76\goal-objective.md`
- 저장소: `C:\Users\rlaal\Documents\Codex\ninety-nine-homepage`
- 기준 커밋: `ce65024 docs: record second forensic operating evidence`
- 기준 포렌식 문서: `docs/full-system-forensic-audit-20260810.md`, `docs/forensic-result-1-20260810.md`, `docs/forensic-result-2-20260810.md`
- 기준 테스트: core 335개 중 329 pass, 6 skip; lint/build 통과; migration parity 157개
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

## 3. migration 적용 증거

- `supabase db push --linked --dry-run`: 두 migration만 pending으로 확인.
- `supabase db push --linked --yes`: 두 migration 적용 완료.
- `npm run verify:migrations`: `PASS migration parity (159 linked migrations)`.
- Supabase CLI가 Docker catalog cache를 갱신하지 못했다는 경고가 있었으나 원격 migration 적용 자체는 완료되었다. 로컬 Docker 기반 reset 검증은 별도 환경 게이트로 남긴다.

## 4. 남은 실행 단계

1. 전체 core test, lint, TypeScript/production build 재실행.
2. `KAKAO_OIDC_REDIRECT_URI`는 Vercel Production에 존재함을 확인하고, local verifier는 안전한 도메인 값 주입으로 재현한다.
3. 새 commit 생성 후 Vercel production 배포 완료.
4. `/BUILD_ID`, 공개 URL, site-status redirect, `dami-shop` 200, 비인증 API 401을 확인 완료.
5. 실제 인증 세션에서 owner scope 선택, payment queue 12시간 필터, employee 업무, account member mode는 운영 데이터 보호를 위해 별도 세션 검증 대상으로 남긴다.
6. Vercel alias·BUILD_ID·migration parity·rollback 기준을 아래 배포 증거에 기록한다.

## 5. 배포 증거

- 1차 production 배포: Vercel `dpl_5W1jKm4mZ9wF86s4V94W9siiT9QC`, alias `https://www.ninety-nine-vintage.store`, BUILD_ID `89d4933...` 확인.
- 최종 production 배포: Vercel `dpl_BvFcdzvip6gZwakBYFKLQsGsbgnh`, alias `https://www.ninety-nine-vintage.store`, 상태 `Ready`.
- 최신 도메인 BUILD_ID: `6237fdfc3250c11b5dda957fc10980d1f3a0fa05` (커밋 `6237fdfc` 일치).
- 최신 공개 smoke: `/home`, `/feed`, `/shop`, `/chat`, `/account`, `/cart`, `/stores/dami-shop`, 지정 owner/operator/employee URL 31개 모두 HTTP 200.
- 최신 비인증 API smoke: chat/cart/account/admin/cron/member-mode 지정 API 12개 모두 HTTP 401.
- `/admin/owner/site-status`: HTTP 404가 아니며, HTML 응답에 `/admin/owner` 307 redirect 신호가 포함됨.
- Vercel inspect: production target `Ready`, `https://www.ninety-nine-vintage.store` alias 연결 확인.
- rollback 기준: 직전 정상 deployment는 Vercel `dpl_JB1azGkznAXveH61CKx5PDcxBiaD`이며, 새 배포 이상 시 해당 deployment로 즉시 promote할 수 있다.

## 5. 판정 규칙

- 코드·문서만 완료된 상태는 목표 완료로 표시하지 않는다.
- 운영 배포 후 HTTP 404/500이 없고, BUILD_ID가 배포 커밋과 일치하며, migration parity가 0 pending일 때만 정상 배포 완료로 판정한다.
- 인증 역할별 업무 mutation은 운영 데이터 보호를 위해 별도 격리 증거가 없는 경우 “미검증”으로 명시한다.
