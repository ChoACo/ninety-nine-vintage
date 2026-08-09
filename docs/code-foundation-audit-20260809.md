# 코드 기반 전수 감사 보고서

작성일: 2026-08-09 (Asia/Seoul)  
대상: `ninety-nine-homepage` 현재 `main` + 사용자 미커밋 작업  
감사 성격: 로컬 읽기 전용 감사. 이 보고서 외 코드·마이그레이션·설정은 수정하지 않음.

## 0. 순차 조치 결과 (2026-08-09)

이 아래의 본문은 최초 감사 당시 증거를 보존한다. 이후
`codex/code-foundation-remediation-20260809`에서 우선순위 순으로 조치했고,
현재 로컬 결합 상태는 **주요 P1/P2 조치와 실행 검증을 통과한 상태**다.

| 최초 항목 | 현재 판정 | 완료 증거 |
| --- | --- | --- |
| lockfile 취약점 5건 | `VERIFIED` | `npm audit --omit=dev`: 0건 |
| storage locator 선삭제 | `VERIFIED` | 객체 삭제 성공 후 locator 삭제, 실패 locator 재시도 보존 테스트 통과 |
| 미연결 multicloud/임의 SQL RPC | `VERIFIED` | Supabase + 조건부 R2만 등록, 임의 SQL executor 제거, 전용 사용량 RPC로 교체 |
| AI 상태·fallback·사용량 귀속 | `VERIFIED` | 실제 router 실패 주입 테스트 및 296개 core test 통과 |
| 브라우저 smoke 회귀 | `VERIFIED` | `/home → /auction/[id] → 상세 → /cart` 통과 |
| Next.js middleware 폐기 | `VERIFIED` | `src/proxy.ts` 이전 및 경고 없는 production build 통과 |
| 배송 PostgreSQL 계약 | `VERIFIED_LOCAL` | PostgreSQL 17의 00/10/20/30/40 전체 체인 통과 |
| migration/type 기반 | `VERIFIED_LOCAL` | 전체 로컬 DB reset 통과, 실제 schema에서 database types 재생성 |

추가로 전체 DB reset에서 드러난 두 역사 마이그레이션 충돌을 수정했다. 채팅
호환 함수 수리는 이미 정규화된 본문에도 안전하게 재실행되며, 일반 운영자는 한
센터에만 활성 배정되도록 advisory lock 기반으로 직렬화하되 최고 등급 소유자는
여러 센터를 총괄할 수 있다.

최종 검증: core test 296/296, ESLint, TypeScript, production build, 로컬 API/SSR,
실제 브라우저 smoke, 전체 Supabase migration reset, PostgreSQL 17 배송 SQL suite가
모두 통과했다.

남은 범위는 P3 구조 개선(대형 UI 분리, 보조 스크립트 분류·정리)과 운영 증거다.
운영 DB migration parity, 운영 RLS/trigger, 배포 환경변수, 실제 객체와 트래픽은
계속 `PRODUCTION_UNVERIFIED`이며 이번 로컬 조치로 운영 준비 완료를 주장하지 않는다.

## 1. 최종 판정

현재 결합 상태는 **기본 앱 실행은 가능하지만 승인 전 조치가 필요한 상태**다.

- `npm test` 292/292, ESLint, TypeScript, Next.js production build, 로컬 API/SSR happy path는 통과했다.
- 빌드된 App Router 121개 페이지와 89개 Route Handler는 컴파일·타입 단계에서 연결된다.
- 배송 신규 경로는 UI/API/RPC 이름까지 연결됐지만 PostgreSQL 17 실행 검증은 Docker Desktop 중단으로 이번 감사에서 재현하지 못했다.
- 실제 브라우저 smoke test는 실패했다. 서비스가 경매 상품을 장바구니에 허용한 것이 아니라 테스트가 현재 링크 기반 UI를 버튼 기반으로 잘못 검사하는 회귀 게이트 문제다.
- 즉시 수정이 필요한 확정 항목은 의존성 취약점, 멀티클라우드 정리 순서, AI 상태·사용량 계약이다.
- 운영 DB 마이그레이션, 배포 환경변수, 실제 객체·트래픽 상태는 전부 `PRODUCTION_UNVERIFIED`다.

### 판정 분포

| 등급 | 판정 |
| --- | --- |
| `VERIFIED` | 빌드·타입·린트, 292개 core test, 로컬 공개 API/SSR happy path, 배송 API 호출 연결 |
| `CONNECTED_ACTION_REQUIRED` | 배송 PostgreSQL 실행 증거, AI 결과 계약, Next.js middleware 이전, 브라우저 smoke test |
| `PARTIAL_OR_DEAD` | MultiProviderRouter/ProductService/BatchCleanupScheduler, 사용처 없는 진단 스크립트 |
| `BROKEN` | 실제 크론의 메타데이터 우선 삭제 계약, 활성화 시 호출 불가능한 multicloud SQL RPC 경계 |
| `PRODUCTION_UNVERIFIED` | 운영 migration parity, 실제 RLS/trigger, 배포 버전, 환경변수, 스토리지 객체와 사용량 |

## 2. 감사 기준선과 실행 결과

- 실제 Git 루트: `C:/Users/rlaal/Documents/Codex/ninety-nine-homepage`
- HEAD: `c36a2db`, `main == origin/main`
- 추적 파일: 702개 (`src` 383, `supabase` 136, `tests` 92, `scripts` 25 등)
- 기준 커밋 `60cc766` 이후 HEAD에 4개 커밋이 있고, 현재 배송·AI 중심 수정 파일 15개와 신규 파일 15개가 미커밋 상태다.
- `git diff --check`: 오류 없음. 단, `src/app/api/admin/owner/shipping/[id]/route.ts`와 `tests/core/p1-3-shipment-contract.test.mjs`에 향후 LF→CRLF 변환 경고가 있다.

| 검사 | 결과 | 해석 |
| --- | --- | --- |
| `npm test` | PASS, 292/292 | 넓은 계약 회귀는 통과. 61개 core 파일 중 49개가 소스 문자열 검사도 포함하므로 런타임 증거와 동일시하지 않음 |
| `npm run lint` | PASS | 현재 ESLint 규칙 위반 없음 |
| `npx tsc --noEmit` | PASS | 현재 TypeScript 표면은 결합 가능 |
| `npm run build` | PASS | Next.js 16.2.11 production build 성공. middleware 폐기 경고 발생 |
| `npm run verify:local` | PASS | `/home`, 상품 API, shop/detail/cart, 익명 checkout/payment/bid 차단 확인 |
| `npm run verify:browser` | FAIL | `verify-local-browser-happy-path.mjs:323`, 경매 상세 CTA 검사 방식이 현재 DOM과 불일치 |
| `npm run verify:canonical-shipment-db:docker` | BLOCKED | Docker Desktop Linux 엔진이 없어 PostgreSQL 17 컨테이너를 시작하지 못함 |
| `npm audit --omit=dev` | FAIL | 5건: high 3, moderate 2 |

## 3. 조치 필요 항목

### P1 — 의존성 취약점 5건이 현재 lockfile에 존재

판정: `CONNECTED_ACTION_REQUIRED`

근거:

- `package.json`의 override가 `brace-expansion 5.0.8`, `postcss 8.5.20`을 고정한다.
- 실제 설치 트리는 `brace-expansion@5.0.8`, `nanoid@3.3.16`, `postcss@8.5.20`이다.
- `npm audit --omit=dev`는 `brace-expansion`과 `nanoid` high, `postcss` moderate를 포함한 총 5건을 보고했다.

영향:

- CI/로컬 도구 체인의 서비스 거부 가능성과 source map 처리 위험이 남는다.
- 무조건적인 `npm audit fix --force`는 Next.js를 현재 선언 범위 밖으로 올릴 수 있으므로 금지한다.

완료 조건:

1. 직접 override와 상위 패키지의 호환 범위를 확인해 최소 안전 버전으로 명시 갱신한다.
2. lockfile을 재생성하고 `npm audit --omit=dev`, 전체 테스트·빌드를 모두 통과시킨다.
3. Next.js 버전 변경이 필요하면 middleware→proxy 이전과 한 변경 묶음으로 검증한다.

### P1 — 실제 storage lifecycle 크론이 객체보다 locator를 먼저 삭제

판정: `BROKEN`

근거:

- 실제 스케줄은 `vercel.json`의 `/api/cron/storage-lifecycle`이다.
- `src/app/api/cron/storage-lifecycle/route.ts:23-45`는 `multi_provider_records` ID만 조회한 뒤 테이블 행을 직접 삭제한다.
- 객체 위치인 `storage_provider_id`, `storage_key`를 읽거나 실제 Supabase/R2 객체를 삭제하지 않는다.
- 반면 사용되지 않는 `BatchCleanupScheduler.ts:17-48`는 객체 → 원본 DB → locator 순서를 명시한다.

영향:

- 메타데이터가 먼저 사라져 객체가 고아로 남고 이후 안전한 재시도·추적·용량 정산이 불가능해질 수 있다.
- delete 오류도 `deletedCount=0`으로만 응답하고 실패 원인을 성공 응답 안에 숨긴다.

완료 조건:

1. 실제 크론을 object-first 삭제 계약에 연결한다.
2. 객체 삭제 실패 시 DB/locator를 유지하고 항목별 실패를 재시도 가능하게 기록한다.
3. Supabase와 조건부 R2 각각의 성공, 객체 없음, provider 없음, 일시 실패를 실행 테스트한다.
4. 운영 적용 전 실제 객체/locator 잔존 수는 읽기 전용 preflight로 별도 확인한다.

### P1 — 멀티클라우드 기반은 런타임 미연결이며 활성화하면 SQL RPC가 호출되지 않음

판정: `PARTIAL_OR_DEAD` + 활성화 경로 `BROKEN`

근거:

- `getMultiCloudPool`, `ProductService`, `BatchCleanupScheduler`, `resetMultiCloudPool`은 `src`의 실제 앱 호출자가 없다.
- 상품 업로드는 기존 Supabase storage 경로를 직접 사용한다.
- `factory.ts:25-35`는 `.rpc("multi_provider_records_exec")`를 호출하지만 함수는 `app_private` 스키마에 생성된다.
- `20260804000000_create_multi_provider_records.sql:56`은 함수 실행 권한을 `public, anon, authenticated`에서 revoke한 뒤 `service_role`에 다시 grant하지 않는다.
- 테스트는 클래스명과 SQL 문자열 존재만 확인하며 실제 PostgREST/RPC 호출을 실행하지 않는다.

영향:

- 문서·Owner 게이지가 멀티클라우드가 작동하는 듯 보일 수 있지만 실제 상품 흐름은 사용하지 않는다.
- 향후 연결만 추가하면 첫 DB insert/read에서 권한 또는 RPC 노출 오류가 발생할 가능성이 높다.
- `multi_provider_records_exec`는 임의 SQL 문자열을 받는 강한 권한 표면이므로 단순 grant로 해결하면 안 된다.

완료 조건:

1. 현재 범위를 Supabase canonical + 명시적 R2 실험 경로로 확정하고 사용하지 않는 S3/GCS/예시 서비스는 비활성·참고 코드로 격리하거나 제거한다.
2. 범용 SQL executor 대신 목적별 고정 RPC로 교체하고 함수별 최소 권한을 부여한다.
3. 실제 업로드·정확 위치 읽기·보상 삭제·용량 계산·provider 장애 canary를 실행한다.
4. 실제 호출자가 생기기 전에는 Owner UI와 문서에서 production-active로 표시하지 않는다.

### P1 — AI 응답 상태와 사용량 귀속 계약이 아직 불일치

판정: `CONNECTED_ACTION_REQUIRED`

근거:

- `productEnhancement.ts:115-131`은 HTTP 200에 enhancement가 있으면 status 누락·알 수 없는 status를 `success`로 승격하고 AI metadata 누락도 허용한다.
- `GeminiProductEnhancer.server.ts:141-218`은 여러 모델·round의 usage를 누적하지만 최종 fallback 로그에는 `lastModelAttempted` 하나를 기록하고 응답 metadata의 model은 `null`로 돌려준다.
- `tokenTracker.ts:9-38`과 신규 migration은 DB model을 non-null로 유지한다. 응답과 DB 의미가 다르다.
- 전체 모델 실패 전 발생한 retryable HTTP 응답의 token usage는 라우터가 실패 정보에 싣지 않아 누적되지 않는다.
- 실제 routeCompletion/GeminiProductEnhancer에 fetch·logger를 주입한 실행 테스트가 없다. 현재 AI 테스트의 서버 부분은 대부분 `assert.match` 기반이다.

영향:

- 오래되거나 불완전한 서버 응답이 정상 AI 적용으로 위장될 수 있다.
- 비용·모델별 성공률·fallback 횟수가 잘못 집계되어 Owner 게이지가 신뢰할 수 없게 된다.

완료 조건:

1. 네 상태와 `ai` envelope를 런타임 스키마로 엄격 검증하고 누락/unknown은 `failed`로 처리한다.
2. 모델 시도별 usage 행 또는 nullable aggregate + `attempted_models` 계약 중 하나로 통일한다.
3. fetch와 usage logger를 주입해 primary 실패→fallback 성공, 전 모델×3 round 실패, JSON 파싱 실패, logger 실패를 실제 실행한다.
4. `success`/`partial_fallback`만 값을 적용하고 다른 상태는 원본을 보존하는 UI·XLSX 실행 테스트를 유지한다.

### P2 — 브라우저 회귀 스크립트가 현재 CTA 구조를 잘못 검사

판정: `CONNECTED_ACTION_REQUIRED`

근거:

- 실패 위치는 `scripts/verify-local-browser-happy-path.mjs:310-324`다.
- 스크립트는 `.mobile-detail-cta` 내부에서 장바구니/입찰 `button`을 동시에 찾는다.
- 현재 경매 분기 `StickyBidPanel.tsx:641-670`은 입찰 CTA를 `Link`로 렌더링하며 장바구니 버튼을 아예 렌더링하지 않는다.
- 실제 장바구니 API는 `reserve_fixed_product_for_cart`만 호출하고 GET도 `sale_type='fixed'`로 제한한다.

영향:

- 정상 경매 경계를 브라우저 검증이 실패로 보고해 배포 게이트의 신뢰도가 떨어진다.

완료 조건:

1. 경매 상세에서는 입찰 링크 존재 + 장바구니 CTA 부재를 검사한다.
2. 고정가 상세에서는 장바구니·즉시구매 버튼 존재를 별도 fixture로 검사한다.
3. UI selector가 아니라 접근 가능한 role/name 또는 명시적 안정 data attribute를 사용한다.

### P2 — Next.js 16 middleware 파일 규약이 폐기됨

판정: `CONNECTED_ACTION_REQUIRED`

근거:

- production build는 성공했지만 `The "middleware" file convention is deprecated. Please use "proxy" instead.`를 출력했다.
- 현재 핵심 canonical host, 모바일 리디렉션, API IP 차단이 `src/middleware.ts:25-167`에 집중돼 있다.

영향:

- 현재는 동작하지만 다음 Next.js 업그레이드에서 핵심 라우팅·보안 전처리 경계가 깨질 수 있다.

완료 조건:

1. 공식 codemod/규약에 따라 `proxy`로 이전한다.
2. apex 308, 모바일 307 및 path/query 보존, 정적 경로 제외, API 전용 IP 검사 회귀를 재실행한다.
3. production build에서 폐기 경고가 사라져야 한다.

### P2 — 배송 코드는 연결됐지만 현재 SQL 실행 승인은 없음

판정: `CONNECTED_ACTION_REQUIRED`

근거:

- 신규 legacy eligible read, legacy-order command, compatibility read API가 실제 RPC를 호출한다.
- 고객 Dashboard와 v2/legacy 모드 분리도 core contract에서 확인된다.
- PostgreSQL 17 suite는 Docker 엔진 부재로 시작하지 못했다.
- 292개 core test의 배송 검증 상당수는 SQL/소스 문자열 계약이며 trigger·revoke·SECURITY DEFINER 동작을 대신하지 못한다.

영향:

- migration 순서, 함수 signature grant, trigger firing, 익명화 호환을 현재 작업 트리 기준으로 승인할 수 없다.

완료 조건:

1. Docker Desktop을 실행하고 canonical suite 전체를 현재 diff에서 다시 통과시킨다.
2. `00-bootstrap`부터 신규 30/40 SQL까지 실행 순서와 결과를 남긴다.
3. 그 후에도 운영 migration parity·행 수·trigger 활성은 `PRODUCTION_UNVERIFIED`로 별도 확인한다.

### P3 — 테스트와 보조 스크립트에 구조적 부채가 누적

판정: `CONNECTED_ACTION_REQUIRED` / 일부 `PARTIAL_OR_DEAD`

근거:

- 61개 core test 파일 중 49개가 소스 문자열 검사를 포함하고 런타임 import를 확인한 파일은 15개다.
- `scripts/test-regex.mjs`는 특정 테스트 정규식을 수동 디버깅하는 일회성 스크립트이며 package script·문서 참조가 없다.
- `verify_env.mjs`, `check-db-products.mjs` 등 여러 스크립트가 실행 진입점·문서·안전 등급 없이 남아 있다.
- `AccountDashboard.tsx` 약 1,947줄, `OperatorProductsConsole.tsx` 약 1,344줄로 상태·네트워크·표시 책임이 집중돼 있다.
- 신규 RPC가 생성 타입에 반영되지 않아 `as unknown as RpcClient` 우회가 API 전반에 반복된다.

영향:

- 문자열이나 UI 문구만 남아도 테스트가 통과할 수 있고, 거대 컴포넌트의 작은 수정이 서로 다른 흐름을 손상시키기 쉽다.
- RPC signature drift를 TypeScript가 잡지 못한다.

완료 조건:

1. 보조 스크립트를 `verification / maintenance / destructive`로 분류하고 진입점·필수 환경·읽기/쓰기 여부를 문서화한다.
2. 일회성 디버그 스크립트는 제거하거나 정식 회귀 테스트로 흡수한다.
3. migration 확정 후 database types를 재생성해 신규 RPC의 수동 cast를 제거한다.
4. 큰 UI는 상태 머신/데이터 hook/표시 섹션 단위로 나누되 동작 변경 없이 characterization test를 먼저 둔다.

## 4. 정상 연결 및 기반이 확인된 영역

- Next.js 16 비동기 `params` 계약은 조사된 동적 page/route에서 `Promise` + `await` 형태를 사용한다.
- 사용자 인증이 필요한 배송 API는 member authentication을 통과한 user-scoped RPC client를 사용한다.
- v2 배송 요청은 정확한 body key, UUID, 중복/100개 상한, 크레딧, SQLSTATE별 오류를 검증한다.
- legacy shipment writer는 기존 테이블 재기록이 아니라 v2 command로 위임하는 구조다.
- 장바구니 서버 mutation은 고정가 전용 RPC로 제한돼 브라우저 테스트 실패가 서버 구매 우회로 이어지지 않는다.
- Supabase 신규 migration 다수는 revoke/grant, RLS/force RLS, `search_path` 고정을 적극 사용한다. 다만 실제 운영 적용은 별도 증거가 필요하다.
- 배포 빌드, 타입, 린트가 모두 통과해 즉시 컴파일 파손이나 전체 연결 단절은 발견되지 않았다.

## 5. 후속 수정 순서

### 단계 1 — 검증 기반 복구

- 브라우저 smoke test를 현재 경매/고정가 CTA 계약에 맞춘다.
- Docker PostgreSQL 17을 실행해 배송 SQL suite를 재검증한다.
- 의존성 취약점을 최소 버전 변경으로 해소하고 전체 기준선을 다시 통과시킨다.

완료 게이트: audit 0건 또는 승인된 예외, 브라우저 PASS, 배송 SQL `SUITE-PASSED`, core/lint/type/build PASS.

### 단계 2 — 데이터·정리 불변식 보강

- storage lifecycle을 object-first·retryable cleanup으로 교체한다.
- 범용 `multi_provider_records_exec`를 목적별 RPC로 축소하고 권한/호출 표면을 실행 검증한다.
- 실제 지원 provider 범위를 문서와 Owner UI에 동일하게 반영한다.

완료 게이트: 객체 실패 시 locator 보존, provider별 canary, 고아 객체/행 검출 보고서, 관련 없는 provider 비활성.

### 단계 3 — AI 계약 통일

- 응답 envelope를 엄격 검증한다.
- 모델별 시도/usage 저장 계약을 확정하고 DB·서버·Owner 집계를 함께 변경한다.
- 실제 router/enhancer 실패 주입 테스트를 추가한다.

완료 게이트: 누락/unknown status가 적용되지 않고, 모델·토큰·상태 집계가 fixture와 일치.

### 단계 4 — 프레임워크·타입 기반 정리

- middleware→proxy 이전을 수행한다.
- database types 재생성 후 RPC cast를 단계적으로 제거한다.
- 거대 UI를 동작 보존형으로 분해하고 정적 문자열 테스트를 실행 테스트로 교체한다.

완료 게이트: 폐기 경고 없음, 신규 RPC cast 없음, 핵심 사용자 흐름별 실행 회귀 존재.

### 단계 5 — 운영 읽기 전용 검증

- 로컬 수정과 검증을 모두 마친 뒤에만 migration parity, 배포 버전, trigger/grant/RLS, 객체/locator 잔존, 실제 traffic 경로를 읽기 전용으로 확인한다.
- 확인 전에는 운영 준비 완료로 표시하지 않는다.

## 6. 보존 및 경계

- 감사 중 사용자 소유 배송·AI 미커밋 코드는 수정·포맷·정리하지 않았다.
- 운영 DB, 배포, migration 적용, 외부 provider 쓰기 작업은 수행하지 않았다.
- `.env.local`의 값이나 비밀 키는 보고서에 출력하지 않았다.
- `npm audit`은 registry advisory 조회만 수행했고 자동 수정은 실행하지 않았다.
- 이 보고서 작성 후 Git 상태를 다시 비교해 기존 변경에 보고서 1개만 추가됐는지 확인한다.
