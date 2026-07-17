# PortOne V2 테스트 결제 설정

이 프로젝트의 결제 금액과 낙찰자는 브라우저가 아니라 Supabase의 낙찰 원장에서
확정합니다. 결제창을 열기 전에 서버가 주문을 준비하고 포트원에 금액을 사전 등록하며,
브라우저 응답과 웹훅 모두 포트원 단건 조회를 거친 뒤에만 결제 상태를 변경합니다.

## 1. PortOne 콘솔 값 준비

PortOne 콘솔의 **결제 연동 > 연동 관리**에서 다음 값을 확인합니다.

- Store ID: `store-...`
- 테스트 채널 키: `channel-key-...`
- V2 API Secret
- 테스트 웹훅 Secret

`iamporttest_3`는 토스페이먼츠 테스트 채널에 사용하는 PG MID이며 V2 Store ID가
아닙니다. 코드의 `VITE_PORTONE_STORE_ID`에는 반드시 콘솔에 표시된 `store-...` 값을
넣어야 합니다.

## 2. 환경변수

로컬 `.env.local`과 Vercel의 Production/Preview 환경에 아래 값을 설정합니다.

```dotenv
VITE_PORTONE_STORE_ID=store-실제값
VITE_PORTONE_CHANNEL_KEY=channel-key-기본_카드채널
VITE_PORTONE_CARD_CHANNEL_KEY=channel-key-카드채널
VITE_PORTONE_VIRTUAL_ACCOUNT_CHANNEL_KEY=channel-key-가상계좌채널
VITE_PORTONE_KAKAOPAY_CHANNEL_KEY=channel-key-카카오페이채널
VITE_PORTONE_WEBHOOK_URL=https://www.ninety-nine-vintage.store/api/webhook/portone
PORTONE_API_SECRET=서버전용_V2_API_SECRET
PORTONE_WEBHOOK_SECRET=서버전용_웹훅_SECRET
PORTONE_CHANNEL_MODE=TEST
```

`VITE_` 값은 결제창 호출에 필요한 공개 식별자입니다. `PORTONE_API_SECRET`과
`PORTONE_WEBHOOK_SECRET`은 서로 다른 서버 전용 비밀값이므로 `VITE_` 접두사를
붙이거나 저장소에 커밋하면 안 됩니다.

## 3. Supabase 마이그레이션

최신 `supabase/migrations`를 적용합니다. 결제 데이터는 공개 피드인 `products`에
저장하지 않고 RLS가 적용된 `payment_orders`와 `payment_attempts`에 저장됩니다.
회원은 본인 주문만 읽을 수 있고, 준비·검증·갱신은 서버 전용 RPC만 수행합니다.

## 4. 웹훅 등록

PortOne 테스트 웹훅 URL을 아래처럼 등록하고 웹훅 버전은 `2024-04-25`를 사용합니다.

```text
https://www.ninety-nine-vintage.store/api/webhook/portone
```

웹훅 엔드포인트는 JSON 파싱 전 원문과 세 서명 헤더를 공식 서버 SDK로 검증합니다.
그 뒤 `paymentId`로 V2 단건 조회를 수행하고 Store ID, 결제 ID, 원화 통화와 서버
확정 금액이 모두 일치할 때만 `가상계좌발급` 또는 `결제완료`로 갱신합니다.

## 5. 테스트 순서

1. 마감된 경매의 실제 최고 입찰자 카카오 계정으로 로그인합니다.
2. **내 정보 > 낙찰·보관 상품**에서 카드, 카카오페이 또는 가상계좌를 선택합니다.
3. 카드/간편결제는 서버 검증 뒤 `결제완료`인지 확인합니다.
4. 가상계좌는 먼저 `가상계좌발급`과 계좌·기한이 보이는지 확인합니다.
5. 테스트 입금 이벤트 뒤 웹훅으로 `결제완료`가 되는지 확인합니다.
6. 미결제 상품은 화면과 DB 양쪽에서 택배 접수가 거부되는지 확인합니다.

결제수단별 채널 환경변수가 없으면 `VITE_PORTONE_CHANNEL_KEY`로 폴백합니다. KCP의
카드·가상계좌와 카카오페이 다이렉트처럼 채널이 분리된 경우에는 각각의 채널키를
설정해야 합니다. 테스트 채널이 특정 간편결제를 활성화하지 않았다면 해당 결제수단은
PG 창에서 사용할 수 없으므로 PortOne 콘솔의 지원 결제수단을 먼저 확인합니다.
