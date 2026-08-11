# 증거 색인

## 원칙

비밀값, access token, 쿠키, 개인식별정보는 수집하지 않았다. 운영 DB는 집계와 grant만 읽었다. Chrome 증거는 2026-08-11 KST Production alias 기준이며, stale 인증 context가 섞인 결과는 별도 표기한다.

## Git·빌드·배포

| ID | 증거 | 결과 |
| --- | --- | --- |
| GIT-01 | `git status`, `git rev-parse`, `git push` | clean, `5a03bb5...`, 원격 일치 |
| TEST-01 | `npm test` | 333 pass, 6 skip, 0 fail |
| TEST-02 | ESLint, `tsc --noEmit`, production build | 모두 통과, 123 static pages |
| DB-01 | migration parity, linked dry-run | 161개 일치, pending 0 |
| DEP-01 | Vercel deploy/inspect | `dpl_7xuo...`, Ready, Production aliases |
| DEP-02 | `/BUILD_ID` | 전체 SHA `5a03bb...` 일치 |
| DEP-03 | 이전 Ready deployment | `dpl_A7wy...` / `f2eb9b4`, rollback 기준 |
| OBS-01 | Vercel logs CLI | HTTP 400, 운영 관측성 미확정 |

## Chrome·HTTP

| ID | 대상 | 결과 |
| --- | --- | --- |
| CH-01 | `/`, `/home` | redirect/200, 공개 렌더 |
| CH-02 | `/feed` | 200; stale auth에서 clock RPC 401 |
| CH-03 | `/shop` | React hydration error #418 1회 확정 재현 |
| CH-04 | `/sold` | 200 빈 상태 |
| CH-05 | `/sold/[id]` | 정상 200, invalid/없는 ID 404 |
| CH-06 | `/sold/brand/vintage` | desktop 404 |
| CH-07 | `/stores/dami-shop` | 200 |
| CH-08 | `/auction/a4f2966f-0823-470d-8efa-ac5fca78a7f2` | fixed 상품 detail 200 |
| CH-09 | 위 fixed 상품 `/bid` | desktop hard 404 |
| CH-10 | desktop policy pages | 200, governance note |
| CH-11 | `/operator`, `/owner` | canonical admin route redirect |
| CH-M01 | `/m`, `/m/home` | redirect/200 |
| CH-M02 | `/m/feed`, `/m/shop` | 200, stale auth 401 requests 동반 |
| CH-M03 | `/m/sold`, `/m/sold/[id]` | empty 200, invalid ID 404 |
| CH-M04 | `/m/sold/brand/vintage` | 200 빈 화면 |
| CH-M05 | `/m/stores/dami-shop` | 200 |
| CH-M06 | mobile fixed product detail | 200 |
| CH-M07 | mobile fixed product bid | document 200 soft-404 |
| CH-M08 | `/m/bidding` | raw `unauthorized` 표시 |
| CH-M09 | mobile policy pages | 200 |
| NET-01 | browser Network | account/cart/chat/notification/admin 및 clock RPC 401 다발 |
| HTTP-01 | 97 API route 무인증 GET smoke | public 200 2개, protected 401 54개, 405 5개, local-only 404 1개, invalid 400 1개; 34개 수집기 오류 제외 |

## 인증·역할

| ID | 범위 | 상태 |
| --- | --- | --- |
| AUTH-01 | guest/member browser | local persisted session과 server 401 불일치 확정; 정상 member `PRODUCTION_UNVERIFIED_AUTH_SESSION` |
| AUTH-02 | operator browser | audit context 401, role 기능 `PRODUCTION_UNVERIFIED_AUTH_SESSION` |
| AUTH-03 | employee browser | 별도 정상 세션 미확보, `PRODUCTION_UNVERIFIED_AUTH_SESSION` |
| AUTH-04 | owner browser | 기존 탭도 navigation 뒤 API 401, role 기능 `PRODUCTION_UNVERIFIED_AUTH_SESSION` |

## 코드 연결 증거

| ID | 연결 | 판정 |
| --- | --- | --- |
| CODE-01 | `AuctionFeedGrid` → random UUID seed → initial sort | SSR/client 비결정성, CH-03 원인 |
| CODE-02 | desktop sold brand `fetchSoldBrands()+notFound`; mobile 검증 없음 | status 계약 불일치 |
| CODE-03 | mobile checkout `productId` 없으면 `notFound()` | direct-entry 404는 의도 계약 |
| CODE-04 | Next parallel/intercepted modal 3개 | URL 독립 페이지 수에는 포함되지만 navigation 상호작용 계약 |
| CODE-05 | `useSupabaseSession` → `getSession()` → providers/private fetch | server validation 부재, AUTH-01/NET-01 원인 |
| CODE-06 | `useAuctionPolicyClock` → shared authenticated browser client → public RPC | invalid Bearer가 public clock까지 오염 |

## Supabase·외부 연동

| ID | 검사 | 결과 |
| --- | --- | --- |
| DB-02 | role/store/support aggregate | owner 1, operator 2, employee 1, member 13; active store 2; open store-scoped conversation 1 |
| DB-03 | clock function grants | anon/authenticated/service_role/postgres |
| INT-01 | public integration verifier | products, stores, commerce orders, clock RPC 200; realtime subscribed |
| INT-02 | Kakao Auth | env 이름 존재, 실제 login/callback `PRODUCTION_UNVERIFIED_AUTH_SESSION` |
| INT-03 | Supabase Storage/Google Drive/R2 | Supabase·Drive env 존재; R2 runtime use `PRODUCTION_UNVERIFIED` |
| INT-04 | web push/AI/cron | env 또는 code 존재; 실제 상태 변경/스케줄 `MUTATION_UNEXECUTED` 또는 `PRODUCTION_UNVERIFIED` |

## 상태 변경 증거

| ID | 흐름 | 상태 |
| --- | --- | --- |
| MUT-01 | 구매·checkout·수동 입금 요청 | `MUTATION_UNEXECUTED` |
| MUT-02 | 입금 확인·취소·환불 | `MUTATION_UNEXECUTED` |
| MUT-03 | 출고·센터/그룹 송장·배송 | `MUTATION_UNEXECUTED` |
| MUT-04 | 상품 등록·공개·중지·즉시마감 | `MUTATION_UNEXECUTED` |
| MUT-05 | 채팅 송수신·읽음·push | `MUTATION_UNEXECUTED` |
| MUT-06 | local Supabase 전체 흐름 | Docker Desktop 미실행 `BLOCKED_LOCAL_DOCKER` |

## 재현 시 주의

- Chrome의 non-HTML resource 직접 탭 차단과 API 수집기 status 0은 도구 한계이며 운영 장애로 사용하지 않는다.
- `/auth/callback` 직접 진입과 세션 401의 인과는 확정하지 않았다. 애플리케이션 callback logout 결함으로 단정하지 않는다.
- DB 2 active stores와 open conversation은 read-only로 확인했으므로 `/chat`의 빈 상태는 데이터 부재 증거가 아니라 인증 context 증거다.
