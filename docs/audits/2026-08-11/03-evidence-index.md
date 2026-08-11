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

## 2차 수정·검증 증거

| ID | 증거 | 결과 |
| --- | --- | --- |
| FIX-01 | `306f618`, `86740a1` | server-validated session, anonymous public clock, deterministic hydration, invalid-session dedupe |
| FIX-02 | `4eebce4` | mobile 오류 복구 문구와 desktop/mobile hard-404 계약 |
| TEST-R01 | 최종 core/lint/tsc/build | 340개 중 334 pass, 정책상 retired PortOne 6 skip, 실패 0; lint/tsc/build 통과; 123 static pages |
| TEST-R02 | dependency 검사 | ESLint tree valid, `npm audit` 0 |
| DB-R01 | local Supabase 161 migration reset 후 7개 suite | central fulfillment, intake/concurrency, store membership, published products, queue snapshot/concurrency, reversal target/concurrency, canonical shipment/retired writer/legacy compat 모두 통과 |
| ROLE-01 | local Chrome member | `/account` private sections 렌더, `roleCode=member`; owner/operator API 403 |
| ROLE-02 | local Chrome operator | scope 전 428, 본인 매장 선택 후 상품 2개 렌더, operator session 200 |
| ROLE-03 | local Chrome employee | `/admin/employee` 업무 메뉴 렌더, owner API 403 |
| ROLE-04 | local Chrome owner | `/admin/owner` 렌더, 수동 계좌이체/매장 2개/감사 기록, owner overview 200 |
| ROLE-05 | cross-store direct API | operator-secondary가 operator-primary 매장을 `assigned`로 선택 시 403 |
| MUT-R01 | local happy path/browser verifier | fixed 상품 API/detail/cart, anonymous 401, retired payment sync 404, `/home→상품→cart` 통과 |
| DEP-R01 | Preview | `dpl_7ARyaWnacAGL3XMSUP9nctpjrG12`, Node 22.x, npm install/build, audit 0, `/BUILD_ID=5ebf988...` |
| DEP-R02 | Production | `dpl_H2yDY1T7jGirk6GXSr4J2n6aWVzh`, apex/www alias, `/BUILD_ID=5ebf988...`, `/shop` 200, local-test API 404 |
| CH-R01 | Production Chrome | `/shop`, `/bidding` document 200, console error·failed network 0 |
| CH-R02 | Production Chrome | fixed bid와 빈 sold brand document 404, console error 0 |
| OBS-R01 | runtime log query | Vercel CLI 56.3.1/58.1.0 모두 HTTP 400; `OPEN_P2_OBSERVABILITY` |

토큰·쿠키·비밀번호와 로컬 service-role 값은 문서에 기록하지 않았다. 아래 카나리 표가 갱신하는 범위를 제외한 일반 회원·직원·타 매장·환불·chat·push 상태 변경은 계속 `PRODUCTION_UNVERIFIED_AUTH_SESSION` 또는 `MUTATION_UNEXECUTED`다.

## 운영 지정 데이터 카나리 증거

| ID | 증거 | 결과 |
| --- | --- | --- |
| CAN-DEP-01 | Production inspect·`/BUILD_ID` | `dpl_6GhzCYg2pzPovLVE5dctxBr12L33`, Ready, `1f23a6ad8c9eb08dd3e10f67d319ac5607e6bce1` |
| CAN-DEP-02 | pause 수정 Production inspect·`/BUILD_ID` | `dpl_7nvP7xb4k5vwKbze8MbZj23TWt8w`, Ready, `2fbc08bf7c2a8b68275ad4ec3dea829518d7ec6e`; metadata cache 불일치 배포 `dpl_HPuvP7p44Mo8PgDZa84SHEyKqAwF`는 채택하지 않음 |
| CAN-DB-01 | linked migration list | 로컬·원격 전 버전 일치, pending 0 |
| CAN-AUTH-01 | owner member-mode Chrome | 서버 기준 02:54 표시, 즉시 종료 후 타이머 제거·owner 복귀 |
| CAN-AUTHZ-01 | 소유자 자기 매장 상품 구매 | 사용자 알림으로 차단, 주문 생성 없음 |
| CAN-BUY-01 | 경매 상품·숨김 테스트 회원 | bid `0d372f93-e425-4d62-8b64-b05ab01fa389`, 1,000원 낙찰 확정 |
| CAN-PAY-01 | 수동입금 `3c2f641d-0a6c-489d-9542-531078b0b51b` | confirmed/version 1, receipt 1건·잔액 1,000원, inventory 1건 |
| CAN-SHIP-01 | shipment `d74b527e-9965-444b-9058-44ae48daa793` | 최초 성공·재시도 replay, 배송권 10→9, 단일 품목 |
| CAN-FUL-01 | 운영자 fulfillment Chrome·DB | collecting→ready_to_pack, 상품 release 이벤트 |
| CAN-SHIP-02 | 운영자 shipping Chrome·DB | packed→shipped/version 3, 한진택배·카나리 송장, 이벤트 sequence 1–5 |
| CAN-CANCEL-01 | 경매 구매자 취소 부정 RPC | `42501 경매 낙찰자는 취소를 요청할 수 없습니다`, cancellation row 없음 |
| CAN-PROD-01 | fixed 카나리 상품 pause RPC | active→pending, 공개 목록 제거; 이력 보존 |
| CAN-OBS-01 | Vercel runtime logs | CLI 56.3.1에서 계속 HTTP 400, `OPEN_P2_OBSERVABILITY` |
| CAN-SEC-01 | Supabase security advisor | 325건 집계; anon SECURITY DEFINER 2개는 공개 read projection으로 확인, authenticated 함수 245개는 `OPEN_REVIEW` |
| CAN-PROD-02 | pause/cron 운영 재현 | 기존 pause 뒤 다음 분 00초에 active 복귀 재현; `20260811121000_make_product_pause_persistent` 적용 후 cron이 `paused_at IS NULL`만 공개하도록 수정 |

카나리용 숨김 회원과 결제·배송 감사 이력은 append-only 증거로 보존했다. 공개 카나리 즉시구매 상품은 일시중지했다. 실제 개인정보·토큰·비밀번호는 기록하지 않았다. 일반 회원 Kakao 로그인, 직원·타 매장 운영 권한, 채팅, 환불, push는 계속 `PRODUCTION_UNVERIFIED` 또는 `MUTATION_UNEXECUTED`다.

상품 중지 확인창을 자동화하는 동안 첫 Chrome click이 timeout 뒤 지연 전달됐을 가능성을 먼저 조사했으나, canonical RPC 단일 실행에서도 다음 분 00초에 동일 현상이 재현됐다. 최종 원인은 매분 실행되는 자동공개 cron이 명시적 pause와 예약 pending을 구분하지 못한 것이며 F-16으로 수정했다. 최초 도구 원인 추정은 이 운영 재현으로 폐기한다.

## 실제 소유자 역할 카나리 증거

| ID | 증거 | 결과 |
| --- | --- | --- |
| ROLE-CAN-DEP-01 | Vercel Preview→Production | Preview `dpl_95cKSDRYjRndz59u6ndfKErH92tQ`, Production `dpl_9Ka18izctTtmGDPdPBu52tQZfnum`, Ready, SHA/BUILD_ID `747043fa5813cd4c0dcac761bc0487f711d2b09c` |
| ROLE-CAN-DB-01 | migration·GRANT | `20260811122000`, linked 165/pending 0; authenticated table SELECT=false, begin EXECUTE=false |
| ROLE-CAN-OP-01 | 소유자→다미네 운영자 3분 lease | effective role operator, principal `7a1acebf...`, owner bypass=false, assigned scope active |
| ROLE-CAN-OP-02 | 운영자 세부 권한 | 다미네 manage/publish/prepare=true; receive/create=false; 나인티 나인 manage=false |
| ROLE-CAN-EMP-01 | 소유자→다미네 직원 3분 lease | effective role employee, principal `4a21a65d...`, owner bypass=false |
| ROLE-CAN-EMP-02 | 직원 세부 권한 | 다미네 manage=true; publish/manage_staff/view_reports=false; 나인티 나인 manage=false; operator scope·물류는 `42501` |
| ROLE-CAN-END-01 | 명시 종료·자동 만료·감사 | 최종 stored/effective role owner, active principal null, session ended=true, append-only start/end 감사 8행 |
| ROLE-CAN-CH-01 | Production Chrome | 배포 후 기존 사이트 세션 만료로 로그인 링크 확인; UI 역할 재현은 `PRODUCTION_UNVERIFIED_AUTH_SESSION` |
| ROLE-CAN-TEST-01 | test/lint/tsc/build | 342 total, 336 pass, 6 retired PortOne skip; lint/tsc/build 123 pages 통과 |

역할 카나리는 저장된 `account_access_roles`, Kakao identity/JWT, 매장 멤버십을 변경하지 않는다. service-only 3분 lease가 만료되거나 명시 종료되면 소유자 권한으로 자동 복원된다. 운영자·직원 DB 권한 판정은 확인됐지만 일반 회원 Kakao, 채팅, 환불, push 실제 전달과 authenticated SECURITY DEFINER 245개 개별 검토는 이 증거로 완료 처리하지 않는다.

## 실제 세션 역할·채팅·push 카나리 증거

| ID | 증거 | 판정 |
|---|---|---|
| ROLE-CHROME-OP-01 | Production Chrome `/admin/operator`·products·chat | 다미네 한 매장만 노출, 상품·상담 렌더 `PASS` |
| ROLE-CHROME-OP-02 | Production Chrome `/admin/owner` | 다미네 운영자 principal 차단 `PASS` |
| ROLE-CHROME-EMP-01 | Production Chrome `/admin/employee`·inquiries | 다미네 직원 담당 화면 렌더 `PASS` |
| ROLE-CHROME-EMP-02 | Production Chrome `/admin/operator`·`/admin/owner` | 직원 principal 차단 `PASS` |
| CHAT-01 | conversation `9ac9da21-754b-4359-ad71-eef1d5007f74` | 일반회원 모드→다미네 발신, 다미네 운영자 답변, 회원 수신 `PASS` |
| CHAT-02 | message `de435398-d915-4f13-a9a7-9d5a647f1517` DB 조회 | 최종 운영자 답변 sender `7a1acebf-5b11-4a4d-aac5-c0b29980f4fc` `PASS` |
| REFUND-01 | `/account`·DB count | 환불 진행 0건 정상 렌더; 유효 금전 대상 없음 `MUTATION_UNEXECUTED_NO_VALID_CASE` |
| PUSH-01 | notification `3a97f404-ed4a-40b7-882b-89b1a1e9bab8` | 실제 소유자 active subscription 1건에 durable outbox 생성 `PASS` |
| PUSH-02 | pg_net request 8·outbox DB | HTTP 200, attempts 1, delivered 2026-08-11 20:58:30 KST, last_error null `PASS` |
| DB-ROLE-05 | migrations `20260811113426`, `20260811113535`, `20260811124000`, `20260811124500` | role canary membership·chat principal·sender·read scope 보완, linked 적용 `PASS` |
| QA-ROLE-05 | `npm test`, lint, `tsc --noEmit`, production build | 343 total, 337 pass, 6 intentional skip, 0 fail; lint/types/build 123 pages `PASS` |

push 카나리에서 누락된 Vault dispatch URL만 공식 운영 endpoint로 등록했다. VAPID private key·dispatch secret·세션 토큰은 조회하거나 출력하지 않았다. 역할 lease는 종료 또는 만료됐으며 Chrome에서 소유자 화면 복귀를 확인했다. authenticated SECURITY DEFINER 245개 개별 검토와 유효 환불 mutation은 이 표의 완료 범위에 포함하지 않는다.

## SECURITY DEFINER 권한 증거

| ID | 증거 | 판정 |
|---|---|---|
| SECDEF-01 | 운영 catalog·advisor 246행 | search_path 고정 246, 명시 ACL 246, anon 2 `PASS_REVIEWED` |
| SECDEF-02 | `04-authenticated-security-definer-review.md` | 246개 함수 서명별 유지·회수 판정 완료 |
| SECDEF-03 | migration `20260811131000_harden_internal_security_definer_execute` | trigger 16개·입찰 취소 helper 직접 EXECUTE 회수 `PASS` |
| SECDEF-04 | 운영 `has_function_privilege`·catalog 재조회 | cancel helper auth/anon false, authenticated trigger 0, public authenticated SECURITY DEFINER 230 `PASS` |
| SECDEF-05 | Supabase security advisor 재조회 | authenticated 경고 246→230, anon 공개 읽기 2 유지; password protection 설정 경고 1은 별도 운영 설정 항목 |

앞 문단의 SECURITY DEFINER 미완료 표시는 이 절로 대체한다. 유효 환불 mutation은 계속 `MUTATION_UNEXECUTED_NO_VALID_CASE`다.

## 최종 운영 증거

| ID | 증거 | 판정 |
|---|---|---|
| FINAL-DEP-01 | Vercel `dpl_3JohYeBnsEXE6jJ2hAT4oUFZNxEs`, `/BUILD_ID` | Ready·Production·SHA `6c4a9653e67f62923e06a71340ff4b895b9cba1e` |
| FINAL-AUTH-01 | Production Chrome `/account/test-member`→`/account` | 실제 Auth member 로그인, 주문·배송·환불 렌더, admin 링크 없음 `PASS` |
| FINAL-AUTHZ-01 | Production Chrome `/admin/owner`, member bearer admin APIs | UI 접근 차단, owner/operator API HTTP 403 `PASS` |
| FINAL-REFUND-01 | order `8c36e6a7...`, refund `c5e014e6...` | invalid 422, 중복 200/version 1, completed/version 3, 계좌 암호문 삭제 `PASS` |
| FINAL-ROUTE-01 | source-derived 75 URL·97 API GET | page 71×200+4×의도 404, API 5xx 0·의도된 local-test 404 `PASS` |
| FINAL-MEMBER-API-01 | 실제 member bearer GET 18개 | 17×200, POST-only 1×405, admin 2×403 `PASS` |
| FINAL-OBS-01 | Vercel runtime logs/errors 1h | 5xx 0, runtime error cluster 0 `PASS` |
| FINAL-DB-01 | linked dry-run·advisor | migration 172, pending 0; leaked-password 1건만 유료 요금제 경계 |
| FINAL-STATUS-01 | `/api/site/status`, `/home` | `operational`, 안내 `정상 운영 중입니다.`, HTTP 200, maintenance banner 없음 |

이 표와 `05-final-regression-and-release.md`가 위의 시점별 미검증·미실행 표기를 대체한다. 비밀번호·토큰·환불 암호화 키는 증거 문서에 기록하지 않았다.
