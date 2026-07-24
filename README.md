# NINETY-NINE VINTAGE

NINETY-NINE VINTAGE의 단일 운영 코드베이스입니다. 기존 Supabase·PortOne·Kakao OIDC·Realtime 백엔드와 새 스토어프런트 UI가 이 저장소에 통합되어 있습니다.

## 로컬 실행

```bash
npm install
npm run dev
```

검증 명령은 다음과 같습니다.

```bash
npm run lint
npm test
npm run build
npm run verify:integrations -- --public-only
```

`verify:integrations`는 비밀값을 출력하지 않으며 Supabase REST/RPC와 `auction_bids` Realtime 구독을 점검합니다. 서버 비밀값을 사용할 수 있는 운영 환경에서는 `--public-only` 없이 실행해 PortOne·Kakao 설정까지 확인할 수 있습니다.

## 운영 구성

- Production: `https://www.ninety-nine-vintage.store`
- Canonical domain: `www.ninety-nine-vintage.store`; the apex domain routes to the same Sites project
- Runtime: Next.js App Router on OpenAI Sites, with authoritative DNS on Cloudflare
- Database/Auth/Realtime: Supabase
- Payments: PortOne V2 및 수동 계좌이체
- Social login: Kakao OIDC → Supabase session

필수 환경변수 이름은 `.env.example`에만 관리합니다. 실제 비밀값은 Sites runtime environment 또는 로컬 `.env.local`에 두고 커밋하지 않습니다.

통합 및 실환경 검증 기록은 `docs/consolidation-verification.md`를 참고하세요.
# 로컬 테스트 계정

처음에는 `npm run dev:local-test`만 실행하세요. 이 명령은 전용 임시 로컬 Supabase를 준비하고, 원격용 `.env.local`은 건드리지 않은 채 `http://localhost:3000`을 로컬 DB로 실행합니다. `http://localhost:3000/account/login`에는 **테스트 회원 ID 1**, **테스트 회원 ID 2**, **테스트 운영자로 접속**, **테스트 관리자로 접속** 버튼이 표시되며, 누르면 계정을 만들거나 재사용해 바로 접속합니다. 테스트 운영자는 로컬 샘플 숍의 상품 관리 권한도 자동으로 준비되고, 테스트 관리자는 `/admin/owner`로 접속합니다. 운영자 센터의 **관리자별 테스트 회원 접속**에서도 두 회원을 바로 전환할 수 있습니다. 로그인 화면의 **로컬 테스트 계정 모두 삭제**는 로그인 계정만 지우고, 거래·상품을 포함한 테스트 데이터까지 모두 초기화하려면 `npm run db:reset-local`을 실행합니다. 이 기능은 개발 모드와 `localhost`/`127.0.0.1` Supabase에서만 활성화됩니다.
