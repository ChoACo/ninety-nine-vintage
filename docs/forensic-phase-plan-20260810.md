# 포렌식 단계별 실행·기록 계획

이 문서는 `포렌식 결과 1차` 이후 실제 조치를 기록할 빈 기준표다. 각 단계는 사용자 승인 전에는 조사·read-only 증거만 수행한다.

## 0단계 — 증거 고정

대상 경로: `vercel.json`, `.env.example`, `scripts/verify-integrations.mjs`, `scripts/verify-migration-parity.mjs`, `docs/full-system-forensic-audit-20260810.md`.

기록할 항목: Git commit/deployment, Vercel logs, Supabase project/migration parity, role account IDs, env presence, Kakao redirect, cron invocations, provider health.

완료 산출물: 시간·대상·응답·로그 ID가 포함된 read-only evidence table.

## 1단계 — 차단 오류·죽은 진입점

대상 경로: `src/app/(shop)/stores/[slug]/page.tsx`, `src/services/stores.ts`, `src/app/(admin)/admin/owner/layout.tsx`, `src/app/api/admin/owner/site-status/route.ts`, `src/app/error.tsx`.

확인: `/stores/dami-shop` 500 원인, unknown slug 404, store DB failure 503, `/admin/owner/site-status` 의도, 공통 오류 분류.

완료 기준: 공개·관리자 사용자가 잘못된 URL과 backend 장애를 올바르게 구분한다.

## 2단계 — 역할·scope·임시 회원

대상 경로: `src/lib/commerce/server.ts`, `src/store/useOperatorStoreScope.ts`, `src/components/admin/operator/OperatorStoreScopeSelector.tsx`, `src/lib/ownerMemberMode.server.ts`, `src/components/features/auth/OwnerMemberModeProvider.tsx`, `/api/admin/operator/store-scope`, `/api/owner/member-mode`.

확인: owner support, operator assigned, employee assigned, temporary member의 로그인·직접 URL·센터 선택·만료·재선택·새로고침·두 탭 경합.

완료 기준: role/scope/mode가 모든 API와 UI에서 한 계약으로 판정된다.

## 3단계 — 업무 종단

검사 순서와 대상:

1. 상품 등록·수정·공개: `OperatorProductsConsole.tsx`, `/api/admin/operator/products/**`, product migrations
2. feed/shop 노출: `AuctionFeedGrid.tsx`, `AuctionCard.tsx`, `/api/products`, `/api/cart`
3. 카트·checkout: `CartView.tsx`, `/api/cart`, `/api/orders/**`, manual transfer RPC
4. 입금 확인: `OwnerPaymentConfirmationQueue.tsx`, owner payment APIs, ledger migrations
5. 보관·배송: operator/employee fulfillment/shipping components and APIs
6. 채팅·문의: `ChatPanel.tsx`, `OperatorChatConsole.tsx`, `OnboardingChatPanel.tsx`, chat APIs/RPCs
7. 취소·환불·정산: account/owner/operator consoles, cancellation/refund/settlement APIs/RPCs

각 단계에서 버튼의 loading, disabled, success, failure, retry, duplicate click, stale session, refresh 결과를 기록한다.

## 4단계 — 외부 연동

대상: Kakao OIDC, Supabase Auth/REST/RPC/Realtime, Vercel build/cron/logs, Upstash Redis, Gemini/OpenRouter, Web Push, Supabase Storage/R2/Google Drive, 배송 조회 provider.

완료 기준: provider별 자격 presence, health, timeout, retry, fail-closed/fail-open 정책, rollback 증거가 있다.

## 5단계 — 계약·문서 정리

대상 문서·설정: `README.md`, `.env.example`, `package.json`, `vercel.json`, `docs/project-master-20260810.md`, `docs/policy-deviation-forensic-report-20260810.md`, ordered migrations.

확인: PortOne 폐기 문구, env 명칭, cron 목록, 오류 코드·HTTP status·UI 문구, legacy compatibility 경계가 서로 일치하는지 확인한다.

## 6단계 — 승인·회귀·배포

사용자 승인 후에만 코드·DB·환경을 변경한다. core test, lint, TypeScript, build, migration parity, role Chrome QA, provider smoke, rollback 확인을 완료하고 배포한다.
