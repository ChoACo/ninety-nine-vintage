# 역할별 Chrome QA 및 운영 조치 보고서

- 실행일: 2026-08-09 (Asia/Seoul)
- 대상: `ninety-nine-homepage`, `https://www.ninety-nine-vintage.store`
- 방식: 연결된 Chrome의 PC·390×844 모바일 화면, 콘솔, 네트워크 응답, 격리 로컬 Supabase 실제 세션, 운영 소유자 실제 세션
- 보호 경계: 기존 운영 회원·상품·주문·결제·배송·환불 행은 수정하지 않았다. 운영 쓰기는 소유자 3분 회원 모드 활성화와 즉시 종료만 수행했다.

## 결론

공개 화면과 회원·밴드회원·운영자·직원·소유자 권한 경계는 로컬 실제 세션에서 통과했다. 운영에서는 비회원 PC·모바일 공개 화면과 기존 소유자 세션, 소유자의 회원 모드를 확인했다. 감사 중 깨끗한 로컬 DB에서 공개 상품 API 503과 소유자 플랫폼 API 503을 발견해 최소 권한 migration으로 수정했으며, 역할 QA에 필요했던 밴드회원·직원 로컬 계정도 추가했다.

## 발견 및 조치

### QA-01 · P1 · 공개 상품 API가 깨끗한 DB에서 503

- 재현: 비회원 `GET /api/products?limit=24&offset=0`
- 경로: 공개 상품 조회 → `products.store_id` → `stores(name, slug)` 관계 조회
- 원인: `stores`에 공개 RLS 정책은 있었지만 `anon`/`authenticated`의 테이블 열 권한이 없었다.
- 영향: 신규 환경과 전체 DB reset 뒤 홈·경매·즉시구매 카탈로그가 로딩 실패한다.
- 조치: `stores` 전체 권한을 회수한 뒤 공개 카탈로그에 필요한 `id`, `name`, `slug`만 SELECT 허용했다. `operator_id`, `business_id`는 계속 차단된다.
- 재검증: 로컬 API 200, 전체 DB reset 통과, 운영 postflight에서 세 공개 열만 허용되고 `operator_id`는 거부됨을 확인했다.

### QA-02 · P1 · 소유자 플랫폼 API가 깨끗한 DB에서 503

- 재현: 소유자 `/admin/owner/platform`
- 경로: 브라우저 → `/api/admin/owner/platform` → service-role RPC → `get_owner_store_platform_management()`
- 원인: 서버가 service role로 RPC를 호출하지만 함수 EXECUTE는 `authenticated`에만 부여돼 있었다.
- 영향: 소유자가 출고 그룹·회원제·정산 설정을 읽을 수 없다.
- 조치: route의 소유자 인증과 함수 내부 `is_owner()` 검사는 유지하고 `service_role` EXECUTE만 추가했다. 화면도 모든 로드 실패를 “세션 실패”로 오표시하지 않고 실제 오류를 표시하도록 고쳤다.
- 재검증: 로컬과 운영 Chrome에서 플랫폼 관리 화면 정상 로딩, 운영 권한 postflight 통과.

### QA-03 · P2 · 역할별 로컬 실제 세션 부족

- 재현: 로컬 로그인 화면에 회원·운영자·소유자만 존재.
- 영향: 밴드회원의 결제 정책과 직원의 배정 매장 권한을 실제 세션으로 회귀 검증할 수 없었다.
- 조치: 로컬 전용·명시적 활성화 경계 안에 밴드회원과 직원을 추가했다. 직원은 운영자 1의 활성 매장에 `prepare_orders`만 허용한 최소 권한 membership으로 배치된다.
- 재검증: 밴드회원 계정 화면, 직원 업무·문의·출고·택배 화면 통과. 직원의 운영자·소유자 센터 접근은 거부됨.

### QA-04 · P2 · 로그아웃 후 화면 전환이 보장되지 않음

- 재현: 로그인 상태에서 로그아웃 버튼 선택 후 현재 화면과 역할 링크가 남을 수 있음.
- 원인: push 구독 해제와 두 로그아웃 요청 완료 뒤 명시적 이동이 없고, Service Worker 조회·해제가 지연되면 흐름이 끝나지 않았다.
- 조치: push 정리를 시간 제한형 best-effort로 만들고, 인증 로그아웃도 최대 대기시간 뒤 로그인 화면으로 이동하도록 보강했다.
- 재검증: 알림·공개 캐시 안내를 닫은 실제 클릭 순서에서 `/account/login` 이동을 확인했다.

### QA-05 · P2 · 배포 식별 경로 부재

- 재현: 운영 `GET /BUILD_ID`가 404.
- 영향: 실제 도메인이 어느 커밋을 제공하는지 배포 직후 단정할 수 없다.
- 조치: Vercel 커밋 SHA만 평문·`no-store`로 반환하는 `/BUILD_ID`를 추가했다. 로컬은 `development`를 반환한다.

## 역할·화면 매트릭스

| 역할 | 환경 | 확인 범위 | 결과 |
|---|---|---|---|
| 비회원 | 로컬·운영 | 홈, 경매, 즉시구매, 판매완료, 매장, 약관, 개인정보, 환불, 장바구니 로그인 유도 | 통과 |
| 회원 | 로컬 실제 세션 | 계정, 장바구니, 채팅, 입찰, 빈 상태, 모든 관리자 직접 URL 거부 | 통과 |
| 밴드회원 | 로컬 실제 세션 | 회원 화면, 밴드회원 역할 생성, 결제 기한·면제 정적/DB 계약 | 통과 |
| 운영자 | 로컬 실제 세션 | 메인, 센터, 채팅, 예외, 출고, 플랫폼, 상품, 배송, 보관, 낙찰회원; 소유자·직원 화면 거부 | 통과 |
| 직원 | 로컬 실제 세션 | 업무 현황, 문의, 출고·보관, 택배·송장; 운영자·소유자 화면 거부 | 통과 |
| 소유자 | 로컬·운영 실제 세션 | 개요, 회원·탈퇴회원, 결제, 플랫폼, 환불, 매장, 운영자·직원 센터 | 통과 |
| 소유자 회원 모드 | 운영 실제 세션 | 3분 활성화, 회원 권한 UI, 즉시 종료와 `/home` 복귀 | 통과·복구 완료 |
| 모바일 | 로컬·운영 Chrome 390×844 | `/m` 홈·경매·구매·판매완료·계정·장바구니·채팅·정책 | 통과 |

## DB migration

운영 사전검사 시 장바구니 0, 활성 예약 0, 배송 요청 0, 구형 commerce shipment 0, AI 사용 로그 0이었다. 따라서 관련 없는 운영 이력 충돌 없이 다음 6개 migration을 적용했다.

- `20260807000000_cart_reservation_abuse_limits.sql`
- `20260808000000_retire_commerce_shipment_writes.sql`
- `20260808120000_add_ai_usage_status_column.sql`
- `20260809041957_retire_multicloud_raw_sql_executor.sql`
- `20260809042244_clarify_ai_usage_attempts.sql`
- `20260809095020_grant_public_store_catalog_columns.sql`

적용 후 138개 migration parity, 배송 쓰기 방지 trigger 1개, commerce history 불변 trigger 5개, AI 상태·시도 모델 열, raw multicloud executor 제거, 제한된 매장 열 권한을 확인했다. CLI의 migration catalog 캐시 단계에서 로컬 인증서 파일 경고가 있었지만 migration 적용과 원격 parity는 모두 성공했다.

## 자동 검증

- core test: 298/298 통과
- ESLint: 통과
- TypeScript: 통과
- Next.js production build: 121개 페이지 생성 포함 통과
- production dependency audit: 취약점 0
- 전체 로컬 Supabase reset: 통과
- PostgreSQL 17 canonical shipment SQL suite: 통과
- migration parity: 138/138 통과

Supabase Advisor에는 기존의 INFO 수준 RLS-no-policy 및 unused-index 항목이 다수 남아 있다. RPC-only/서버 전용 테이블과 신규·저사용 인덱스가 섞여 있어 이번 역할 QA 수정 범위에서 일괄 삭제하거나 공개 정책을 추가하지 않았다.

## 배포 결과

- 배포 커밋: `ac4dd5a3bef157c01ccf98897c6183e665e6be20`
- Vercel production deployment: `dpl_HvX3LmmDjfdgWay62Ns8ijxY614x` (`ninety-nine-vintage-ksm6o6wq1-choa-co.vercel.app`)
- `/BUILD_ID`: 배포 커밋 전체 SHA 반환, `no-store`
- apex → www: 308 Permanent Redirect
- 운영 최종 smoke: `/home`, `/api/products`, `/api/site/status` 200; 모바일 `/m/home`과 소유자 플랫폼 Chrome 콘솔 오류 없음

배포 전 구버전 모바일 bundle에서 한 차례 React hydration 오류가 관찰됐으나, 새 production 배포의 깨끗한 모바일 Chrome 탭에서는 재현되지 않았다.

## 남은 경계

- 밴드회원·운영자·직원의 운영 로그인은 계획에 따라 수행하지 않았고, 로컬 실제 세션 및 운영의 소유자 권한 화면/API 경계로 검증했다.
- 결제·환불·배송·계정 영구 삭제의 운영 성공 쓰기는 기존 실사용 이력 보호를 위해 실행하지 않았다. 격리 로컬의 DB 계약과 빈 상태·접근 거부를 검증했다.
