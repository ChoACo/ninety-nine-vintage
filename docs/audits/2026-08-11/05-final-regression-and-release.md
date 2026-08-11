# 최종 회귀 검사와 maintenance 해제

## 최종 판정

2026-08-11 22:29 KST에 사이트 상태를 `maintenance`에서 `operational`로 전환했다. 운영 배포는 `dpl_3JohYeBnsEXE6jJ2hAT4oUFZNxEs`, BUILD_ID는 `6c4a9653e67f62923e06a71340ff4b895b9cba1e`이며 apex와 www alias가 같은 배포를 가리킨다. 직전 Ready Production `dpl_6mQnhM7VNri5jTii6CFQDuLFhV6x`를 롤백 지점으로 보존한다.

이 문서는 00~04 문서의 시점별 미검증 표기를 대체하는 최종 판정이다. 이전 표기는 발견 당시의 감사 이력이며 현재 미완료 작업 목록이 아니다.

## 실제 일반회원 계정

- 소유자센터의 `회원 화면 임시 확인` UI, provider, API와 서버 권한 우회를 제거했다.
- 검색·메뉴·sitemap에 연결하지 않은 `/account/test-member`와 전용 POST `/api/auth/test-member`를 추가했다.
- 식별자는 `ninety99`이고 비밀번호는 저장소·문서·브라우저 저장소에 기록하지 않았다. 48자 임의 비밀번호는 Windows 자격 증명 관리자 `Ninety99Canary`에만 저장했다.
- 로그인은 same-origin 검사, 5회/10분 rate limit, 서버 고정 이메일 매핑, Auth metadata의 `member + canary + hidden_test` 검증을 모두 통과해야 한다.
- Production Chrome에서 로그인 후 `/account` 주문·배송·환불 데이터가 렌더됐고 `/admin/owner`는 `접근 권한이 없습니다`로 차단됐다.
- Kakao는 실제 고객의 기본 로그인으로 유지한다. 격리 운영 계정만 Kakao identity 요구에서 좁게 제외한다.

## 유효 주문·환불 카나리

| 단계 | 결과 |
| --- | --- |
| checkout | 주문 `8c36e6a7-eeb0-43d3-9bee-ce9d6835526c`, transfer `bc3687bf-3562-415d-aa81-ea7a8495644c`, 1,000원, HTTP 201 |
| 입금 확인 | 실제 소유자 Chrome UI로 확정, order `paid`, transfer `confirmed`, inventory `0c459b1f-dcb7-4b4c-8967-b0d8e0ff44b1` 생성 |
| 실패 | 빈 계좌 입력 HTTP 422 `invalid_refund_account`; 암호화 환경 누락 HTTP 503을 재현하고 Production 환경 변수 보완 |
| 중복 | 같은 idempotency key의 계좌 제출을 두 번 실행해 모두 HTTP 200·version 1, `account_submitted` 이벤트는 1건 |
| 성공 | refund `c5e014e6-7036-47c3-95ae-f00acd7b723a` 승인·계좌 감사 열람·송금 완료 |
| 사후 상태 | refund `completed` version 3, inventory `refunded`, order `refunded`, disbursement 1건, 계좌 암호문 행 0건 |

환불 계좌 AES-256-GCM 키, active key version, HMAC fingerprint 키를 Vercel Production 민감 변수로 추가했다. 값은 출력하거나 Git에 저장하지 않았다.

## 전 페이지·API 회귀

- 소스 기준 page 파일 78개, route group/intercept 중복 제거 후 URL 75개, API Route 97개다.
- 무인증 page GET: 71개 HTTP 200, 4개 의도된 HTTP 404, 5xx 0.
- 의도된 404는 고정가 상품의 `/bid` PC·mobile 2개와 아직 판매 완료되지 않은 상품의 `/sold` PC·mobile 2개다.
- 무인증 API GET: 200 3개, 302 2개, 401 53개, 405 38개, 404 1개, 5xx 0. 404는 운영에서 의도적으로 닫힌 `/api/local-test-accounts`다.
- 실제 회원 bearer GET 18개는 17개 HTTP 200과 POST-only `/api/security/session` HTTP 405였다. owner/operator API 직접 호출은 각각 HTTP 403이었다.
- 앞선 실제 역할 카나리의 운영자·직원·타 매장 차단, 채팅 송수신, push HTTP 200 delivered 결과를 재확인 범위에 포함했다.
- 동적 정상 상품 `b1d11184-24a2-43a9-b24d-d397247f8736`의 desktop/mobile 상세와 `/api/products/[id]`는 HTTP 200이다.

## 품질·DB·관측성

- `npm test`: 344개 중 338 pass, 폐기된 PortOne 계약 6 skip, 실패 0.
- ESLint, `tsc --noEmit`, production build 124 static-generation entries 통과.
- Supabase migration 172개, linked dry-run pending 0.
- 새 Production의 1시간 runtime 집계는 HTTP 200 327건을 포함하며 5xx 0, runtime error cluster 0이다. 과거 CLI HTTP 400은 Vercel 관측성 connector로 대체되어 F-06은 해결됐다.
- Supabase advisor는 INFO 79, WARN 233이다. SECURITY DEFINER 232개는 04 문서에서 서명별 의도·guard를 검토했다. 남은 Auth leaked-password warning 1건은 Free 요금제에서 설정 API가 거부한 유료 기능 경계다.

## maintenance 해제 근거

재현 가능한 P0·P1·P2 기능 결함과 핵심 미실행 mutation은 남지 않았다. leaked-password 보호는 Kakao 고객 인증 경로에 적용되는 비밀번호가 없고, 별도 테스트 로그인은 강한 임의 비밀번호·same-origin·전용 rate limit·단일 고정 계정으로 제한되므로 현재 운영 차단 사유로 분류하지 않았다. Pro 이상으로 전환할 경우 즉시 해당 Auth 설정을 활성화해야 한다.

