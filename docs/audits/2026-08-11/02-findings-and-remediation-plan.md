# 발견 사항 및 수정 계획

이 문서는 수정 단계의 유일한 작업 목록이다. 동일 원인의 결함만 한 배치로 묶고 P0→P1→P2→P3 순서로 처리한다.

## 현재 결론

P0로 확정된 보안·금전·데이터 손상은 없다. 다만 운영 인증 역할·mutation은 아직 실행 증거가 없으므로 P0 부재가 완전 증명된 것은 아니다. P1 두 건, P2 다섯 건, P3 세 건을 등록한다.

## 작업 목록

### F-01 · P1 · stale 브라우저 세션을 로그인으로 신뢰

- 증거: `useSupabaseSession`은 초기 `getSession()`의 로컬 값을 서버 `getUser()`로 검증하지 않고 즉시 배포한다. 여러 provider가 이를 받아 private API를 호출해 401을 연속 발생시켰고 UI에는 로그아웃/회원 요소가 남았다. 공개 clock RPC도 같은 client의 잘못된 Bearer 때문에 401이었다.
- 영향: 계정·장바구니·채팅·입찰·알림·관리자 접근이 서로 다른 상태로 보이고 공개 경매 시각이 로컬 fallback으로 내려간다.
- 수정: 초기·auth event 세션을 서버 검증하고, 같은 토큰이 여전히 현재 토큰일 때만 invalid local session을 제거한다. 공개 clock RPC는 인증 저장소와 분리된 anonymous client를 사용한다. 토큰 값은 기록하지 않는다.
- 검증: invalid persisted session, valid session, token 교체 경합, logout, guest private-fetch 0건, public clock 200. owner/operator/employee/member 역할 브라우저 재검증.
- 롤백: hook/client 변경 커밋 revert. DB 변경 없음.

### F-02 · P1 · 상품 feed hydration 불일치

- 증거: `AuctionFeedGrid`의 `useState(() => crypto.randomUUID())`가 서버와 hydration client에서 다른 seed를 만들고 초기 상품 정렬 결과를 바꾼다. `/shop`에서 React minified error #418을 재현했다.
- 영향: 첫 렌더 재생성, 상호작용·스크롤 복원 불안정, 콘솔 오류.
- 수정: 서버·클라이언트가 동일하게 계산하는 결정적 seed를 props/상품 ID에서 생성하고 session randomization은 mount 이후에만 적용하거나 제거한다.
- 검증: production build, desktop/mobile SSR hydration console 0, 상품 2개 이상 fixture 순서 일치, 새로고침/뒤로가기.
- 롤백: feed seed 변경 revert.

### F-03 · P2 · mobile bidding이 raw `unauthorized` 노출

- 증거: `/m/bidding`에서 API 401 본문이 사용자 문구로 그대로 표시됐다.
- 영향: 오류 복구 안내 부재, 내부 contract 노출.
- 수정: F-01 뒤에도 남으면 401을 로그인 안내/복귀 동작으로 정규화한다.
- 검증: guest, expired session, valid member 각각 메시지와 redirect.

### F-04 · P2 · 동적 URL 404 계약 불일치

- 증거: fixed 상품의 desktop bid는 hard 404지만 mobile bid는 HTTP 200 soft 404다. 빈 판매 브랜드는 desktop 404, mobile 200 빈 화면이다.
- 영향: SEO/canonical, 모니터링, 사용자 오류 복구가 플랫폼마다 다르다.
- 수정: product sale type과 브랜드 존재 여부를 서버에서 동일 검증하고 hard 404 계약을 통일한다. 실제 존재하지만 판매기록 0인 브랜드 정책은 한 가지로 확정한다.
- 검증: 정상/없는/잘못된/타 유형 ID와 desktop/mobile status·body 일치.

### F-05 · P2 · 운영 배포·문서·도구 구성 드리프트

- 증거: README Cloudflare/OpenNext 설명, 실제 Vercel Next.js, stale `.vercel/project.json`, npm packageManager와 Vercel `pnpm build`, ESLint 10 peer warning.
- 영향: 잘못된 배포 또는 rollback, 재현되지 않는 build.
- 수정: Vercel을 현재 canonical runtime으로 문서화하고 Cloudflare는 보존/비활성 경계로 명시한다. project/build/package manager 설정을 하나로 맞추고 exact Node major를 고정한다.
- 검증: clean install/build, preview→Production, `/BUILD_ID`.

### F-06 · P2 · Vercel runtime log 조회 실패

- 증거: deployment ID 및 Production 환경 쿼리가 CLI Response Error 400.
- 영향: 배포 후 5xx·cron·인증 장애 판정 지연.
- 수정: CLI/project link/version과 접근 권한을 확인하고 지원되는 runtime log query 또는 Vercel API/Observability drain을 확정한다.
- 검증: 지정 preview 요청 correlation과 Production 비민감 로그 조회.

### F-07 · P2 · 역할별 운영 검증 및 격리 mutation 미완료

- 증거: audit browser의 인증 context가 401이 됐고 Docker Desktop이 꺼져 local Supabase를 시작하지 못했다.
- 영향: 타 매장/직원 권한, 결제·취소·출고·배송·환불·chat mutation 완료 기준 미충족.
- 수정: Docker 격리 환경 복구 후 role fixtures와 지정 test data를 사용한다. 운영 카나리는 최종 배치에서만 실행한다.
- 검증: 성공·실패·중복·경합·재시도, RLS/GRANT, store/group scope, append-only event, CAS.

### F-08 · P3 · 유지보수 상태와 만료 예정 문구

- 증거: 사이트는 maintenance이며 문구는 8월 12일 10시까지로 설정됐다.
- 처리: 장애 수정과 카나리 완료 전 유지한다. 완료 시 소유자 승인 범위 안에서 open 전환하고 모든 public route를 다시 검사한다.

### F-09 · P3 · 법률 문서 governance 표기

- 증거: 개인정보·환불·약관 페이지에 외부 법률 검토 대기 취지 문구가 있다.
- 처리: 저장소 확정 정책과 runtime 일치만 검사한다. 외부 법률 해석은 범위 밖이며 운영 담당 승인 항목으로 남긴다.

### F-10 · P3 · 감사 도구 한계

- 증거: Chrome extension은 manifest/sitemap/robots/BUILD_ID 직접 탭을 `ERR_BLOCKED_BY_CLIENT`로 표시했지만 HTTP/build 검사에서는 정상이다. API 일괄 smoke의 34개 status 0은 body parser 오류였다.
- 처리: 사이트 결함으로 분류하지 않는다. curl/structured response collector로 재검사하고 증거 도구를 분리한다.

## 정책 불변식

- 센터=매장, 운영자=매장 사장, 직원=매장 직원, 소유자=사이트 소유자.
- 결제는 수동 계좌이체만 유지하며 자동 입금 확정과 PortOne 실행을 추가하지 않는다.
- 주문은 하나여도 배송·송장은 센터 또는 통합 물류 그룹별이다.
- 구형 중앙 물류·배송·PortOne은 필요한 읽기 호환만 남기고 신규 writer를 만들지 않는다.
- DB는 추가형 migration, CAS, 멱등성, append-only audit, RLS, 명시적 GRANT를 유지한다.

## 완료 게이트

각 배치는 core test, SQL/RLS, TypeScript, lint, production build, 역할별 Chrome 재현을 통과해야 한다. Preview 후 Production을 배포하고 BUILD_ID, 로그, migration pending 0, rollback 지점을 기록한다. F-01~F-07의 `PRODUCTION_UNVERIFIED_AUTH_SESSION`과 핵심 `MUTATION_UNEXECUTED`가 제거되기 전 정상 운영으로 판정하지 않는다.

## 2차 처리 현황

| 항목 | 상태 | 결과 |
| --- | --- | --- |
| F-01 | `RESOLVED` | `306f618`, `86740a1`; stale token server validation과 정리 dedupe, 공개 clock 분리. Production guest 재검증 오류 0 |
| F-02 | `RESOLVED` | `306f618`; 결정적 feed seed, Production hydration 오류 0 |
| F-03 | `RESOLVED` | `4eebce4`; guest desktop/mobile 모두 로그인 안내 |
| F-04 | `RESOLVED` | `4eebce4`; fixed bid와 빈 brand desktop/mobile hard 404 |
| F-05 | `RESOLVED` | `5ebf988`; README/Vercel/npm/Node 22.x 일치, ESLint peer conflict 제거, `npm audit` 0 |
| F-06 | `OPEN_P2_OBSERVABILITY` | build logs는 조회 가능하나 runtime logs API가 CLI 56.3.1과 58.1.0에서 모두 HTTP 400 |
| F-07 | `PARTIAL` | 격리 역할·RLS·GRANT·CAS·동시성 통과. 운영 Kakao 역할 세션과 지정 데이터 mutation은 미실행 |
| F-08 | `BLOCKED_BY_F07` | maintenance 유지. 운영 인증 카나리 전 open 전환 금지 |
| F-09 | `GOVERNANCE_REMAINDER` | 저장소 정책 일치는 통과, 외부 법률 검토는 범위 밖 |
| F-10 | `RESOLVED_AS_TOOLING` | HTML/JSON/보호 Preview는 Chrome, `vercel curl`, structured HTTP로 분리 검증 |

### 운영 카나리에서 추가 발견·수정한 항목

| 항목 | 우선순위 | 상태 | 결과 |
| --- | --- | --- | --- |
| F-11 숨김 테스트 회원 역할 계약 회귀 | P1 | `RESOLVED` | store-scoped 역할 함수 교체가 제거한 제한적 예외를 추가 migration으로 복구. 일반 회원 역할·활성 owner provision 조건만 허용 |
| F-12 숨김 테스트 회원 초기 배송권 0 | P1 | `RESOLVED` | profile trigger 선삽입과 provision upsert 충돌 시에도 10회로 설정하도록 수정; 운영에서 10→9 사용 확인 |
| F-13 배송 대기열 응답 shape 불일치 | P1 | `RESOLVED` | API의 `totalCount` 추가 필드를 UI exact-key 검증에 반영; 운영 포장·발송 완료 |
| F-14 회원 모드 타이머 브라우저 시계 의존 | P2 | `RESOLVED` | API `serverNow`와 client clock offset을 사용; 운영에서 02:54 표시 후 즉시 종료 확인 |
| F-15 Supabase security advisor 전수 분류 | P2 | `OPEN_REVIEW` | 325건: policy 없는 RLS 77 INFO, anon SECURITY DEFINER 2 WARN, authenticated SECURITY DEFINER 245 WARN, leaked-password 보호 1 WARN. anon 2개는 제한된 공개 읽기 projection으로 확인; authenticated RPC는 함수별 내부 권한 검사와 GRANT 의도를 계속 대조 |
| F-16 상품 일시중지와 매분 자동공개 충돌 | P1 | `RESOLVED` | pause가 과거 `publish_at`의 pending만 남겨 cron이 재공개하던 결함. `paused_at`을 추가하고 cron은 명시적 pause를 제외, 수동 공개만 표식을 제거하도록 수정 |

F-07은 `PARTIAL_PRODUCTION_CANARY`로 갱신한다. 소유자 Kakao 세션, 숨김 회원, 입찰·낙찰, 수동 입금확인, inventory 생성, 배송 요청 멱등성, 출고, 합포장, 송장 발송, 경매 구매자 취소 차단, 상품 일시중지는 운영 지정 데이터로 통과했다. 일반 회원 Kakao 세션, 직원, 타 매장 직접 접근, 채팅, 환불은 계속 미검증이다. F-08은 이 잔여 범위 때문에 계속 차단한다.

현재까지 재현한 P0/P1 기능 결함은 수정됐다. F-06 관측성 P2와 F-07의 남은 역할·채팅·환불 운영 증거가 있으므로 사이트 전체를 `NORMAL_OPERATION_CONFIRMED`로 선언하거나 maintenance를 해제하지 않는다.
