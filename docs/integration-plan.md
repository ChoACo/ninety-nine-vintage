# 기존 사이트 기능 이식 계획

기존 프로젝트(`C:\Users\rlaal\Documents\홈페이지`)는 읽기 전용으로 분석했다. `.env.local`, 배포 설정, 빌드 산출물, `node_modules`, Git 이력은 이식 대상에서 제외했다.

| 원본 영역 | 현재 프로젝트 이식 위치 | 적용 방식 |
| --- | --- | --- |
| Supabase 브라우저/서버 클라이언트 | `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts` | 공개 키와 service-role 키를 분리하고 서버 클라이언트는 `server-only`로 보호 |
| `database.types.ts` | `src/lib/supabase/database.types.ts` | 원본 타입 파일 그대로 복사 |
| 상품 조회/상태 | `src/services/products.ts`, `src/app/api/products/route.ts` | active 상품 조회, DB 응답 정규화, 공개 입찰자 마스킹 |
| 경매 입찰/RPC | `src/services/auction.ts`, `src/app/api/auction/bids/route.ts` | 사용자 Bearer 토큰으로 `place_bid` RPC 호출, DB가 최종 규칙 판정 |
| 입찰 정책/공유 시계 | `src/utils/auctionBidPolicy.ts`, `src/hooks/useAuctionPolicyClock.ts` | 20:56/21:00/22:00 정책과 서버 시간 동기화 로직 유지 |
| 계좌이체 | `src/services/manualPayments.ts`, `/api/payments/manual-transfer` | `begin_manual_transfer`/`confirm_manual_transfer` RPC를 사용자 세션으로 호출 |
| PortOne 서버 검증 | `src/lib/portone/server.ts`, `src/services/portone/server.ts` | 단건 조회, 금액·스토어·채널 검증, 중복 시도 원장과 수동이체 충돌 차단 |
| PortOne 브라우저 결제 | `src/services/portone/payment.ts` | 공개 Store/Channel만 브라우저에 사용하고 준비·동기화는 API 경유 |
| Kakao OIDC | `src/lib/kakao/oidc.ts`, `src/app/api/auth/kakao/*` | state/nonce HttpOnly 쿠키와 origin 검증 유지 |
| Owner 결제 운영 모드 | `src/lib/ownerAccess/server.ts`, `/api/owner/payment-mode` | 소유자·Kakao·role 검증 후 RPC 실행 |
| PortOne API | `/api/payments/prepare`, `/api/payments/sync`, `/api/webhook/portone` | 서버 주문 금액 검증, webhook 서명 검증, manual transfer 모드 차단 |
| DB 마이그레이션 | `supabase/migrations/` | 원본 SQL 37개를 순서와 내용 그대로 파일 이식; 자동 실행하지 않음 |

현재 Supabase 스키마의 `products`, `auction_bids`, `payment_*`, `manual_transfer_*` RPC와 현재 프로젝트의 클라이언트 환경변수 이름을 연결했다. 실제 프로젝트의 Supabase URL/키가 없으므로 데이터베이스 연결 및 migration push는 실행하지 않았다.
