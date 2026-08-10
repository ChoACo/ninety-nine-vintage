# 포렌식 결과 1차

기준일: 2026-08-10 (Asia/Seoul)
상태: 승인 전 조사 결과 보존본

## 결론

현재 시스템은 정적 테스트·빌드·일부 Supabase read-only 연결은 통과했지만, 역할별 실제 업무·센터 범위·임시 회원 모드·Kakao callback·입금 확인 큐·외부 provider 종단 증거가 부족하다. 따라서 오류 없이 모든 기능을 자유롭게 운영할 수 있는 상태로 판정하지 않는다.

## 실제 확인 결과

- `npm run verify:migrations`: 157개 migration parity 통과
- `npm run verify:integrations`: Supabase products/stores/orders/payment schema/site_status/auction clock/manual transfer/Realtime 통과
- `verify:integrations` 실패: `KAKAO_OIDC_REDIRECT_URI` 누락
- `/admin/owner/site-status`: 404
- `/stores/dami-shop`: 500
- `operator_store_scope_required`, `store_scope_unavailable`, `member_required`, `member_mode_active`, `일시적인 오류` 경로가 코드에 존재

## 오류·충돌별 근거와 권장 조치

### 1. 운영자 센터 범위

경로:

- `src/lib/commerce/server.ts`
- `src/app/api/admin/operator/store-scope/route.ts`
- `src/store/useOperatorStoreScope.ts`
- `src/components/admin/operator/OperatorStoreScopeSelector.tsx`
- `supabase/migrations/20260809161500_require_expiring_operator_store_scope.sql`

문제: 센터 미선택·만료·membership 없음·RPC 장애·accessMode 불일치가 동일한 428/503 오류로 축약된다. 대부분의 운영자 API가 이 gate를 통과해야 하므로 한 오류가 상품·배송·채팅·정산 전체를 연쇄 차단할 수 있다.

권장: read-only로 사용자 role, membership, active scope, expiry, RPC 응답을 함께 캡처하고 원인별 오류 계약을 분리한다. 센터 재선택 후 token/session reload와 모든 API의 scope 전파를 확인한다.

완료 기준: owner support/operator assigned/employee assigned 각각에서 선택·만료·재선택·직접 URL·새로고침이 동일한 store scope로 동작한다.

### 2. 긴급 입금 확인

경로:

- `src/components/admin/owner/OwnerPaymentConfirmationQueue.tsx`
- `src/app/api/admin/owner/payment-confirmation-requests/route.ts`
- `supabase/migrations/*payment*`, `get_owner_payment_confirmation_queue` RPC

문제: UI 제목은 `12시간 이상 대기 요청`이지만 실제 cutoff를 UI에서 재검증하지 않는다. 경과시간 null/음수/시간대 오류 방어가 없다. 큐에는 입금 확인·정정·취소·재시도 동작이 없고 API 오류도 한 문자열로 합쳐진다.

권장: 운영 데이터 read-only로 `first_requested_at`, `last_requested_at`, `elapsed_seconds`, status, duplicate request를 대조한다. 12시간 조건을 RPC와 API response schema에서 고정하고, owner action route와 retry 계약을 확인한다.

완료 기준: 12시간 미만 행이 큐에 나타나지 않고, 확인·정정·취소·중복 요청·재알림이 CAS·멱등·감사 원장과 연결된다.

### 3. 임시 회원 모드

경로:

- `src/lib/commerce/server.ts`
- `src/lib/ownerMemberMode.server.ts`
- `src/components/features/auth/OwnerMemberModeProvider.tsx`
- `src/components/admin/owner/OwnerDashboard.tsx`
- `src/app/api/owner/member-mode/route.ts`

문제: owner mode state, bearer token, session revision, `member_accounts`가 서로 다른 시점에 판정된다. 활성 중 운영자 API는 `member_mode_active`, 비활성 중 회원 API는 `member_required`가 되어 화면 전환·새로고침 경계에서 충돌할 수 있다.

권장: 활성화 전·직후·만료·종료·두 탭 동시 사용을 격리 계정으로 검증한다. mode와 session의 authoritative source를 하나로 정하고 UI 전환 후 재인증·재조회 계약을 기록한다.

완료 기준: owner→member→owner 전환, 직접 URL, 새로고침, 만료가 오류 없이 정책에 맞게 차단·허용된다.

### 4. 입찰 회원 판정

경로:

- `src/components/features/auction/AuctionCard.tsx`
- `src/components/features/auction/detail/AuctionBidRoute.tsx`
- `src/components/mobile/MobileBidSheet.tsx`
- `src/app/api/auction/bids/route.ts`
- `src/lib/auction/*`, Kakao/member RLS migrations

문제: 클라이언트 `canStartBid`, 서버 bid RPC/RLS, Kakao identity, member account, self-store restriction이 동일 판정인지 운영 계정으로 검증되지 않았다. 취소 입찰·첫 입찰·자기 매장 상품 금지 경계가 여러 helper/migration에 분산돼 있다.

권장: guest/member/band member/operator/employee/owner 및 자기 매장·다른 매장 조합을 표로 테스트한다. 버튼 표시와 API 응답을 한 쌍으로 기록한다.

완료 기준: 모든 역할에서 버튼·직접 API·RPC 결과가 동일 정책을 표현한다.

### 5. 계정 부분 로딩

경로:

- `src/components/features/account/AccountDashboard.tsx`
- `src/app/api/account/addresses/route.ts`
- `src/app/api/account/bids/route.ts`
- `src/app/api/account/cancellations/route.ts`
- `src/app/api/account/refunds/route.ts`
- `src/app/api/account/shipments/route.ts`
- `src/app/api/account/storage/route.ts`
- `src/app/api/account/experience/route.ts`

문제: 여러 영역의 실패가 `일부 계정 정보를 불러오지 못했습니다`로 축약된다. 실패한 영역·재시도 대상·데이터 시점·인증/DB 원인이 표시되지 않는다.

권장: API별 상태를 분리하고 영역별 재시도·마지막 성공 시각·stale 여부를 기록한다. 주소·배송·환불·보관·찜·결제의 권한과 데이터 freshness를 독립 검증한다.

완료 기준: 한 API 장애가 다른 계정 메뉴를 가리지 않고, 사용자가 실패 영역만 재시도할 수 있다.

### 6. 공개 매장·공통 오류

경로:

- `src/app/(shop)/stores/[slug]/page.tsx`
- `src/app/(mobile)/m/stores/[slug]/page.tsx`
- `src/services/stores.ts`
- `src/app/error.tsx`

문제: `/stores/dami-shop`이 500이다. unknown/inactive slug와 Supabase 조회 장애가 구분되지 않는다. 공통 error boundary는 인증·정책·DB·서버 오류를 동일한 `다시 시도`로 표시한다.

권장: production log와 read-only store query를 상관분석하고 unknown slug는 404, backend failure는 추적 가능한 503으로 구분한다. error boundary에 route/error class/correlation evidence를 남긴다.

완료 기준: 공개 오류가 내부 상태를 노출하지 않으면서도 404/503/재시도 경로를 올바르게 구분한다.

### 7. 외부 연동

경로:

- Kakao: `src/app/api/auth/kakao/**`, `src/app/(shop)/auth/callback/page.tsx`, `src/lib/kakao/**`
- Supabase: `src/lib/supabase/**`, `supabase/migrations/**`
- Vercel: `vercel.json`, `package.json`, `next.config.ts`
- R2/Google Drive: `src/lib/storage/**`, `.env.example`
- AI: `src/lib/ai/**`
- Push: `src/app/api/push/**`, service worker
- Redis: rate-limit helpers, `UPSTASH_REDIS_*`

문제: Kakao redirect 환경값이 검증에서 누락됐고, Vercel cron·R2/Drive canary·Push·AI·Redis·배송 provider의 실제 운영 증거가 없다. `.env.example` 명칭과 실제 멀티스토리지 코드 명칭도 다르다.

권장: provider별 자격·health·실패·rollback을 독립 기록하고, 운영 비밀값은 노출 없이 presence만 검증한다.

완료 기준: 각 provider의 성공·실패·재시도·장애 격리·rollback 증거가 있다.

## 수정 승인 후 순서

0. 증거 고정 → 1. 404/500 및 진입점 → 2. 역할·scope·member mode → 3. 업무 종단 → 4. 외부 연동 → 5. 계약·문서 정리 → 6. 회귀·승인·배포
