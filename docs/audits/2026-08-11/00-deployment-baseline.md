# 2026-08-11 배포 기준선

## 판정

감사 기준 커밋 `5a03bb586fbb3b9b50dab0defb9587f429f9fcd2`는 `origin/codex/center-commerce-rebuild`에 보존됐고 Vercel Production에 배포됐다. `main`은 변경하지 않았다. 애플리케이션 수정 전 기준선이며, 운영은 사이트 상태 설정상 `maintenance`이다.

## Git 및 배포

| 항목 | 확인값 | 판정 |
| --- | --- | --- |
| 브랜치 | `codex/center-commerce-rebuild` | 원격 동명 브랜치와 일치 |
| 전체 SHA | `5a03bb586fbb3b9b50dab0defb9587f429f9fcd2` | 로컬·원격·`/BUILD_ID` 일치 |
| Vercel 배포 | `dpl_7xuoAKonw4RUdqGb5HLDXFZuxMr8` | `Ready`, Production |
| 배포 URL | `ninety-nine-vintage-nuxtbikyf-choa-co.vercel.app` | Ready |
| 운영 alias | `ninety-nine-vintage.store`, `www.ninety-nine-vintage.store` | 연결 확인 |
| 롤백 배포 | `dpl_A7wy8Z8cCpqt11Mj6PagtAmAYPjP` / `f2eb9b4` | 보존, 실행하지 않음 |

배포에는 전체 SHA를 `VERCEL_GIT_COMMIT_SHA`로 전달했다. 운영 `/BUILD_ID` 응답은 전체 SHA와 일치했다.

## 선행 검증

| 검사 | 결과 |
| --- | --- |
| `npm test` | 339개 중 333 통과, 6 skip, 실패 0 |
| `npm run lint` | 통과 |
| `npx tsc --noEmit --incremental false` | 통과 |
| `npm run build` | 통과, 정적 페이지 123개 |
| `npm run verify:migrations` | linked 기준 migration 161개 일치 |
| `npx supabase db push --linked --dry-run` | 원격 최신, pending 0 |
| `npm run verify:integrations -- --public-only` | products/stores/orders/clock RPC/realtime 통과 |

## 운영 연결 기준선

- Vercel Production 환경 변수 이름 존재: Supabase URL/anon/service role, Kakao key/redirect, OpenRouter, 수동 계좌이체, Google Drive, cron, payout encryption. 값은 열람·기록하지 않았다.
- R2 관련 운영 환경 변수는 Vercel 목록에서 확인되지 않았다. 실제 사용은 `PRODUCTION_UNVERIFIED`이며 조건부 저장소로 취급한다.
- Supabase read-only 집계: 역할 `owner 1`, `operator 2`, `employee 1`, `member 13`; 매장 `2/2 active`; 지원 대화 `1 open`, 모두 store-scoped.
- `get_auction_server_time` 실행 권한은 `anon`, `authenticated`, `service_role`, `postgres`에 존재한다.
- 사이트 상태는 `maintenance`, 안내는 `8월 12일 오전 10시까지 점검 예정입니다`이다. 정상화 완료 전 임의 해제하지 않는다.

## 런타임·문서 불일치

README는 Cloudflare Workers/OpenNext 운영을 설명하지만 실제 Production은 Vercel Next.js다. 로컬 `.vercel/project.json`의 Vite/`dist/client` 정보도 원격 프로젝트의 Next.js 설정과 다르다. 이중 배포는 하지 않았으며 P2 운영 구성 드리프트로 등록한다.

Vercel build는 성공했지만 Node `>=22.13.0` 범위의 자동 major upgrade 가능성과 ESLint 10 대 플러그인 peer 범위 경고를 출력했다. Vercel runtime log 조회는 CLI HTTP 400으로 실패해 관측성 복구가 필요하다.

## 변경 제한

이 문서 작성 시점에는 애플리케이션 코드, migration, 운영 데이터, 환경 변수, 사이트 상태를 수정하지 않았다. 로컬 격리 Supabase는 Docker Desktop 미실행으로 시작되지 않아 `BLOCKED_LOCAL_DOCKER`로 기록한다.

## 2차 정상화 배포 갱신

최초 기준선은 위 내용 그대로 보존한다. 수정 단계에서는 다음 커밋을 순서대로 원격 브랜치에 게시했다.

| 커밋 | 범위 |
| --- | --- |
| `306f618` | 브라우저 세션 server validation, 공개 clock client 분리, hydration-stable feed |
| `4eebce4` | mobile 인증 오류 문구 및 동적 URL hard-404 계약 통일 |
| `86740a1` | invalid session 정리 요청 deduplication |
| `f383873` | 격리 fixed-price fixture와 현재 PortOne 폐기 계약에 맞춘 local verifier |
| `5ebf988` | Vercel/npm/Node 22.x canonical 구성, ESLint peer 충돌 제거 |

`5ebf988ac7a2c1639829ffd5b00b65d1adae0714` Preview `dpl_7ARyaWnacAGL3XMSUP9nctpjrG12`를 검증한 뒤 Production `dpl_H2yDY1T7jGirk6GXSr4J2n6aWVzh`로 승격했다. apex와 www alias의 `/BUILD_ID`가 모두 이 전체 SHA와 일치한다. Vercel build는 Node 22.x로 cache를 전환하고 `npm install` → `npm run build`를 실행했으며 audit 0, 123 static pages로 완료됐다.

Supabase 161개 migration은 linked dry-run pending 0을 유지한다. 사이트 상태는 운영 인증 카나리가 끝나지 않아 기존 `maintenance`를 유지했으며, 임의로 open 전환하지 않았다.
