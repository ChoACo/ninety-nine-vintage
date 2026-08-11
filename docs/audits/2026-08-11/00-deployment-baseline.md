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

## 운영 카나리 배포 갱신

운영 Kakao 소유자 세션으로 지정 테스트 데이터 카나리를 수행하며 발견한 결함을 `1f23a6ad8c9eb08dd3e10f67d319ac5607e6bce1`에서 수정했다. 해당 SHA는 `origin/codex/center-commerce-rebuild`에 보존했고 Vercel Production `dpl_6GhzCYg2pzPovLVE5dctxBr12L33`에 배포했다. 배포 URL은 `ninety-nine-vintage-qtunwm207-choa-co.vercel.app`, 상태는 `Ready`, apex/www alias와 `/BUILD_ID`는 이 SHA에 일치한다.

이 배치의 전체 검증은 340개 중 334 pass, 정책상 폐기된 PortOne 6 skip, 실패 0이며 ESLint·TypeScript·production build가 통과했다. Supabase 운영 이력은 `20260811094959_restore_hidden_test_member_role_contract`, `20260811095613_fix_hidden_test_initial_shipping_credits`를 포함하며 로컬·원격 migration 버전이 모두 일치해 pending 0이다.

직전 Production `dpl_H2yDY1T7jGirk6GXSr4J2n6aWVzh`를 이 배치의 즉시 롤백 지점으로 보존한다. runtime log 조회는 새 배포에서도 CLI HTTP 400이므로 `OPEN_P2_OBSERVABILITY`를 유지한다. 사이트 상태는 역할 전수검사와 채팅·환불 카나리가 남아 있어 `maintenance`를 유지한다.

카나리 cleanup 중 발견한 상품 pause/cron 충돌은 `2fbc08bf7c2a8b68275ad4ec3dea829518d7ec6e`에서 수정했고 Production `dpl_7nvP7xb4k5vwKbze8MbZj23TWt8w`로 배포했다. 배포 URL은 `ninety-nine-vintage-en4wgogiy-choa-co.vercel.app`, 상태는 `Ready`, apex/www alias와 `/BUILD_ID`는 이 SHA에 일치한다. 첫 CLI 배포 `dpl_HPuvP7p44Mo8PgDZa84SHEyKqAwF`는 Ready였으나 Git SHA metadata cache 때문에 이전 BUILD_ID를 반환해 완료 배포로 채택하지 않았고, force 및 명시적 Git metadata로 재배포했다.

최종 코드 검증은 341개 중 335 pass, PortOne 6 skip, 실패 0이며 lint·TypeScript·production build 123 pages가 통과했다. Supabase migration `20260811121000_make_product_pause_persistent` 적용 후 로컬·원격 164개 일치, pause가 다음 분 cron을 지난 뒤에도 유지됨을 확인했다. 이 시점의 코드 롤백 지점은 `dpl_6GhzCYg2pzPovLVE5dctxBr12L33` / `1f23a6ad8c9eb08dd3e10f67d319ac5607e6bce1`이다.

## 실제 소유자 역할 카나리 배포 갱신

실제 소유자의 저장 역할과 JWT를 변경하지 않고 기존 운영자·직원 계정의 권한 principal만 3분간 사용하는 역할 카나리를 `747043fa5813cd4c0dcac761bc0487f711d2b09c`에 추가했다. Supabase migration `20260811122000_owner_role_canary_sessions` 적용 후 linked migration은 165개, pending 0이다. 카나리 테이블과 시작·종료 함수는 `service_role` 전용이고 `authenticated`에는 테이블 SELECT와 시작 함수 EXECUTE가 모두 없다. 시작과 종료는 append-only 감사 기록으로 남는다.

Preview `dpl_95cKSDRYjRndz59u6ndfKErH92tQ`를 Vercel UI에서 Production `dpl_9Ka18izctTtmGDPdPBu52tQZfnum`으로 승격했다. 상태는 `Ready`, 배포 URL은 `ninety-nine-vintage-g37hpyyym-choa-co.vercel.app`, apex/www alias와 `/BUILD_ID`는 모두 전체 SHA에 일치한다. 직전 Production `dpl_6BGfXfbwz9vNcqeGxtbPwmaJDBDV`를 롤백 지점으로 보존한다.

검증은 342개 중 336 pass, PortOne 6 skip, 실패 0이며 전체 lint·TypeScript·production build 123 pages가 통과했다. 운영 역할 rehearsal 종료 후 저장 역할은 `owner`, active principal은 `null`이다. 사이트 Chrome 로그인 세션은 배포 후 재확인 시 만료 상태여서 역할별 UI 재검증은 `PRODUCTION_UNVERIFIED_AUTH_SESSION`으로 남기고 maintenance를 유지한다.

## 역할별 Chrome·채팅·push 카나리 갱신

소유자 Kakao 세션 재로그인 후 저장 역할을 바꾸지 않는 3분 카나리로 다미네 운영자와 다미네 직원을 각각 확인했다. 운영자는 다미네 한 매장만 선택·조회했고 `/admin/owner` 접근이 차단됐다. 직원은 `/admin/employee`와 문의 화면을 조회했으며 `/admin/operator`, `/admin/owner` 접근이 차단됐다. 각 lease는 명시 종료되거나 만료됐고 소유자 권한 복귀를 Chrome에서 확인했다.

채팅 카나리 중 role canary의 유효 principal이 support RLS·발신자·읽음 처리에 일관되게 적용되지 않는 결함을 발견했다. 추가형 migration `20260811124000_scope_support_chat_to_canary_principal`과 `20260811124500_scope_support_sender_and_reads_to_canary_principal`, 서버 발신자 수정 커밋 `9af47134a91d13c1aab14b6f39ffcb6c75260e4f`로 보완했다. Production `dpl_J9HE7KE18tpNEFTfo9KXLNQrs5dM`은 `Ready`이고 당시 `/BUILD_ID`가 해당 SHA와 일치했다.

실제 소유자 구독 1건에 시험 push 알림 `3a97f404-ed4a-40b7-882b-89b1a1e9bab8`을 생성했다. Vault의 `web_push_dispatch_url` 누락을 발견해 공식 endpoint `https://www.ninety-nine-vintage.store/api/push/dispatch`를 등록했고, pg_net 요청은 HTTP 200, outbox는 attempts 1·`delivered_at=2026-08-11 20:58:30 KST`·오류 없음으로 완료됐다. VAPID·dispatch 비밀값은 조회하거나 문서화하지 않았다.

최종 검증은 343개 중 337 pass, PortOne 6 skip, 실패 0이며 lint·TypeScript·production build 123 pages가 통과했다. 실제 환불 레코드가 0건이라 회원 환불 빈 상태는 확인했지만 금전 mutation은 실행하지 않았다. 사이트 상태는 계속 `maintenance`다.

## SECURITY DEFINER 권한 검토 갱신

Supabase advisor가 표시한 public authenticated SECURITY DEFINER 246개를 운영 catalog·함수 본문·ACL 기준으로 서명별 검토했다. 내부 trigger 15개와 독립 caller guard가 없는 `cancel_member_active_bids(uuid,uuid,timestamptz)`의 외부 EXECUTE를 migration `20260811131000_harden_internal_security_definer_execute`로 회수했다. 별도 `app_private` trigger 1개의 기본 PUBLIC EXECUTE도 회수했다. 적용 후 public authenticated 경고 대상은 의도된 guarded RPC·helper 230개이고 authenticated trigger는 0개다. 개별 판정은 `04-authenticated-security-definer-review.md`에 기록했다.

## 최종 운영 기준선

최종 Production은 `dpl_3JohYeBnsEXE6jJ2hAT4oUFZNxEs`, BUILD_ID `6c4a9653e67f62923e06a71340ff4b895b9cba1e`, migration 172개·pending 0이다. 환불 암호화 Production 환경을 보완했고 runtime 5xx와 error cluster가 모두 0인 것을 확인했다. 2026-08-11 22:29 KST에 Owner RPC로 사이트 상태를 `operational`로 전환했다. 상세 최종 판정은 `05-final-regression-and-release.md`를 따른다.
