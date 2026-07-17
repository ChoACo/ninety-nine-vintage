# Supabase 연결 준비

1. Supabase CLI에서 `supabase db push`를 실행해 `migrations` 폴더의 모든
   마이그레이션을 순서대로 적용합니다.
2. 모든 사용자는 먼저 카카오로 가입합니다. 운영 권한은
   `account_access_roles`와 Kakao identity를 함께 검증하는 서버 RPC로만 부여합니다.
3. `.env.example`을 참고해 로컬 `.env.local`과 Vercel 프로젝트 환경 변수에
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정합니다.
4. 허용된 운영자 또는 직원의 카카오 세션으로 상품을 등록합니다.

마이그레이션에는 다음 구성이 포함됩니다.

- `products` 테이블과 공개 피드 인덱스
- 공개 `product-images` Storage 버킷
- 일반 사용자는 `active`이면서 공개 시각이 지난 상품만 읽는 RLS
- 역할별 상품·사진 생성/수정/삭제 RLS
- Products Realtime publication
- 매분 공개 시각이 지난 `pending` 상품을 `active`로 바꾸는 Supabase Cron
- 카카오 회원 전용 프로필·입찰 RPC와 20:56/21:00 서버 시각 경계
- 숨겨진 총책임 운영 계정, 운영자·직원·밴드 회원·일반 회원 권한과 최근 접속 기록
- 날짜당 한 행만 저장하는 일 매출과 일·주·월·연 합산 RPC
- 누적 경고 3회 제재, 제재 회차별 입찰 제한, 진행 중 입찰 취소 감사 원장
- 운영자별로 격리된 회원 상담, 직원 내부 대화, 상품 등록자 기반 문의 라우팅

브라우저에는 publishable key만 사용합니다. `service_role` 또는 secret key는
RLS를 우회하므로 이 프로젝트의 `NEXT_PUBLIC_*` 환경 변수에 넣으면 안 됩니다.
