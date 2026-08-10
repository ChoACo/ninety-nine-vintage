# 포렌식 결과 2차 — 실제 운영 화면·연동 검증

기준일: 2026-08-10 (Asia/Seoul)
검증 방식: production HTTP read-only, 실제 브라우저 세션 DOM·console read-only, Supabase integration script, migration parity, core test, lint, build
변경 범위: 코드·DB·환경·배포 변경 없음

## 1. 기준선 결과

- Git HEAD: `3d8e56a`
- migration parity: 157개 통과
- core test: 335개 중 329 pass, 0 fail, 6 skip
- ESLint: 통과
- TypeScript/production build: 통과
- Supabase products/stores/orders/payment/order-items/site_status/auction clock/manual transfer/Realtime: 통과
- `verify:integrations`: 실패 — `KAKAO_OIDC_REDIRECT_URI` 누락
- 작업 트리: 검증 전후 clean

## 2. production URL 결과

### 정상 HTTP shell

`/home`, `/feed`, `/shop`, `/chat`, `/account`, `/cart`, 지정된 owner/operator/employee 하위 URL은 HTTP 200을 반환했다. 단, 관리자 200은 인증 후 기능 성공을 의미하지 않는다.

### 실제 오류

- `/admin/owner/site-status`: HTTP 404
- `/stores/dami-shop`: HTTP 500

### 비인증 API 경계

다음 API는 비인증 직접 요청에서 401을 반환했다: `/api/chat`, `/api/chat/unread`, `/api/cart`, `/api/account/addresses`, `/api/admin/operator/store-scope`, `/api/admin/operator/products`, `/api/admin/operator/fulfillment`, `/api/admin/owner/overview`, `/api/admin/owner/payment-confirmation-requests`, `/api/owner/member-mode`, `/api/cron/storage-lifecycle`, `/api/cron/storage-policy`.

이는 비인증 차단 증거이지 인증 역할별 성공 증거는 아니다.

## 3. 실제 브라우저 세션 증거

### 소유자 센터

`/admin/owner`에서 다음 상태가 실제 렌더링됐다.

- 운영 중인 센터 2개
- 결제 완료 거래 합계 0원
- 감사 로그 1153건
- 수동 계좌이체 계좌가 화면에 표시됨
- 사이트 상태가 “점검 중”으로 표시되고 안내 문구가 존재함
- “3분간 회원 권한 활성화” 버튼이 표시됨

판정: 소유자 화면 shell과 일부 데이터는 연결되지만, 계좌·site status·member mode mutation의 성공·실패·감사 결과는 아직 수행하지 않았다.

### 소유자 입금 확인

`/admin/owner/payments`에서 다음 상태가 실제 렌더링됐다.

- 제목: `12시간 이상 대기 요청 1건`
- 구매자: `민승`
- 주문: `ff6df77e` prefix
- 재알림: 0회
- 최초 요청: `2026. 8. 10. 오후 7:49:03`
- 경과: `3시간 경과`
- 금액: 4,100원

판정: **정책·UI 데이터 충돌이 실제 확인됐다.** 제목의 12시간 cutoff와 행의 3시간 경과가 일치하지 않는다. RPC cutoff, timestamp timezone, request status, elapsed_seconds 계산 중 하나 이상을 read-only DB와 대조해야 한다. 이 상태에서는 긴급 입금 큐를 정상 운영으로 판정할 수 없다.

### 운영자 센터

`/admin/operator`, `/admin/operator/products`, `/admin/operator/fulfillment`, `/admin/operator/chat`에서 다음이 반복됐다.

- 상단 scope selector: `store_scope_unavailable`
- 재시도 버튼: `다시 시도`
- 상품 화면 status: `operator_store_scope_required`
- 출고 화면 status: `센터를 다시 선택해 주세요.`
- 채팅: 담당 매장 상담 없음, 답변 입력 disabled
- 대시보드 숫자: 공개 상품 0, 입금 대기 0, 배송 요청 0, 매출 0원

판정: **운영자 업무는 센터 scope 단계에서 연쇄 차단된다.** 화면은 로드되지만 상품·출고·채팅을 실제 운영할 수 없다. 현재 세션이 owner support인지 operator assigned인지, scope RPC가 어떤 행을 반환하는지 확인하지 못했으므로 원인은 미확정이다.

### 직원 센터

`/admin/employee/fulfillment`와 `/admin/employee/inquiries`에서 다음이 반복됐다.

- 직원 메뉴와 화면 shell은 렌더링됨
- 출고 화면: `센터를 다시 선택해 주세요.`
- 문의 화면: 담당 매장 상담 없음, 답변 입력 disabled

판정: 직원 화면의 `allowEmployee` 인증 경로가 존재해도 실제 assigned store와 conversation routing이 연결된 증거가 없다. 직원 업무 정상 판정 불가.

### 계정 화면

`/account`에서 다음이 실제 렌더링됐다.

- 로그인 상태는 표시됨
- `일부 계정 정보를 불러오지 못했습니다. 다른 메뉴는 계속 이용할 수 있습니다.`
- 낙찰품·보관·배송·찜 수치가 00 또는 0으로 표시
- 배송지 선택, 배송 크레딧 결제 신청, 환불 진행, 찜, 입찰 현황 섹션은 렌더링됨

판정: 계정의 일부 API가 실패했거나 빈 상태를 오류로 묶고 있다. 어떤 API가 실패했는지 UI에서 식별할 수 없으므로 회원 운영 정상 판정 불가.

### 콘솔 오류

확인한 owner/operator/employee/account 주요 페이지의 브라우저 console error/warn은 수집 시점에 없었다. 이는 서버 API·권한·데이터 계약 오류가 console에 기록되지 않는다는 뜻일 수 있으므로 정상 증거로 사용하지 않는다.

## 4. 단계별 판정 업데이트

### 0단계 증거 고정 — 부분 완료

HTTP, DOM, console, migration parity, integration script, core/lint/build 증거를 확보했다. Vercel function log·Supabase production read-only row/RPC 결과·Kakao redirect 운영값은 아직 부족하다.

### 1단계 차단 오류·진입점 — 실패 확인

site-status 404, store slug 500, operator scope 오류, payment cutoff/UI 충돌, account partial error가 실제 확인됐다.

### 2단계 역할·scope·member mode — 미완료·운영 불가 후보

owner 화면은 접근되지만 operator/employee 업무가 scope에서 막혔다. 실제 role membership·scope row·member mode transition을 DB read-only와 API trace로 연결하지 못했다.

### 3단계 업무 종단 — 미실행

운영 데이터 보호를 위해 상품 등록, 카트 점유, 입금 기록, 배송 mutation, 채팅 전송, 환불, 정산 mutation을 실행하지 않았다. 따라서 업무 종단 정상 판정은 불가하다.

### 4단계 외부 연동 — 부분 완료

Supabase read-only/Realtime은 통과했지만 Kakao redirect 누락, Vercel cron 실제 실행, Redis, AI, Push, storage canary, 배송 provider는 미완료다.

## 5. 권장 조치 우선순위

1. payment confirmation RPC와 실제 행을 read-only로 대조해 12시간 제목/3시간 표시 충돌 확정
2. 현재 브라우저 세션의 role, operator membership, selected scope, expiry, accessMode를 read-only로 확인
3. `store_scope_unavailable`를 RPC·membership·store query·mode 불일치별로 분리
4. `/stores/[slug]` 500을 unknown slug 404와 backend 503으로 분리
5. Kakao OIDC redirect 운영 환경값과 callback trace 확보
6. 계정 각 API의 실패 상태·재시도 경로 분리
7. 사용자 승인 후에만 격리 테스트 데이터로 업무 종단 mutation을 실행

## 6. 현재 운영 가능성 결론

현재 판정은 **운영 불가 후보**다. 소유자 화면 일부는 데이터와 연결되지만, 운영자·직원 업무가 scope에서 차단되고, 긴급 입금 큐의 정책 시간 표시가 실제 충돌하며, 계정 부분 오류와 공개 404/500이 존재한다. 코드 수정·DB 변경·배포 승인은 추가 read-only 원인 확정과 사용자 승인 이후로 보류한다.
