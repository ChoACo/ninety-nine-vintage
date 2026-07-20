# 단일 코드베이스 통합 검증

검증일: 2026-07-20 (Asia/Seoul)

## 통합 범위

- 기존 Host의 Supabase, PortOne, Kakao OIDC, 보안, 운영자 기능을 유지했습니다.
- 분리되어 있던 스토어프런트의 App Router 화면, 컴포넌트, 상태 저장소, 클라이언트 서비스, 상거래 API를 이 저장소로 이식했습니다.
- 상거래·배송·수동이체·Realtime 확장 마이그레이션 14개를 포함해 총 51개 마이그레이션을 보유합니다.
- Host의 기존 공통 인증·결제 라우트는 보존하고 Kakao 로그인 복귀 경로, 상거래용 Supabase 사용자 클라이언트, UI 표시 타입을 호환 병합했습니다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| `pnpm lint` | 통과 |
| `pnpm test` | 통과 |
| `pnpm build` | 61개 App Router 경로 생성, 통과 |
| Supabase migration list | 로컬 51개와 원격 51개 일치 |
| Supabase REST/RPC | products, stores, commerce_orders, site_status, auction clock, payment mode 통과 |
| Supabase Realtime | `auction_bids` 채널 구독 성공 |
| PortOne | V2 API 자격증명 실호출 성공, 서명 없는 웹훅 400 차단 |
| Kakao OIDC | 운영 도메인에서 `kauth.kakao.com/oauth/authorize` 리디렉션 확인 |
| 수동 계좌이체 | Vercel Production/Preview 설정 및 서버 런타임 확인 |
| UI | 홈·경매·상점·상품 상세에서 실제 DB 상품 렌더링 및 브라우저 오류 없음 |
| Production | `https://www.ninety-nine-vintage.store` 배포 및 공개 API 재검증 완료 |

Vercel 프로젝트의 과거 Vite 설정은 Next.js 프리셋, `pnpm build`, Next.js 기본 출력 폴더로 수정했습니다. 일회성 Preview 진단 라우트와 토큰은 검증 직후 제거했습니다.
