# 정책·규칙 이탈 및 별도 확인 보고서

기준일: 2026-08-10
상태: 보완 구현 승인 전 별도 보고. 아래 항목은 즉시 추가 구현 대상으로 확정하지 않는다.

## A. 정책·규칙과 직접 충돌하거나 충돌 가능성이 높은 항목

1. **매장 상세 500** — 정상적인 미존재 매장은 404여야 하는데 `/stores/dami-shop`이 500이다. 오류 원인과 사용자 노출 계약이 정책상 fail-closed 원칙과 충돌할 수 있다. 경로: `src/app/(shop)/stores/[slug]/page.tsx`, `src/services/stores.ts`.
2. **site-status 죽은 진입점** — owner layout에는 의도상 site status가 있었으나 page route는 없고 API만 존재한다. 기능이 있는 것처럼 보이는 링크/API와 실제 화면이 분리되어 있다. 경로: `src/app/(admin)/admin/owner/layout.tsx`, `src/app/api/admin/owner/site-status/route.ts`.
3. **고정가를 auction URL로 표현** — `/auction/{id}`가 fixed와 auction을 함께 처리한다. 기능적 동작과 URL 의미·metadata·정책 표현이 어긋날 수 있다. 경로: `AuctionCard.tsx`, `AuctionDetailView`, auction page routes.
4. **역할별 인증 계약 혼용** — 동일 관리자 도메인에서 owner access helper, commerce staff helper, operator store helper, client session hook이 혼용된다. 동일 권한 경계를 표현하는 정책과 구현이 분리될 위험이 있다.
5. **입점 상담과 일반 채팅 분리 계약** — 일반/product/internal/onboarding 상담이 서로 다른 테이블/RPC/API/error contract를 사용한다. 잘못 연결되면 개인정보·담당 매장·감사 범위가 섞일 수 있다.

## B. 정책 위반으로 단정할 수 없지만 확인이 필요한 항목

- `/admin/*`의 HTTP 200은 인증 전 shell 응답일 수 있다. 직접 URL 차단과 API 401/403을 역할별로 재검증해야 한다.
- `/admin/employee/center` redirect는 호환성 자산인지 제거 대상인지 결정되지 않았다.
- 운영자 `매출·정산` 메뉴의 `/admin/operator` 연결은 의도된 dashboard 진입인지 상세 revenue 누락인지 제품 결정이 필요하다.
- 30초 전체 catalog 재조회와 실시간 재조회는 현재 정책 위반은 아니지만 규모 증가 시 가용성·비용 위험이 있다.
- account dashboard의 대형 단일 컴포넌트와 인증 패턴 혼용은 유지보수 위험이지 즉시 정책 이탈로 확정하지 않는다.
- 공개 store/상품 조회 실패 시 500·404·503 구분이 데이터 공개·운영 장애 안내 정책과 맞는지 확인이 필요하다.

## C. 별도 확인 순서

1. 실제 production 로그와 read-only DB 상태로 사실을 확정한다.
2. 정책 문서의 해당 경계와 API/RLS/RPC 계약을 한 줄씩 대조한다.
3. 이탈 확정·설계 선택·단순 유지보수 위험을 분리한다.
4. 사용자 승인 없이는 보완 구현이나 규칙 추가를 하지 않는다.
