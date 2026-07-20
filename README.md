# NINETY-NINE VINTAGE

NINETY-NINE VINTAGE의 단일 운영 코드베이스입니다. 기존 Supabase·PortOne·Kakao OIDC·Realtime 백엔드와 새 스토어프런트 UI가 이 저장소에 통합되어 있습니다.

## 로컬 실행

```bash
pnpm install
pnpm dev
```

검증 명령은 다음과 같습니다.

```bash
pnpm lint
pnpm test
pnpm build
pnpm verify:integrations -- --public-only
```

`verify:integrations`는 비밀값을 출력하지 않으며 Supabase REST/RPC와 `auction_bids` Realtime 구독을 점검합니다. 서버 비밀값을 사용할 수 있는 운영 환경에서는 `--public-only` 없이 실행해 PortOne·Kakao 설정까지 확인할 수 있습니다.

## 운영 구성

- Production: `https://www.ninety-nine-vintage.store`
- Runtime: Next.js App Router on Vercel
- Database/Auth/Realtime: Supabase
- Payments: PortOne V2 및 수동 계좌이체
- Social login: Kakao OIDC → Supabase session

필수 환경변수 이름은 `.env.example`에만 관리합니다. 실제 비밀값은 Vercel encrypted environment 또는 로컬 `.env.local`에 두고 커밋하지 않습니다.

통합 및 실환경 검증 기록은 `docs/consolidation-verification.md`를 참고하세요.
