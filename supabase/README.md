# Supabase 연결 준비

1. Supabase CLI에서 `supabase db push`를 실행해 `migrations` 폴더의 모든
   마이그레이션을 순서대로 적용합니다.
2. 관리자 계정은 Supabase Auth 사용자로 만든 뒤 서버에서 관리되는
   `app_metadata.role` 값을 `admin`으로 설정합니다. 브라우저에서 변경 가능한
   `user_metadata`는 관리자 판정에 사용하지 않습니다.
3. `.env.example`을 참고해 로컬 `.env.local`과 Vercel 프로젝트 환경 변수에
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정합니다.
4. 관리자 계정의 Supabase Auth 세션이 있는 상태에서 상품을 등록합니다.

마이그레이션에는 다음 구성이 포함됩니다.

- `products` 테이블과 공개 피드 인덱스
- 공개 `product-images` Storage 버킷
- 일반 사용자는 `active`이면서 공개 시각이 지난 상품만 읽는 RLS
- `app_metadata.role = admin`인 사용자만 상품·사진을 생성/수정/삭제하는 RLS
- Products Realtime publication
- 매분 공개 시각이 지난 `pending` 상품을 `active`로 바꾸는 Supabase Cron
- 카카오 회원 전용 프로필·입찰 RPC와 20:56/21:00 서버 시각 경계
- 기존 관리자 보존 및 `operator01~03` 운영자 슬롯 검증
- 회원별 비공개 운영팀 상담, 읽음 처리, Realtime publication

브라우저에는 publishable key만 사용합니다. `service_role` 또는 secret key는
RLS를 우회하므로 이 프로젝트의 `NEXT_PUBLIC_*` 환경 변수에 넣으면 안 됩니다.
