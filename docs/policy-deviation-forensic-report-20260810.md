# 정책·규칙 이탈 포렌식 별도 보고서

기준일: 2026-08-10
상태: 정책 보완 구현 승인을 위한 별도 확인 문서. 이 문서만으로 새 정책을 추가하거나 코드를 수정하지 않는다.

## 1. 직접 이탈 또는 높은 충돌 가능성

| 항목 | 근거 경로 | 판정 |
|---|---|---|
| PortOne 실행 경계 불명확 | `README.md`, `.env.example`, `supabase/migrations/*portone*` | 목표 정책은 실행 폐기인데 설명·환경·역사 migration이 함께 남아 운영자가 재활성화 가능성을 오해할 수 있음 |
| store scope 오류가 단일 일반 오류로 합쳐짐 | `src/lib/commerce/server.ts`, `src/app/api/admin/operator/store-scope/route.ts` | scope 없음·만료·membership 없음·DB 장애를 구분하지 않아 정책 경계와 운영 복구 절차가 불일치 |
| 임시 회원 모드와 운영자 모드 충돌 | `src/lib/commerce/server.ts`, `OwnerMemberModeProvider.tsx` | 같은 세션 전환 중 `member_required`/`member_mode_active`가 발생할 수 있어 역할 정책과 사용자 흐름이 충돌 |
| 긴급 입금 제목과 실제 경과시간 불일치 가능 | `OwnerPaymentConfirmationQueue.tsx`, payment confirmation RPC migrations | 12시간 조건의 최종 권위가 UI 밖에만 있고 실제 행·cutoff 증거가 없음 |
| `/admin/owner/site-status` 죽은 진입점 | owner layout/page/API | 정책·보안 상태 기능이 있는 것처럼 보이나 사용자가 URL로 접근하면 404 |
| public store 오류의 500 노출 | `stores/[slug]/page.tsx`, `services/stores.ts` | unknown slug와 backend failure가 구분되지 않아 공개 UX와 장애 정책이 충돌 |

## 2. 정책 위반으로 확정하지 않고 확인해야 할 항목

- owner/operator/employee의 실제 scope 선택·membership·direct URL 결과
- Kakao OIDC redirect 운영값과 callback 세션 완성 여부
- 실제 payment confirmation queue의 `first_requested_at`, `elapsed_seconds`, 상태·중복 요청
- temporary member owner의 mode state와 API bearer/session 동기화
- PortOne legacy tables/functions가 실행 권한 없이 read-only인지
- Vercel cron이 storage lifecycle 외 스케줄을 실제로 호출하는지
- R2/Google Drive canary·rollback 값이 실제 provider 상태와 일치하는지
- push/AI/Redis/배송 provider의 운영 자격·실패 경로

## 3. 별도 조치 원칙

1. 관련 없는 운영 주문·환불·배송 이력이 있으면 DB 변경을 중단한다.
2. 운영 데이터는 read-only pre-count와 dependency 검사를 먼저 수행한다.
3. 정책 이탈 확정 전에는 임의의 권한·오류 코드·provider fallback을 추가하지 않는다.
4. 사용자 승인 전에는 코드 수정·migration 작성·환경 변수 변경·배포를 하지 않는다.
