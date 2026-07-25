# 코드베이스·배포 통합 검증

검증일: 2026-07-25 (Asia/Seoul)

## 현재 운영 기준

- 런타임은 Cloudflare Workers + OpenNext입니다.
- 데이터·인증·Realtime·Storage는 Supabase를 사용합니다.
- 결제 운영 방식은 수동 계좌이체이며 PortOne 코드는 비활성 보관 상태입니다.
- 물류는 중앙 센터 이관 없이 매장 직접 출고·보관을 기준으로 합니다.
- 로컬 테스트 계정 API는 운영 환경에서 `404`로 비활성화됩니다.

## 이번 정리 범위

- 직원·운영자 매장별 채팅 접근, 알림 대상 역할과 링크, 알림 RLS를 수정했습니다.
- 상품 피드의 폐기된 정렬 옵션과 중복 소유자 상품·물류 화면/API를 제거했습니다.
- 공개 캐시를 v3로 교체하고 최대 160개 항목으로 제한했으며 허용·거부 시 이전 캐시도 정리합니다.
- 수동 입금 확인·취소의 멱등 키를 사용자·요청·금액에 결합했습니다.
- apex 도메인은 경로와 쿼리를 보존해 `www`로 `308` 정규화합니다.
- 추천 경매가 없을 때의 PC·모바일 대체 배너는 정적 원본을 직접 불러오고 전체 로고가 잘리지 않게 표시합니다.
- 미사용 Drizzle/D1 계층과 약 60MB의 과거 배포 압축 파일을 제거했습니다.
- Cloudflare Worker 필수 비밀값은 산출물에 포함하지 않고 런타임 secret으로 등록했습니다.

## 자동 검증 결과

| 검증 | 결과 |
| --- | --- |
| `npm test` | 225/225 통과 |
| `npm run lint` | 통과 |
| `npx tsc --noEmit` | 통과 |
| `npm audit` | 취약점 0건 |
| `npm run build` | Next.js 프로덕션 빌드 및 108개 정적 페이지 생성 통과 |
| `npx opennextjs-cloudflare build` | Worker 산출물 생성 통과 |
| `node --check .open-next/worker.js` | 통과 |
| Worker 비밀값 스캔 | Supabase·Kakao·Vercel 로컬 비밀값 포함 0건 |
| `wrangler deploy --dry-run` | 정적 자산 441개, 약 15.4MiB 패키지 통과 |
| Supabase migration dry-run | 원격 DB 최신 상태 |
| Supabase DB lint | 오류 0건; 호환 인자·잠금 수신 변수 관련 기존 extra 경고만 존재 |

## 원격 DB 반영

다음 마이그레이션을 운영 DB에 적용하고 실제 카탈로그·제약·권한을 조회해 검증했습니다.

- `20260725053459_fix_employee_internal_chat_and_notifications.sql`
- `20260725070000_correct_read_rpc_volatility.sql`
- `20260725073000_lock_down_support_authorization_helpers.sql`

검증된 계약:

- 알림 대상 역할은 `member`, `operator`, `employee`, `owner`입니다.
- 알림 조회 RLS는 현재 사용자 자신의 `member_id`만 허용합니다.
- 채팅 권한 함수 2개는 `authenticated`만 실행할 수 있고 `anon`, `service_role` 직접 실행은 차단됩니다.
- 최신 상태를 요구하는 배송·매출·탈퇴 보존 조회 함수의 변동성은 `VOLATILE`로 일치합니다.
- 실제 운영자 매장 배정 불일치는 0건이며, 활성 보관 재고 1건은 배송 선택 가능 상태입니다.

## 운영 배포 및 공개 검증

- Worker: `ninety-nine-homepage`
- 배포 버전: `769e8114-8c48-4671-8db9-aa77e2884b46`
- 운영 주소: `https://www.ninety-nine-vintage.store`

공개 환경에서 다음을 확인했습니다.

- PC 홈·실시간 경매·즉시 구매와 Android UA 모바일 홈 모두 `200`
- PC·모바일 대체 배너가 실패하던 `/_next/image`를 사용하지 않고 정적 이미지 `200` 응답을 직접 사용
- manifest·service worker·공개 상품 API `200`
- 사이트 상태 API `dbConnected: true`
- 계정·운영자·소유자 보호 API는 비로그인 `401`
- 폐기 API와 운영 환경 로컬 테스트 계정 API는 `404`
- Kakao 로그인은 `kauth.kakao.com`으로 정상 이동
- apex 주소는 `www`로 `308` 이동
- CSP, HSTS, `X-Frame-Options: DENY` 적용
- 비로그인 `/account`는 로그인 모달로 전환
- 로그인 모달의 “로그인 없이 둘러보기”는 이전 홈 화면을 유지
- 공개 캐시 허용·거부·설정 다시 열기 동작
- 브라우저 콘솔 오류 0건

## 참고

- Supabase CLI가 마이그레이션 적용 후 로컬 인증서 파일을 찾지 못해 pg-delta 카탈로그 캐시 경고를 출력했지만, 마이그레이션 적용·원격 이력·실제 DB 객체 조회는 모두 성공했습니다.
- 전체 fresh local Supabase replay는 과거 소유자 고정 UUID를 요구하는 이전 마이그레이션 특성상 일반 빈 DB에서 바로 실행되지 않습니다. 현재 로컬 테스트 런처는 비활성 보관 상태이며 운영 DB 최신성에는 영향이 없습니다.
