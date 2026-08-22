# 마스터 리빌드 현재 상태 실행 계획

기준일: 2026-08-23 (Asia/Seoul)  
기준 브랜치: `codex/center-commerce-rebuild`

## 1. 적용 원칙

- 첨부 지시서를 새 프로젝트 사양으로 덮어쓰지 않고, 현재 코드와 `docs/project-master-20260810.md`의 확정 정책을 우선한다.
- 센터는 매장이며 운영자와 직원은 배정된 매장 범위만 사용한다. 소유자만 전역 또는 명시적으로 선택한 매장 범위를 사용한다.
- 결제는 소유자가 확인하는 수동 계좌이체만 실행한다. PortOne 및 준비 중 PG 결제 실행 경로는 복구하지 않는다.
- 배송은 매장 또는 연결된 통합 물류 그룹 단위다. 연결되지 않은 매장끼리 배송비, 배송 요청, 송장을 공유하지 않는다.
- 정산은 최신 실행 계약인 월요일·목요일 18:00 KST를 유지한다.
- 과거 마이그레이션과 회계·감사 이력은 삭제하지 않는다. 최신 실행 함수에서 폐기된 검증과 과거 기록에 남은 문자열을 구분한다.

## 2. 현재 상태 판정

| 영역 | 판정 | 현재 증거 | 후속 작업 |
| --- | --- | --- | --- |
| 전역 테마·레이아웃 | 구현됨 | semantic `paper/ink/surface/line` 토큰, 단일 문서 스크롤, 통합 sticky 헤더 | 실제 360/768/1024/1440 브라우저 회귀 확인 |
| 모바일 내비게이션 | 구현됨 | `MobileSiteBottomNav`, PWA 전용 모바일 레이아웃 | 설치 모드와 일반 Safari/Chrome safe-area 확인 |
| 홈·라이브·숍·센터몰 | 구현됨 | 모바일 2열, 태블릿 3열, 데스크톱 4열 그리드와 상세 split view | 실제 데이터가 많은 상태에서 CLS·overflow 확인 |
| 장바구니·찜 | 구현됨 | 단일 재고, 센터별 그룹, 보관/즉시배송 견적, 서버 실패 시 복구 UI | 인증 회원의 점유 만료·중복 클릭 브라우저 확인 |
| MY·결제 연결 | 구현됨 | 낙찰 결제가 `/checkout?type=auction&id=...`로 연결됨 | 소유자 테스트 회원으로 낙찰 결제 종단간 확인 |
| 역할별 알림·채팅 | 구현됨 | 역할별 동적 탭, 깊은 링크, PWA push, 매장 범위 채팅 | 활성 상담 매장과 역할별 실제 세션 확인 |
| 운영자·소유자 IA | 구현됨 | sales/orders/auctions/products/shipping/platform 경로 분리 | 인증 역할별 직접 URL·403·선택 매장 범위 확인 |
| 원스톱 출고 | 구현됨 | `complete_inventory_shipment_with_tracking` 최신 RPC와 원스톱 UI | 원격 DB 마이그레이션 패리티 후 격리 데이터 mutation 확인 |
| 배송 추적·D+1 확정 | 구현됨 | 배송 추적 cron과 `auto_settle_at` 계약 | 택배사 API 환경변수와 cron 운영 로그 확인 |
| 월·목 정산·이월 | 구현됨 | 정기 정산 RPC, 이월 횟수와 연체 알림, 소유자 지급 데스크 | 18:00 KST 스케줄과 격리 정산 생성 확인 |
| PWA·Web Push | 구현됨 | manifest, service worker, 구독/발송 API, 설치 안내 | VAPID/Vault 비밀값과 실제 모바일 background push 확인 |

## 3. 반드시 남겨야 하는 호환·역사 경계

- 과거 migration 안의 `미 출고된 상품이 존재합니다` 문구는 이미 적용된 DB 이력이라 수정하거나 삭제하지 않는다.
- 운영자 배송 API의 `UNRELEASED_ITEMS` 변환은 구버전 DB 응답을 구조화하는 호환 처리다. 최신 원스톱 RPC는 이 검증을 실행하지 않는다.
- 모달, 채팅 메시지 목록, 알림 목록의 `overflow-y-auto`는 viewport scroll trap이 아니라 제한된 overlay 내부 스크롤이므로 유지한다.
- 우편번호 iframe의 흰 배경과 이미지 위 가독성 overlay는 외부 서비스/콘텐츠 대비 목적이므로 전역 다크 토큰 치환 대상에서 제외한다.

## 4. 실행 순서

### 단계 1 — 저장소와 DB 계약 게이트

1. 작업 트리와 원격 차이를 보존한다.
2. 전체 core test, ESLint, production build를 각각 독립 실행한다.
3. migration parity를 확인하고 원격 미적용 migration을 정확히 열거한다.
4. 로컬 Supabase가 가능하면 최신 두 migration을 실제 적용해 RPC 반환 shape와 RLS/GRANT를 검증한다.

완료 기준: 정적 검증 실패 0, 미적용 migration과 미검증 사유가 명확함.

### 단계 2 — 결제·보관·배송 우선 검증

1. 낙찰 결제 deep link와 checkout 선택 상품 로딩 계약을 확인한다.
2. 즉시배송과 보관 선결제 배송비가 동일한 매장 entitlement 원천을 사용하는지 확인한다.
3. 원스톱 송장 등록이 shipment와 연결 inventory를 한 트랜잭션에서 갱신하는지 확인한다.
4. 보관 시작일이 결제 완료 시각이며 D-Day 수량과 렌더 목록이 같은 배열에서 계산되는지 확인한다.

완료 기준: 관련 계약 테스트 통과, 격리 DB가 없으면 mutation은 `미검증`으로 명시.

### 단계 3 — RBAC·센터 범위·알림 검증

1. 운영자/직원은 배정 매장을 자동 바인딩하고 수동 센터 선택 UI가 없는지 확인한다.
2. 소유자만 전역/센터 scope를 바꿀 수 있는지 확인한다.
3. 일반 회원에게 운영자/소유자 알림이 노출되지 않는지 확인한다.
4. 알림 deep link와 채팅 store context가 다른 센터 데이터를 섞지 않는지 확인한다.

완료 기준: API, UI, RLS 계약 테스트와 역할별 브라우저 smoke가 모두 일치.

### 단계 4 — 화면·반응형·접근성 검증

1. 360, 412, 768, 1024, 1440px에서 홈, 라이브, 숍, 센터몰, 장바구니, MY를 확인한다.
2. 관리자 sales/orders/shipping/platform에서 중첩 viewport 스크롤과 가로 overflow를 확인한다.
3. sticky header, sticky summary, modal z-index, 키보드 focus, 44px 터치 타깃을 확인한다.
4. 의미 없는 hardcoded light surface만 semantic token으로 교체하고 외부 iframe/overlay 예외는 유지한다.

완료 기준: 문서 scrollbar 하나, 콘텐츠 잘림 없음, 주요 CTA 키보드 접근 가능.

### 단계 5 — 운영 연동과 릴리스 준비

1. 배송 추적, D+1 자동 확정, 월·목 18:00 정산 cron의 인증과 환경변수를 점검한다.
2. PWA 설치와 background push의 VAPID/Vault 설정을 점검한다.
3. 원격 migration을 적용한 뒤 migration parity를 재확인한다.
4. 배포 요청이 별도로 확인된 경우에만 push/deploy하고 `/BUILD_ID`, 공개 경로, 인증 역할 경로를 smoke test한다.

완료 기준: 원격 migration parity, 배포 commit과 BUILD_ID 일치, production smoke 성공.

## 5. 현재 즉시 차단 요인

- 로컬 브랜치는 원격보다 5개 커밋 앞서 있어 아직 공유/배포되지 않은 변경이 있다.
- 원격 DB에는 `20260822194130_add_member_profile_avatars.sql`, `20260822195048_unify_store_shipping_entitlements.sql` 두 migration이 미적용 상태다.
- Docker 기반 로컬 Supabase가 실행되지 않으면 SQL mutation의 실제 실행 검증은 정적 계약 테스트까지만 가능하다.
- 이번 요청은 작업 계획과 로컬 작업 승인으로 해석하며, 원격 DB 적용과 production 배포는 별도 명시적 배포 요청 전에는 수행하지 않는다.
