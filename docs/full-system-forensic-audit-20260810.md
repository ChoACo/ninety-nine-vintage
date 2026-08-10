# 전체 시스템 포렌식 검증 보고서

기준일: 2026-08-10 (Asia/Seoul)
범위: `C:\Users\rlaal\Documents\Codex\ninety-nine-homepage` 전체 폴더·파일·코드·DB migration·외부 연동
상태: 승인 전 조사·문서화. 코드 수정·DB mutation·배포 없음.

## 1. 판정 기준

“정상 운영 가능”은 단순히 빌드·정적 테스트가 통과한 상태가 아니다. 아래 모든 검사 단위에서 실제 사용자가 역할에 맞게 로그인하고, 페이지·버튼·API·DB/RPC·외부 시스템이 동일한 정책과 상태를 끝까지 연결해야 한다.

- 정상: 실제 역할 계정으로 성공·실패·재시도·새로고침까지 확인됨
- 부분 운영: 일부 경로만 동작하거나 데이터·권한·외부 연동 증거가 빠짐
- 운영 불가: 핵심 업무가 오류·충돌·잘못된 권한·죽은 진입점으로 중단됨
- 미확정: 코드 계약은 있으나 운영 DB·실제 계정·외부 시스템 결과가 없음

현재 전체 시스템은 **정상 운영 가능으로 판정할 수 없다**. 정적 계약과 일부 read-only 연결은 통과했지만, 역할별 실제 업무와 외부 Kakao·운영 데이터·scope·입금 큐의 종단 증거가 부족하다.

## 2. 저장소·검증 기준선

- Git branch: `codex/center-commerce-rebuild`
- 현재 HEAD: `5eed426 docs: add full route integrity audit`
- 파일 수: 전체 739, `src` 396, `supabase` 159, `tests` 119
- 작업 트리: 감사 시작 시 clean 확인
- `npm run verify:migrations`: 157개 migration parity 통과
- `npm run verify:integrations`: Supabase products/stores/orders/payment schema/site_status/auction clock/manual transfer/Reatime 통과, Kakao OIDC redirect 누락으로 실패
- 이전 기준선: core test 329 pass, 6 skip; lint·TypeScript·production build 통과. 이는 실제 업무 정상 동작을 증명하지 않는다.

## 3. 사용자 제보 오류의 발생 경로

### 3.1 `operator_store_scope_required` / `센터를 다시 선택해 주세요.`

- 발생 코드: `src/lib/commerce/server.ts:250-283`
- 호출 경로: `src/app/api/admin/operator/*` 대부분 → `authenticateOperatorStoreRequest()` → Supabase RPC `require_active_operator_store_scope`
- 보조 UI: `src/components/admin/operator/OperatorStoreScopeSelector.tsx`, `src/store/useOperatorStoreScope.ts`
- DB 계약: `supabase/migrations/20260809161500_require_expiring_operator_store_scope.sql`
- 의미: selected store scope가 없거나 만료됐거나 RPC가 오류/비문자열을 반환할 때 API가 428 또는 503을 반환한다.
- 문제 후보:
  - 센터 선택 UI의 `load()`가 503이면 실제 센터 목록과 오류 원인이 동일한 문구로 뭉개진다.
  - `select()` 성공 뒤 `window.location.reload()`를 사용해 모든 API·세션·서버 캐시가 새 scope를 반영한다는 전제가 있다.
  - owner support와 operator assigned 모드가 `expectedMode`로 분기되지만, role·membership·scope RPC 데이터가 한 번이라도 어긋나면 전체 운영자 화면이 중단된다.
  - 직원은 `allowEmployee` overload로 scope를 우회하지만 직원 API와 운영자 API가 서로 다른 범위 계약을 사용해 동일 화면에서 혼합 오류가 날 수 있다.

### 3.2 `store_scope_unavailable`

- 발생 코드: `src/app/api/admin/operator/store-scope/route.ts:39-94`
- 원인 후보: `get_operator_store_scope` RPC, membership 조회, stores 조회, accessMode 불일치가 모두 503으로 변환된다.
- 현재 코드 부족: DB 연결 실패, membership 없음, scope 만료, mode 불일치를 서로 구분하지 않아 운영자가 무엇을 고쳐야 하는지 알 수 없다.
- 확인 필요: 실제 응답 body·Vercel function log·Supabase RPC log·해당 사용자 membership을 read-only로 상관분석해야 한다.

### 3.3 `긴급 입금 확인` / `12시간 이상 대기 요청 1건`

- UI: `src/components/admin/owner/OwnerPaymentConfirmationQueue.tsx:39-67`
- API: `src/app/api/admin/owner/payment-confirmation-requests/route.ts`
- DB/RPC: `get_owner_payment_confirmation_queue`가 포함된 payment confirmation migration 및 payment ledger migrations
- 현재 구현:
  - 제목은 `requests.length`만 표시한다.
  - `elapsed_seconds`를 화면에서 계산해 시간으로 표시한다.
  - API 오류는 한 개 문자열로 표시하며 재시도 버튼이 없다.
- 문제 후보:
  - RPC가 이미 12시간 이상 조건을 적용하는지, UI가 다시 검증하지 않는다. RPC가 잘못된 행을 반환하면 라벨이 거짓이 된다.
  - 첫 요청·마지막 요청·재알림 횟수는 보이지만 실제 입금 확인·확인 취소·정정 버튼은 이 큐에 없다. 사용자는 “긴급 확인”을 봐도 다음 업무로 이동해야 한다.
  - `elapsed_seconds`가 null·음수·시간대 변환 오류일 때 잘못된 시간 표시가 가능하다.
  - owner API 인증 실패, service role read 실패, RPC schema mismatch가 모두 일반 오류로 합쳐진다.
  - 사용자 제보의 `2시간 경과`와 “12시간 이상” 제목이 동시에 나타난다면 RPC cutoff 또는 표시 계약이 실제 데이터와 어긋난 것이다. 반드시 운영 read-only 데이터로 확정해야 한다.

### 3.4 `소유자 센터에서 임시 회원 권한을 활성화해 주세요.`

- 발생 코드: `src/lib/commerce/server.ts:52-138`, `src/components/features/auth/OwnerMemberModeProvider.tsx`, `src/components/admin/owner/OwnerDashboard.tsx:80-103`
- 대상: 임시 소유자 계정 `TEMPORARY_MEMBER_OWNER_ID`가 회원 전용 API·카트·채팅·계정에 접근할 때
- 문제 후보:
  - 임시 권한은 3분 상태를 별도 server state로 유지하지만, session token·member_accounts·owner mode state가 갱신되는 순서가 API마다 다르다.
  - 활성화 성공 후 `/home`으로 이동하지만, 기존 탭의 bearer token·session revision·server cookie가 새 상태를 즉시 반영한다는 보장이 없다.
  - 회원 모드가 활성인데 운영자 API를 호출하면 `member_mode_active`가 되고, 비활성인데 회원 API를 호출하면 `member_required`가 된다. 화면 전환·새로고침 경계에서 사용자에게 정책 오류가 아니라 일시 오류로 보일 수 있다.

### 3.5 `현재 로그인한 계정은 경매 입찰용 회원 계정이 아닙니다.`

- UI: `src/components/features/auction/AuctionCard.tsx`, `src/components/features/auction/detail/AuctionBidRoute.tsx`, `src/components/mobile/MobileBidSheet.tsx`
- 서버: `src/app/api/auction/bids/route.ts`, bid policy helpers, Kakao/member RLS migrations
- 문제 후보:
  - owner/operator/employee가 구매자 모드로 전환되지 않은 상태에서 bid UI를 보면 의도된 차단인지, 잘못된 account role 판정인지 구분되지 않는다.
  - 클라이언트 `canStartBid`와 서버 RPC/RLS의 Kakao identity·member account·self-store restriction이 동일한 판정 함수를 사용하지 않으면 버튼 표시와 실제 응답이 충돌한다.
  - 취소 입찰·첫 입찰·self-store 금지 정책은 별도 helper와 migration에 흩어져 있어 경계 테스트가 필요하다.

### 3.6 `일부 계정 정보를 불러오지 못했습니다. 다른 메뉴는 계속 이용할 수 있습니다.`

- UI: `src/components/features/account/AccountDashboard.tsx`
- API: `src/app/api/account/addresses`, `bids`, `cancellations`, `refunds`, `shipments`, `storage`, `experience`
- 문제 후보:
  - 여러 Promise를 부분 허용으로 렌더링해 일부 API 실패가 사용자에게 “계속 이용 가능”으로 축소된다.
  - 어떤 영역이 실패했는지·재시도할 API·데이터의 최신 시점이 표시되지 않는다.
  - 계정 dashboard가 주소·배송·환불·찜·보관·결제 상태를 한 파일에서 관리해 session revision과 loading/error state가 섹션마다 다를 가능성이 높다.

### 3.7 `일시적인 오류가 발생했습니다` / `다시 시도`

- 공통 UI: `src/app/error.tsx:16-29`
- 여러 server page와 API에서 예외가 이 boundary로 전파된다.
- 문제 후보:
  - 인증 실패, scope 만료, DB schema 오류, 실제 서버 장애, 정책 차단이 모두 동일한 오류 화면으로 보인다.
  - `reset()`은 같은 요청을 다시 실행할 뿐 stale session·만료 scope·잘못된 URL·데이터 오류를 해결하지 않는다.
  - 오류 ID, route, correlation ID, 복구 방법이 없어 운영자가 원인을 연결할 수 없다.

## 4. 검사 단위별 전체 판정

### A. 인증·세션·역할

대상: `src/lib/commerce/server.ts`, `src/lib/ownerAccess/server.ts`, `src/lib/supabase/*`, `src/components/features/auth/*`, Kakao routes, 관련 auth migrations.

판정: **부분 운영**. Bearer 검증·origin check·role/RLS 계약은 존재하지만 owner/operator/employee/member mode가 서로 다른 helper와 session 패턴을 사용한다. Kakao redirect 환경값이 검사에서 누락되어 실제 로그인 종단이 미확정이다.

### B. 소유자 업무

대상: `src/app/(admin)/admin/owner/**`, `src/components/admin/owner/**`, `/api/admin/owner/**`, owner migrations.

판정: **운영 불가 후보**. 입금 큐는 데이터와 시간 cutoff가 맞지 않을 수 있고, 계좌·환불·매장·회원 mutation은 owner RPC/CAS 증거가 실제 역할 계정으로 확인되지 않았다. `/admin/owner/site-status`는 404다.

### C. 운영자·직원 store scope

대상: `src/app/(admin)/admin/operator/**`, `src/app/(admin)/admin/employee/**`, `OperatorStoreScopeSelector`, `useOperatorStoreScope`, operator APIs, scope migrations.

판정: **운영 불가 후보**. scope가 없거나 만료되면 대부분의 화면이 연쇄적으로 차단되며, `store_scope_unavailable`의 원인 구분이 없다. 직원 예외 overload와 operator scope API가 서로 다른 계약을 사용한다.

### D. 상품·피드·즉시구매

대상: `src/components/features/auction/**`, `src/services/products.ts`, `/api/products`, `/api/cart`, checkout/order routes, catalog migrations.

판정: **부분 운영**. 정적 계약과 카트 CAS는 강하지만 SSR/client loader, fixed/auction URL, self-store bidding, stale product, payment mode, shipping quote의 종단 연결은 실제 계정·상품·점유 데이터가 필요하다.

### E. 채팅·입점 상담·알림

대상: `src/components/features/chat/**`, `OperatorChatConsole`, `OnboardingChatPanel`, `/api/chat/**`, `/api/onboarding-chat`, support migrations, notification providers.

판정: **부분 운영**. 일반/product/internal/onboarding 채널 분리는 있으나 담당 매장·직원·owner 상담의 실제 routing과 Realtime reconnect·read receipt·중복 nonce를 역할별로 확인하지 않았다.

### F. 카트·주문·수동 입금·환불·정산

대상: `src/components/features/commerce/**`, owner/operator consoles, `/api/cart`, `/api/orders/**`, `/api/payments/manual-transfer`, payment/ledger/settlement migrations.

판정: **미확정·고위험**. ledger/CAS/idempotency 계약은 정적 존재하지만 실제 운영 데이터 mutation을 실행하지 않았고, PortOne 역사 migration과 문서·환경 변수도 잔존한다.

### G. 저장소·이미지·AI·푸시·배송 외부 연동

대상: `src/lib/storage/**`, `src/lib/images/**`, `src/lib/ai/**`, push routes/service worker, Hanjin lookup, R2/Google Drive adapters, `.env.example`, Vercel config.

판정: **부분 운영·외부 증거 부족**. Supabase read-only와 Realtime은 통과했지만 R2/Google Drive canary, VAPID push, Gemini/OpenRouter, Kakao callback, 실제 배송 조회·삭제·복구는 모두 별도 증거가 필요하다.

## 5. 외부 연동 포렌식 결과

### Supabase

- 확인: products, stores, commerce orders, payment schema, order items, site_status, auction clock RPC, manual transfer RPC, Realtime 연결, migration parity 157개.
- 미확인: production RLS role matrix, active scope rows, payment confirmation queue rows, owner mode state, actual webhook/cron execution, mutation rollback.

### Kakao

- 코드: `src/app/api/auth/kakao/**`, `src/app/(shop)/auth/callback/page.tsx`, `src/lib/kakao/**`.
- 검증 실패: `KAKAO_OIDC_REDIRECT_URI`가 local environment에서 누락.
- 영향: 로그인 시작·callback·profile·session 완료까지 운영 URL 기준 종단 보장 없음.

### Vercel

- 코드: `vercel.json`, `package.json` deploy script, `next.config.ts`.
- 확인 필요: 운영 환경 변수 완전성, production build commit, function logs, cron schedule, region, rollback version.

### R2·Google Drive·Cloudflare

- 코드/환경: `.env.example`, `src/lib/storage/**`, `R2_*`, `GOOGLE_DRIVE_*`, `CLOUDFLARE_API_TOKEN`.
- 미확인: 실제 자격증명, canary byte write/read/delete, rollback timestamp, 용량 gauge, provider switch, 삭제 후 DB locator 정합성.

### AI·Push·Redis

- AI: `src/lib/ai/**`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`; 모델 fallback·quota·네트워크 장애 실제 호출 미확인.
- Push: `src/app/api/push/**`, service worker, VAPID env; 구독·만료·백그라운드·실패 outbox 실제 확인 미확인.
- Redis: `UPSTASH_REDIS_REST_URL/TOKEN`; rate limit은 코드 계약만 있고 production key/latency/fail-open 동작 미확인.

## 6. 코드·설정 충돌 및 부족한 연결

1. ~~`.env.example`의 `MULTICLOUD_GCS_CAPACITY_BYTES`/`MULTICLOUD_S3_CAPACITY_BYTES`와 검증·코드의 R2/Google Drive 명칭이 일치하지 않는다.~~ → 현재 `.env.example`은 `MULTICLOUD_R2_CAPACITY_BYTES`/`MULTICLOUD_GOOGLE_DRIVE_CAPACITY_BYTES`로 정렬되어 확인됨.
2. ~~`README.md`는 PortOne을 “향후 재검토용 비활성 어댑터”로 설명하지만 목표 정책은 실행 경로 폐기·역사 읽기 보존이다.~~ → README를 실행 경로 폐기·역사 읽기 보존으로 정정함.
3. `.env.example`에는 PortOne 환경변수가 남아 있어 폐기된 실행 경로와 운영 설정의 경계가 불명확하다.
4. `vercel.json`은 storage-lifecycle cron만 선언한다. payment escalation, subscription accrual, push dispatch, cleanup의 실제 scheduler·secret·실행 증거가 분리되어 있다.
5. ~~`site-status`는 API/panel은 있으나 page route가 없다.~~ → `src/app/(admin)/admin/owner/site-status/page.tsx`에서 owner dashboard로 redirect하는 유효한 진입점을 추가함.
6. error boundary는 모든 서버·정책·인증 오류를 동일한 재시도 화면으로 합친다.
7. 운영자 scope API가 access mode·membership·store read 오류를 모두 `store_scope_unavailable`로 축약한다.
8. ~~OwnerPaymentConfirmationQueue는 확인·취소·정정 동작과 재시도 연결이 없다.~~ → 현재 범위의 조회 오류에는 재시도 버튼을 추가하고, 12시간 cutoff는 DB RPC로 강제함. 확인·정정 mutation은 별도 승인 범위로 남김.
9. 실제 운영 mutation을 검증할 격리 test account와 seed contract는 있으나 production role QA 증거가 없다.

## 7. 승인 후 단계별 조치 계획

### 0단계 — 증거 고정

Vercel deployment/logs, Supabase read-only query, role account IDs, environment variable presence, Kakao redirect, cron invocations, external provider health를 캡처한다. 운영 데이터 mutation은 금지한다.

### 1단계 — 차단 오류와 진입점

`/stores/[slug]` 500 원인을 확정하고 404/503 계약을 분리한다. `/admin/owner/site-status`는 복구 또는 제거를 결정한다. error boundary에 route/error class/correlation evidence를 남길지 설계한다.

### 2단계 — 역할·scope·member mode

owner/operator/employee/member 각 계정의 로그인→새로고침→직접 URL→센터 선택→만료→재선택을 반복한다. 모든 API의 role, selected store, employee assignment, temporary member mode가 동일한 결과를 내는지 표로 만든다.

### 3단계 — 업무별 종단 검증

상품 등록·공개·노출, 고정가 카트, 경매 입찰, 결제 원장, 긴급 입금 요청, 배송·보관, 채팅, 취소·환불, 정산을 격리 데이터로 순서대로 검증한다. 버튼별 loading/disabled/success/failure/retry를 기록한다.

### 4단계 — 외부 시스템

Kakao callback, Supabase RLS/Realtime, Vercel cron/logs, Redis rate limit, AI fallback, push, R2/Google Drive canary, 배송 조회를 provider별로 독립 검증한다.

### 5단계 — 계약 정리

오류 코드 표준화, scope 원인 세분화, session hook 통일, API response schema, stale/retry/idempotency contract, 문서·환경 변수·migration 명칭을 정리한다.

### 6단계 — 승인·회귀·배포

사용자 승인 후에만 코드/DB 변경을 하고, core test·lint·TypeScript·build·migration parity·role browser QA·외부 smoke test·rollback을 통과한 뒤 배포한다.

## 8. 승인 전 결론

현재 시스템은 정책·보안 관련 정적 계약이 많이 구현되어 있지만, 사용자가 제시한 오류처럼 핵심 운영 업무가 scope·member mode·Kakao callback·입금 큐·부분 계정 로딩에서 끊길 가능성이 확인되었다. 따라서 “모든 페이지와 시스템을 자유롭게 운영 가능한 상태”가 아니다. 위 단계 0~2의 증거 확보와 차단 오류 확정 없이는 수정 범위나 배포를 승인할 수 없다.
