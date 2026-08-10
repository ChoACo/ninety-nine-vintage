# NINETY-NINE VINTAGE

NINETY-NINE VINTAGE의 Next.js/Supabase 단일 운영 코드베이스입니다. 여러 매장의 상품을 하나의 고객 결제와 배송 요청으로 묶되, 상품 등록·보관·출고 업무는 원등록 매장이 직접 처리합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

전체 검증:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
npm run verify:integrations -- --public-only
```

## 운영 구성

- 공개 주소: `https://www.ninety-nine-vintage.store`
- 런타임: Cloudflare Workers + OpenNext
- 데이터베이스·인증·Realtime: Supabase
- 활성 결제: 수동 계좌이체
- 소셜 로그인: Kakao OIDC → Supabase 세션

브라우저 공개값은 `NEXT_PUBLIC_*`, 서버 비밀값은 Cloudflare Worker secret으로 관리합니다. 실제 비밀값은 저장소에 커밋하지 않습니다. 결제는 수동 계좌이체만 사용하며 PortOne 실행 경로는 폐기하고 필요한 역사 식별자만 읽기 전용으로 보존합니다.

## 로컬 테스트 계정

일반 개발 서버와 운영 배포에서는 테스트 계정 기능이 비활성화됩니다. 격리 테스트가 필요할 때만 `npm run dev:local-test`를 실행합니다. 이 프로세스는 임시 로컬 Supabase에서 테스트 회원 1명, 운영자 2명, 관리자 1명을 제공합니다. 거래·상품까지 모두 초기화하려면 `npm run db:reset-local`을 사용합니다.

운영 원칙은 [제품·운영 원칙](./docs/architecture/product-principles.md)을 기준으로 합니다.
