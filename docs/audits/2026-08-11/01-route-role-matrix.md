# 페이지·API 역할 매트릭스

## 범례와 역할

- `PASS`: 현재 증거로 기대 계약과 일치
- `DEFECT`: 재현 가능한 결함
- `PRODUCTION_UNVERIFIED_AUTH_SESSION`: 운영 인증 세션 불안정으로 역할별 판정 보류
- `MUTATION_UNEXECUTED`: 운영 상태 변경을 실행하지 않음
- 역할: 공개 방문자, 회원, 운영자(매장 사장), 직원(매장 직원), 소유자(사이트 소유자)
- 증거 키는 `03-evidence-index.md`를 참조한다.

## 2차 재검증 오버레이

아래 표는 최초 감사 행의 `DEFECT`, `BLOCKED_LOCAL_DOCKER`, 역할 검증 상태를 보완하며 충돌 시 우선한다. 운영 Kakao 실계정과 상태 변경 카나리를 실행하지 않은 행의 원래 표시는 계속 유효하다.

| 범위 | 2차 판정 | 증거 |
| --- | --- | --- |
| `/shop`, `/m/shop`, `/feed` 공개 렌더·clock | hydration/공개 clock 오염 수정, Production console/network 오류 0 `PASS` | FIX-01, CH-R01 |
| `/bidding`, `/m/bidding` guest | raw `unauthorized` 제거, 로그인 안내 렌더 `PASS` | FIX-02, CH-R01 |
| fixed 상품 `/auction/[id]/bid`, mobile 대응 경로 | desktop/mobile hard 404 통일 `PASS` | FIX-02, CH-R02 |
| 빈 `/sold/brand/[slug]`, mobile 대응 경로 | desktop/mobile hard 404 통일 `PASS` | FIX-02, CH-R02 |
| 회원 `/account` 및 회원 API | 격리 Chrome 렌더, role=session member, owner/operator API 403 `PASS_ISOLATED`; Production은 `PRODUCTION_UNVERIFIED_AUTH_SESSION` | ROLE-01, ROLE-05 |
| 운영자 `/admin/operator` 및 operator API | store scope 선택 전 428, 본인 매장 선택 후 정상, 타 매장 선택 403 `PASS_ISOLATED`; Production은 `PRODUCTION_UNVERIFIED_AUTH_SESSION` | ROLE-02, ROLE-05 |
| 직원 `/admin/employee` | 직원센터 렌더, owner API 403 `PASS_ISOLATED`; Production은 `PRODUCTION_UNVERIFIED_AUTH_SESSION` | ROLE-03, ROLE-05 |
| 소유자 `/admin/owner` 및 owner API | 소유자센터·수동 계좌이체 설정 렌더, owner overview 200 `PASS_ISOLATED`; Production은 `PRODUCTION_UNVERIFIED_AUTH_SESSION` | ROLE-04, ROLE-05 |
| local-only `/api/local-test-accounts` | Preview/Production 404 `PASS` | DEP-R02 |
| 모든 mutation API | SQL/RLS/CAS/경합 suite는 통과. 운영 지정 데이터 카나리는 `MUTATION_UNEXECUTED` | DB-R01, MUT-R01 |

## 페이지 77개

같은 행에 여러 역할이 있으면 공개 페이지는 모두 동일한 읽기 계약을 사용하고, 관리 페이지는 서버가 세션·역할·매장 범위를 다시 검증해야 한다.

| 경로 | 기대 역할 | 관측 및 판정 | 증거 |
| --- | --- | --- | --- |
| `/`, `/home` | 전체 | `/`→`/home`, 200 `PASS` | CH-01 |
| `/feed` | 전체 | 200; stale 세션에서 clock RPC 401 `DEFECT` | CH-02, NET-01 |
| `/shop` | 전체 | 200이나 React hydration #418 재현 `DEFECT` | CH-03, CODE-01 |
| `/sold` | 전체 | 200, 빈 상태 `PASS` | CH-04 |
| `/sold/[id]` | 전체 | 정상 UUID 200, 없는/잘못된 ID 404 `PASS` | CH-05 |
| `/sold/brand/[slug]` | 전체 | 데이터 없는 slug를 desktop만 404 `DEFECT` | CH-06, CODE-02 |
| `/stores/[slug]` | 전체 | `dami-shop` 200, 없는 slug 404 `PASS` | CH-07 |
| `/auction/[id]` | 전체 | fixed 상품 ID 200, 없는 ID 404 `PASS` | CH-08 |
| `/auction/[id]/bid` | 회원 | fixed 상품 ID hard 404 `PASS` | CH-09 |
| `/account/login` | 비회원 | 세션 불안정 때문에 최종 판정 보류 `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-01 |
| `/auth/callback` | 인증 콜백 | 직접 진입 후 기존 audit context가 401; 인과 미확정 `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-01 |
| `/account`, `/bidding`, `/cart`, `/chat` | 회원 | stale 세션을 로그인으로 표시하고 API 401 다발 `DEFECT`; 정상 회원 flow는 보류 | AUTH-01, NET-01 |
| `/privacy`, `/refund`, `/terms` | 전체 | 200; 내용에 법률 검토 대기 표기 `PASS_WITH_GOVERNANCE_NOTE` | CH-10 |
| `/operator`, `/owner` | 운영자/소유자 | 각각 `/admin/operator`, `/admin/owner`로 이동 `PASS` | CH-11 |
| `/admin` | 권한 사용자 | 역할별 landing 계약; 운영 판정 보류 | AUTH-02 |
| `/admin/operator` | 운영자 | 운영 인증 세션 401로 보류 | AUTH-02 |
| `/admin/operator/center` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/chat` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/exceptions` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/fulfillment` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-02 |
| `/admin/operator/orders` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/payments` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-02 |
| `/admin/operator/platform` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-02 |
| `/admin/operator/products` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-02 |
| `/admin/operator/products/past` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/products/registration` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-02 |
| `/admin/operator/revenue` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/shipping` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-02 |
| `/admin/operator/shipping/completed` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/shipping/history` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/storage` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/operator/winners` | 운영자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-02 |
| `/admin/employee` | 직원 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-03 |
| `/admin/employee/center` | 직원 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-03 |
| `/admin/employee/fulfillment` | 직원 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-03 |
| `/admin/employee/inquiries` | 직원 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-03 |
| `/admin/employee/parcels` | 직원 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-03 |
| `/admin/owner` | 소유자 | audit 세션 401로 보류 | AUTH-04 |
| `/admin/owner/fulfillment` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-04 |
| `/admin/owner/members` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-04 |
| `/admin/owner/members/withdrawn` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-04 |
| `/admin/owner/onboarding` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-04 |
| `/admin/owner/payments` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-04 |
| `/admin/owner/platform` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-04 |
| `/admin/owner/refunds` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-04 |
| `/admin/owner/site-status` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-04 |
| `/admin/owner/stores` | 소유자 | `PRODUCTION_UNVERIFIED_AUTH_SESSION`, mutation `MUTATION_UNEXECUTED` | AUTH-04 |
| `/m`, `/m/home` | 전체 | `/m`→`/m/home`, 200 `PASS` | CH-M01 |
| `/m/feed`, `/m/shop` | 전체 | 200; stale clock/session 요청은 `DEFECT` | CH-M02, NET-01 |
| `/m/sold`, `/m/sold/[id]` | 전체 | 200 빈 상태; invalid ID 404 `PASS` | CH-M03 |
| `/m/sold/brand/[slug]` | 전체 | empty slug도 200, desktop과 계약 불일치 `DEFECT` | CH-M04, CODE-02 |
| `/m/stores/[slug]` | 전체 | `dami-shop` 200 `PASS` | CH-M05 |
| `/m/auction/[id]` | 전체 | fixed 상품 200 `PASS` | CH-M06 |
| `/m/auction/[id]/bid` | 회원 | fixed 상품에 document 200 soft-404 `DEFECT` | CH-M07 |
| `/m/account/login`, `/m/auth/callback` | 인증 | 운영 정상 세션 판정 보류 `PRODUCTION_UNVERIFIED_AUTH_SESSION` | AUTH-01 |
| `/m/account`, `/m/account/[section]`, `/m/account/settings` | 회원 | stale 세션/API 401 `DEFECT`; 알 수 없는 section은 404 계약 | AUTH-01 |
| `/m/bidding` | 회원 | API 401 문자열 `unauthorized`를 그대로 노출 `DEFECT` | CH-M08 |
| `/m/cart`, `/m/chat` | 회원 | stale 세션/API 401 `DEFECT`; 정상 회원 flow 보류 | AUTH-01 |
| `/m/checkout` | 회원 | query 없음 404는 코드 계약; 정상 `productId` mutation 미실행 | CODE-03, MUT-01 |
| `/m/privacy`, `/m/refund`, `/m/terms` | 전체 | 200 `PASS_WITH_GOVERNANCE_NOTE` | CH-M09 |
| parallel modal `/account/login`, `/auction/[id]`, `/auction/[id]/bid` 3개 | 전체/회원 | 직접 URL이 아니라 intercepted-route 계약; 정적 연결 확인, 상호작용 재검증 필요 | CODE-04, `PRODUCTION_UNVERIFIED_AUTH_SESSION` |

## API Route 97개

`G401`은 무인증 GET smoke에서 안정적인 401을 확인했다. `CODE`는 handler·인증·역할·scope 연결을 정적으로 확인했다. 모든 POST/PATCH/PUT/DELETE는 별도 표기가 없으면 `MUTATION_UNEXECUTED`다.

| API와 메서드 | 역할/판정 |
| --- | --- |
| `/api/products` GET, `/api/products/[id]` GET, `/api/site/status` GET | 공개; 200/invalid ID 400 확인 `PASS` |
| `/api/auth/kakao/start` GET, `/oidc` GET, `/profile` GET·POST, `/session` GET·POST, `/logout` POST | 인증; callback 실사용 `PRODUCTION_UNVERIFIED_AUTH_SESSION`, writes `MUTATION_UNEXECUTED` |
| `/api/account/addresses` GET·POST·PATCH·DELETE | 회원; `G401`, writes 미실행 |
| `/api/account/bids` GET | 회원; `G401` |
| `/api/account/cancellations` GET·POST, `/[id]/respond` POST | 회원; `G401`, writes 미실행 |
| `/api/account/delete` GET·POST | 회원; `G401`, delete 미실행 |
| `/api/account/experience` GET·POST | 회원; `G401`, write 미실행 |
| `/api/account/legacy-eligible-orders` GET | 회원; `G401`, read-only compatibility |
| `/api/account/refunds` GET, `/refunds/[id]/account` POST | 회원; `G401`, write 미실행 |
| `/api/account/shipments` GET, `/shipments/[id]` GET | 회원; `G401`; store/group scope code trace 필요 |
| `/api/account/storage` GET | 회원; `G401` |
| `/api/cart` GET·POST·DELETE, `/api/wishlist` GET·POST·DELETE | 회원; `G401`, writes 미실행 |
| `/api/chat` GET·POST, `/chat/read` POST, `/chat/unread` GET | 회원/센터; `G401`, writes 미실행 |
| `/api/notifications` GET·POST, `/preferences` GET·POST | 회원; `G401`, writes 미실행 |
| `/api/orders` GET, `/orders/[id]` GET | 회원; `G401` |
| `/api/orders/checkout` POST | 회원; 수동 계좌이체 계약, `MUTATION_UNEXECUTED` |
| `/api/orders/[id]/manual-transfer` POST, `/payment-confirmation-request` POST | 회원; 자동 입금확정 없음, `MUTATION_UNEXECUTED` |
| `/api/payments/manual-transfer` GET·POST | 회원; `G401`, write 미실행 |
| `/api/auction/bids` GET·POST | 회원; `G401`, bid 미실행 |
| `/api/shipping/credits` GET·POST·DELETE | 회원/센터; `G401`, writes 미실행 |
| `/api/shipping/requests` POST, `/legacy-order` POST | 회원/센터; 신규 canonical 및 legacy compatibility, `MUTATION_UNEXECUTED` |
| `/api/push/subscription` GET·POST·DELETE, `/push/test` POST | 회원; `G401`, writes 미실행 |
| `/api/push/dispatch` POST | 내부; 무인증 차단 확인, mutation 미실행 |
| `/api/security/session` POST | 인증 보안; mutation 미실행 |
| `/api/owner/member-mode` GET·POST | 소유자; `G401`, write 미실행 |
| `/api/onboarding-chat` GET·POST | 신청자/소유자; GET 계약 확인, write 미실행 |
| `/api/admin/session` GET | 관리자; `G401` |
| `/api/admin/operator/auctions/[id]/second-chance` POST | 운영자/매장; scope code 확인, mutation 미실행 |
| `/api/admin/operator/cancellations` GET·POST·PATCH | 운영자/매장; `G401`, writes 미실행 |
| `/api/admin/operator/chat` GET·POST | 운영자/매장; `G401`, write 미실행 |
| `/api/admin/operator/exceptions` GET·POST, `/[id]/evidence` GET·POST | 운영자/매장; `G401`, writes 미실행 |
| `/api/admin/operator/fulfillment` GET·POST | 운영자/매장·그룹; `G401`, write 미실행 |
| `/api/admin/operator/member-operations` GET, `/members` GET·PATCH | 운영자/매장; `G401`, PATCH 미실행 |
| `/api/admin/operator/orders` GET, `/orders/[id]/confirm` POST | 운영자/매장; `G401`, confirm 미실행 |
| `/api/admin/operator/payments` GET, `/payments/[kind]/[id]/confirm` POST, `/cancel` POST | 운영자/매장; 수동확인 계약, mutations 미실행 |
| `/api/admin/operator/platform` GET·POST | 운영자/매장; `G401`, write 미실행 |
| `/api/admin/operator/products` GET·POST | 운영자/매장; `G401`, create 미실행 |
| `/api/admin/operator/products/[id]` PATCH·DELETE | 운영자/매장; mutations 미실행 |
| `/api/admin/operator/products/[id]/close-now`, `/pause`, `/publish` POST | 운영자/매장; mutations 미실행 |
| `/api/admin/operator/products/bulk` POST, `/enhance` POST | 운영자/매장; AI/DB mutations 미실행 |
| `/api/admin/operator/products/past` GET·POST, `/publication-preference` GET·PUT | 운영자/매장; `G401`, writes 미실행 |
| `/api/admin/operator/revenue` GET | 운영자/매장; `G401` |
| `/api/admin/operator/shipping` GET·POST, `/shipping/[id]/address` POST | 운영자/매장·그룹; `G401`, mutations 미실행 |
| `/api/admin/operator/store-scope` GET·POST | 운영자; `G401`, selection write 미실행 |
| `/api/admin/operator/transfers/[id]/ledger` POST | 운영자/매장; append-only ledger mutation 미실행 |
| `/api/admin/owner/delegation` GET·POST·DELETE | 소유자; `G401`, writes 미실행 |
| `/api/admin/owner/manual-transfer-account` GET·PATCH | 소유자; `G401`, secret write 미실행 |
| `/api/admin/owner/members` GET·PATCH, `/members/withdrawn` GET·PATCH | 소유자; `G401`, writes 미실행 |
| `/api/admin/owner/overview` GET, `/payment-confirmation-requests` GET | 소유자; `G401` |
| `/api/admin/owner/payment-mode` GET·PATCH | 소유자; manual-only 정책, PATCH 미실행 |
| `/api/admin/owner/platform` GET·POST | 소유자; `G401`, mutation 미실행 |
| `/api/admin/owner/refunds` GET·POST | 소유자; `G401`, refund 미실행 |
| `/api/admin/owner/security/activity` POST, `/ip-blocks` POST·PATCH, `/requests` POST, `/sessions` POST | 소유자; security mutations 미실행 |
| `/api/admin/owner/shipping/[id]` PATCH | 소유자; group-scoped mutation 미실행 |
| `/api/admin/owner/site-status` GET·PATCH | 소유자; `G401`, maintenance 변경 미실행 |
| `/api/admin/owner/storage-usage` GET | 소유자; `G401` |
| `/api/admin/owner/stores` GET·PATCH | 소유자; `G401`, write 미실행 |
| `/api/admin/owner/test-member` GET·POST·PATCH, `/addresses` PUT·DELETE, `/shipping` POST·PATCH | 소유자/지정 테스트; 전부 운영 mutation 미실행 |
| `/api/admin/owner/token-usage` GET | 소유자; `G401` |
| `/api/cron/storage-lifecycle` GET, `/storage-policy` GET | cron secret; 무인증 차단 확인, 실제 cron `PRODUCTION_UNVERIFIED` |
| `/api/internal/subscriptions/accrue` POST | 내부 cron; mutation 미실행 |
| `/api/local-test-accounts` GET·POST·DELETE | local only; Production GET 404 `PASS` |

## 동적 ID 및 상태 변경 경계

- 공개 product/store 동적 URL은 정상 ID와 invalid/없는 ID를 검사했다.
- 타 회원·타 매장·권한 없는 직원의 운영 직접 API 호출은 정상 인증 세션과 격리 DB가 없어 아직 `PRODUCTION_UNVERIFIED_AUTH_SESSION` 또는 `MUTATION_UNEXECUTED`다.
- 성공·실패·중복·경합·재시도는 Docker 기반 격리 Supabase 복구 뒤 실행한다. 운영에서는 지정 테스트 주문·상품만 카나리로 사용한다.

2차 결과: Docker 격리 Supabase에서 해당 SQL suite의 성공·실패·중복·경합·재시도를 실행해 통과했다. 단, 실제 운영 Kakao 세션과 지정 운영 주문·상품을 사용할 권한이 확보되지 않아 운영 mutation 행은 계속 `MUTATION_UNEXECUTED`다.

## 운영 카나리 판정 갱신

아래 행은 앞선 `PRODUCTION_UNVERIFIED_AUTH_SESSION`·`MUTATION_UNEXECUTED` 판정을 지정 운영 데이터 범위에서 대체한다. 표에 없는 역할·URL은 기존 판정을 유지한다.

| URL/API | 역할 | 운영 판정 | 증거 |
| --- | --- | --- | --- |
| `/api/owner/member-mode` GET·POST, `/home` | 소유자→회원→소유자 | 3분 활성화, 서버 동기화 잔여 시간, 즉시 종료 후 owner 복귀 `PASS` | CAN-AUTH-01 |
| `/auction/[id]`, bid RPC | 숨김 테스트 회원 | 경매 1,000원 입찰·낙찰 확정 `PASS`; 소유자 자기 매장 즉시구매는 차단 `PASS` | CAN-BUY-01, CAN-AUTHZ-01 |
| `/admin/owner/payments`, 수동 입금 확인 | 소유자 | 입금요청 1,000원→confirmed, append-only receipt 1건·잔액 1,000원 `PASS` | CAN-PAY-01 |
| 배송 요청 RPC | 숨김 테스트 회원 | 크레딧 10→9, 동일 idempotency key 재시도 시 같은 shipment 반환 `PASS` | CAN-SHIP-01 |
| `/admin/operator/fulfillment` | 운영자 범위의 소유자 | 지정 상품 출고·보관 완료 `PASS` | CAN-FUL-01 |
| `/admin/operator/shipping`, `/completed` | 운영자 범위의 소유자 | 합포장→송장 등록→shipped, 완료 목록 반영 `PASS` | CAN-SHIP-02 |
| `/api/account/cancellations` 대응 RPC | 경매 구매자 | 구매자 취소 요청을 42501로 차단, 변경 없음 `PASS` | CAN-CANCEL-01 |
| `/api/admin/operator/products/[id]/pause` 대응 RPC | 운영자 범위의 소유자 | 공개 카나리 즉시구매 상품을 pending으로 일시중지 `PASS` | CAN-PROD-01 |

운영 일반 회원의 실제 Kakao 로그인, 직원 계정, 타 매장 운영자 직접 접근, 채팅 송수신, 환불 실행은 아직 이 표로 검증되지 않았다.

## 실제 소유자 세션 역할·채팅·push 갱신

| 경로·기능 | 역할 | 운영 판정 | 증거 |
|---|---|---|---|
| `/admin/operator`, `/admin/operator/products`, `/admin/operator/chat` | 다미네 운영자 principal | 다미네 단일 매장만 노출, 채팅 조회·답변 성공 `PASS_PRODUCTION_CANARY` | ROLE-CHROME-OP-01, CHAT-01 |
| `/admin/owner` | 다미네 운영자 principal | 접근 차단 `PASS_PRODUCTION_CANARY` | ROLE-CHROME-OP-02 |
| `/admin/employee`, `/admin/employee/inquiries` | 다미네 직원 principal | 담당 매장 화면·문의 조회 성공 `PASS_PRODUCTION_CANARY` | ROLE-CHROME-EMP-01 |
| `/admin/operator`, `/admin/owner` | 다미네 직원 principal | 접근 차단 `PASS_PRODUCTION_CANARY` | ROLE-CHROME-EMP-02 |
| `/chat` | 일반회원 모드 | 다미네 대화 생성·발신, 운영자 답변 수신 성공 `PASS_PRODUCTION_CANARY` | CHAT-01, CHAT-02 |
| `/account` 환불 진행 상황 | 일반회원 모드 | 0건 빈 상태 렌더 성공; 실제 금전 환불은 대상 없음 `MUTATION_UNEXECUTED_NO_VALID_CASE` | REFUND-01 |
| web push queue·dispatch | 실제 소유자 구독 | notification→outbox→HTTP 200→delivered 성공 `PASS_PRODUCTION_CANARY` | PUSH-01, PUSH-02 |

채팅 최종 발신 메시지 `de435398-d915-4f13-a9a7-9d5a647f1517`은 다미네 운영자 UUID로 기록됐다. 앞서 결함 재현용 메시지의 소유자 발신자 기록은 append-only 감사 증거로 보존했다. 타 매장 scope 및 직원 직접 접근은 위 행에 한해 더 이상 `PRODUCTION_UNVERIFIED_AUTH_SESSION`이 아니다. 실제 환불 금전 mutation과 일반 회원 자신의 Kakao 로그인은 별도 유효 대상이 없어 완료 처리하지 않는다.

## 최종 대체 판정

`05-final-regression-and-release.md`의 75 URL·97 API 전수 smoke와 실제 일반회원 bearer 회귀가 이 문서의 시점별 보류 판정을 대체한다. 실제 일반회원 로그인·주문·입금·환불 성공/실패/중복, owner/operator 직접 접근 차단, 기존 운영자·직원·타 매장·채팅·push 카나리가 모두 완료됐다. 고정가 `/bid`, 미판매 `/sold`, 닫힌 local-test API의 404는 계약상 의도된 결과이며 설명되지 않은 404·5xx는 0이다.
