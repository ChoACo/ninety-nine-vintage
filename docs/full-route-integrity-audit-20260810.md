# 전체 페이지·연결 무결성 감사 보고서

기준일: 2026-08-10 (Asia/Seoul)
상태: 승인 전 조사·문서화만 완료. 코드 수정·DB mutation·배포 없음.

## 1. 감사 범위와 방법

대상 URL은 공개 구매자 화면, 소유자·운영자·직원 화면, 계정·카트·매장 화면을 포함한다. 각 URL의 실제 HTTP 응답을 확인하고, 대응 Next.js route/page/layout, 컴포넌트, API route, Supabase service/RPC/migration, 통합 문서를 대조했다. HTTP 200인 관리자 화면은 클라이언트 인증 후 빈 shell일 수 있으므로 기능 성공으로 판정하지 않았다.

### 실제 응답 요약

| 구간 | 확인 결과 |
|---|---|
| `/home`, `/feed`, `/shop`, `/chat`, `/account`, `/cart` | 200 |
| `/admin/owner`, `/admin/operator`, `/admin/employee` 및 하위 지정 경로 | 200 shell; 역할별 API·브라우저 QA 별도 필요 |
| `/admin/owner/site-status` | 404. 화면 route가 없고 API만 존재 |
| `/stores/dami-shop` | 500. 정상적인 없는/비활성 slug라면 404로 끝나야 하며 production 원인은 미확정 |

## 2. URL별 코드 연결 지도

### 공개 화면

- `/home`: `src/app/(shop)/home/page.tsx`, `src/app/(mobile)/m/home/page.tsx`, 홈 상품·경매 컴포넌트, `src/services/products.ts`. 데스크톱/모바일 표시 트리와 로더가 분리되어 문구·데이터 slice 차이 가능.
- `/feed`: `src/app/(shop)/feed/page.tsx`, `src/app/(mobile)/m/feed/page.tsx`, `src/components/features/auction/AuctionFeedGrid.tsx`, `AuctionFilterSidebar.tsx`, `auctionFeedLogic.ts`, `src/app/api/products/route.ts`. SSR 초기값, 클라이언트 catalog reload, URL filter state, realtime subscription이 연결됨.
- `/shop`: `src/app/(shop)/shop/page.tsx`, `src/app/(mobile)/m/shop/page.tsx`, 공유 `AuctionFeedGrid`, `AuctionCard`, `src/app/api/cart/route.ts`, `src/lib/commerce/client.ts`, `purchaseIntent.ts`. 고정가 카트 점유 RPC와 로그인 복귀가 연결됨.
- `/chat`: `src/app/(shop)/chat/page.tsx`, `src/app/(mobile)/m/chat/page.tsx`, `src/components/features/chat/ChatPanel.tsx`, `src/app/api/chat/route.ts`, `read/route.ts`, `unread/route.ts`, `src/lib/supabase/supportChat.ts`. 회원·매장·상품 문의방·읽음·실시간 채널이 연결됨.
- `/account`: `src/app/(shop)/account/page.tsx`, `src/app/(mobile)/m/account/page.tsx`, `src/app/(mobile)/m/account/[section]/page.tsx`, `src/components/features/account/AccountDashboard.tsx`, `src/app/api/account/*`. 주소·보관·배송·취소·환불·찜·알림이 한 대형 dashboard와 다수 API에 연결되어 부분 실패·탭 URL drift 위험이 있음.
- `/cart`: `src/app/(shop)/cart/page.tsx`, `src/app/(mobile)/m/cart/page.tsx`, `src/components/features/cart/*`, `src/app/api/cart/route.ts`, checkout/order routes. 점유·배송비 quote·수동이체 checkout 연결을 별도 검증해야 함.
- `/stores/dami-shop`: `src/app/(shop)/stores/[slug]/page.tsx`, `src/app/(mobile)/m/stores/[slug]/page.tsx`, `src/services/stores.ts`, `ProductRail`, `fetchStoreSoldFeedProducts`. `fetchStoreBySlug`가 모든 active store 조회 실패를 예외로 전파하고 page가 catch하지 않아 500 가능. unknown slug는 `notFound()` 경로여야 함.

### 소유자 화면

- `/admin/owner`: `src/app/(admin)/admin/owner/page.tsx`, `OwnerDashboard.tsx`, `owner/layout.tsx`, owner overview/security/site-status panels.
- `/admin/owner/payments`: page + `OwnerPaymentConfirmationQueue.tsx`, owner overview/payment confirmation APIs. 입금 확인은 owner-only ledger/CAS 경계가 핵심.
- `/admin/owner/refunds`: `OwnerRefundConsole.tsx`, owner refunds API/RPC. 계좌·환불 원장·감사 기록 연결 확인 필요.
- `/admin/owner/stores`: `OwnerStoresConsole.tsx`, owner stores API/RPC. 매장·운영자 membership 변경과 CAS 연결.
- `/admin/owner/members`: `OwnerMembersConsole.tsx`, members/withdrawn APIs. page size·검색·회원 상태 mutation 연결.
- `/admin/owner/onboarding`: `OnboardingChatPanel.tsx`, `/api/onboarding-chat`, 별도 owner FAQ/입점 ledger. 일반 회원 채팅과 분리되어야 함.
- `/admin/owner/platform`: `OwnerPlatformConsole.tsx`, `OwnerPlanApprovalPanel.tsx`, owner platform API. 공유 GET/cache 적용 여부와 승인 mutation을 함께 검증.
- `/admin/owner/site-status`: 대응 page 없음(404). `src/app/api/admin/owner/site-status/route.ts`와 `OwnerSiteStatusPanel`은 존재하므로 진입점·API·문서가 분리됨.

### 운영자 화면

- 공통: `src/app/(admin)/admin/operator/layout.tsx`, `OperatorStoreScopeSelector.tsx`, `src/lib/commerce/server.ts`의 selected-store 인증.
- `/admin/operator`: page + dashboard/revenue summary. 대분류 `매출·정산`이 `/admin/operator`로 연결되는 의도와 상세 revenue route의 관계 확인 필요.
- `/products`, `/products/registration`, `/products/past`: `OperatorProductsConsole.tsx`, product CRUD/publish/pause/close/bulk/enhance/past APIs. 버튼은 권한·store scope·상품 상태에 의존.
- `/winners`: winner/payment state console 및 member/order APIs.
- `/fulfillment`, `/storage`: `OperatorFulfillmentConsole.tsx`, storage/member shipment APIs. 직원·운영자 공통 scope와 address reveal 경계 확인.
- `/shipping`, `/shipping/completed`, `/shipping/history`: operator shipping APIs, count RPC, CAS packing/dispatch. 목록·완료·역사 route 간 상태 전이가 핵심.
- `/exceptions`: exception API/evidence route. 서명 증거와 발송 차단 연결.
- `/chat`: `OperatorChatConsole.tsx`, admin operator chat API, support conversation RLS. 회원·직원 internal chat의 범위 분리 확인.
- `/platform`: operator platform API, plan/account/settings. owner와 동일 명칭 데이터의 권한·scope 분리 확인.

### 직원 화면

- 공통: `src/app/(admin)/admin/employee/layout.tsx`, `src/lib/admin/mobileNavigation.ts`, employee access helper.
- `/admin/employee`: dashboard page.
- `/fulfillment`: fulfillment page + shared operator fulfillment console; `allowEmployee` 인증과 membership/RPC scope가 모두 맞아야 함.
- `/parcels`: parcel/shipping page와 직원 전용 mutation.
- `/inquiries`: `OperatorChatConsole` 또는 employee basePath, internal conversation API. assigned store 외 대화 차단 확인.
- `src/app/(admin)/admin/employee/center/page.tsx`는 `/admin/employee/fulfillment` redirect 호환 route이며, 폐기 여부를 결정하지 않은 dead compatibility surface다.

## 3. 확인된 오류·충돌·부족한 연결

### 즉시 확인된 실제 오류

1. `/admin/owner/site-status`가 404다. page route가 없고 API/panel만 남아 있다.
2. `/stores/dami-shop`가 500이다. slug 미존재·비활성·DB 조회 실패를 404/503으로 구분하지 못할 가능성이 있다. production 로그와 Supabase read-only 증거가 필요하다.

### 연결 충돌 후보

- 소유자 layout의 `/platform` 라벨은 정산인데 실제 platform/plan/account 기능과 의미가 섞여 있다.
- 운영자 `매출·정산` 대분류는 `/admin/operator`로 가고 상세 `/revenue`는 별도 route라 사용자가 목적 화면을 찾지 못할 수 있다.
- fixed 상품 카드가 `/auction/{id}` 의미의 URL을 사용한다. 기능은 동작해도 판매 방식·metadata·CTA 의미가 불일치한다.
- 일반 채팅(`/api/chat`)·상품 문의(`start_product_inquiry`)·입점 상담(`/api/onboarding-chat`)이 다른 RPC·권한·오류 계약을 사용한다.
- owner/operator/employee 화면은 서로 다른 세션 취득·인증 helper와 `useSupabaseSession`/`getSession` 패턴을 혼용한다.
- 계정 dashboard의 주소·배송·환불·보관·찜·채팅 연결이 한 파일에 집중되어 탭별 로딩·오류·재시도 상태가 서로 다를 수 있다.
- 공유 `AuctionFeedGrid`가 feed와 shop의 초기 SSR·전체 catalog 조회·필터·realtime 조건을 동시에 담당해 한 surface 수정이 다른 surface에 영향을 준다.

## 4. 승인 후 실행 계획

### 0단계: 증거 확보

production Vercel logs, `/stores/dami-shop` server error, 역할별 실제 세션, API status/body, migration parity를 read-only로 캡처한다. 이 단계에서는 데이터 변경을 하지 않는다.

### 1단계: 확정 오류 제거

site-status의 의도(페이지 복구 또는 메뉴/API 제거)를 결정하고, store slug 오류를 `notFound`/503 계약으로 분리한다. 관련 route·layout·문서 링크를 함께 정리한다.

### 2단계: 권한·라우팅 연결

owner/operator/employee 각 URL을 역할별로 직접 접근하고, 허용·거부 API를 표로 만든다. selected store, employee assigned store, owner explicit store scope가 모든 read/write에 전파되는지 확인한다.

### 3단계: 업무 흐름 종단 연결

상품 등록→공개→피드/숍 노출→카트 점유→수동이체→입금 확인→보관→배송→채팅/문의→취소·환불→정산의 각 전환을 테스트 데이터에서 연결한다. 각 버튼은 loading/disabled/success/failure/retry 상태를 확인한다.

### 4단계: 공통 컴포넌트·요청 충돌 정리

공유 feed/shop loader, chat 계약, auth/session hook, AccountDashboard를 경계별로 분리한다. 동시 클릭·중복 nonce·stale session·realtime reconnect·뒤로가기·새로고침을 검증한다.

### 5단계: 정책·회귀 검증

정책 이탈 보고서의 항목을 별도 승인 목록으로 판정한 뒤 core test, lint, TypeScript, build, migration parity, 역할별 Chrome QA를 수행한다.

### 6단계: 배포 승인 후 배포

사용자 승인 이후에만 코드 수정, 커밋, 배포 전 preflight, 운영 배포, URL/API smoke test, rollback 확인을 실행한다.

## 5. 승인 전 결론

현재는 문서화·증거 수집 단계다. `/admin/owner/site-status` 404와 `/stores/dami-shop` 500은 우선 조사 대상이다. 나머지 200 응답은 화면 shell 성공일 뿐 기능 무결점 증거가 아니며, 역할별 인증 세션과 실제 데이터가 필요한 종단 검증 없이는 완료로 판정하지 않는다.
