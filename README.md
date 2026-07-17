# 다미네 구제

빈티지 의류 경매를 위한 vinext 기반 웹 애플리케이션입니다. Vercel의 SSR 런타임에서 실행하며, 상품·입찰·회원 인증·상담 채팅·이미지는 Supabase Database, Auth, Realtime, Storage에 저장합니다.

- 운영 도메인: <https://www.ninety-nine-vintage.store>
- Supabase 프로젝트: `bkwesxsznqupoqnwzzmn`
- 기준 시간대: `Asia/Seoul`

## 로컬 실행

Node.js 22.13 이상과 pnpm을 사용합니다.

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

브라우저에서 `http://localhost:3000`을 엽니다. `.env.local`에는 최소한 다음 공개 값을 설정합니다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://bkwesxsznqupoqnwzzmn.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

레거시 프로젝트는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 publishable key 대신 사용할 수 있습니다. `SUPABASE_SECRET_KEY`, service role key, 운영자 비밀번호에는 절대로 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

## Supabase 마이그레이션

Supabase CLI로 프로젝트를 연결한 뒤 `supabase/migrations`의 모든 마이그레이션을 적용합니다.

```powershell
pnpm dlx supabase@latest login
pnpm dlx supabase@latest link --project-ref bkwesxsznqupoqnwzzmn
pnpm dlx supabase@latest db push
pnpm dlx supabase@latest migration list
```

마이그레이션은 상품·입찰, `product-images` 버킷, 회원 프로필·배송지·택배 접수, 1:1 상담, 운영 센터 RPC와 RLS 정책을 구성합니다. 운영 DB에서 SQL을 수동 수정한 경우에는 같은 변경을 새 마이그레이션 파일로 남겨 환경 간 차이가 생기지 않게 합니다.

## 카카오 회원가입·로그인 설정

일반 회원은 Supabase Auth의 Kakao OAuth로 가입과 로그인을 한 번에 처리합니다.

1. Kakao Developers에서 앱의 웹 플랫폼 도메인에 `https://www.ninety-nine-vintage.store`를 등록합니다.
2. 카카오 로그인을 활성화하고 필요한 동의 항목을 설정합니다.
3. 카카오 로그인 Redirect URI에 아래 Supabase 콜백을 정확히 등록합니다.

   ```text
   https://bkwesxsznqupoqnwzzmn.supabase.co/auth/v1/callback
   ```

4. Supabase Dashboard의 Authentication > Providers > Kakao에 카카오 REST API 키와 Client Secret을 설정합니다.
5. Supabase Authentication > URL Configuration을 다음과 같이 설정합니다.

   ```text
   Site URL: https://www.ninety-nine-vintage.store
   Redirect URL: https://www.ninety-nine-vintage.store/auth/callback
   Local Redirect URL: http://localhost:3000/auth/callback
   ```

애플리케이션은 로그인 완료 후 `/auth/callback`에서 세션을 확인하고 메인 화면으로 이동합니다. Vercel Preview에서 OAuth를 시험하려면 사용할 Preview 도메인의 `/auth/callback`도 Supabase Redirect URLs에 별도로 허용해야 합니다.

## 관리자와 운영자 계정

기존 `app_metadata.role = admin` 관리자 계정은 그대로 유지합니다. 관리자 이메일과 비밀번호는 Supabase Auth에 등록된 기존 값으로 로그인합니다.

운영자는 배포 환경에서 지정한 서로 다른 두 아이디를 사용합니다. 실제 Auth 계정은 서버 전용 일회성 스크립트로 생성하며 이메일 확인은 요구하지 않습니다. 아이디는 영문 소문자로 시작하고 영문 소문자·숫자·밑줄·하이픈만 사용하는 3~32자로 정한 뒤, 다음 환경 변수를 터미널 세션이나 안전한 비밀 저장소에서 설정합니다.

```text
SUPABASE_URL=https://bkwesxsznqupoqnwzzmn.supabase.co
SUPABASE_SECRET_KEY=<server-only secret key>
OPERATOR01_ID=<first_operator_id>
OPERATOR01_PASSWORD=<12자 이상의 고유 비밀번호>
OPERATOR02_ID=<second_operator_id>
OPERATOR02_PASSWORD=<12자 이상의 고유 비밀번호>
```

레거시 키만 있는 프로젝트는 `SUPABASE_SERVICE_ROLE_KEY`를 대신 사용할 수 있습니다. 설정 후 실행합니다.

```powershell
pnpm operators:provision
```

스크립트는 멱등하게 동작하여 재실행 시 설정한 두 운영자 계정만 갱신합니다. 기존 관리자이거나 다른 역할의 계정 및 이미 다른 Auth 사용자와 연결된 운영자 슬롯과 충돌하면 즉시 중단하며 관리자 계정은 수정하지 않습니다. 두 계정 준비가 모두 끝나면 그 외 과거 운영자 슬롯을 해제하여 접근 권한을 차단합니다. 이때 `app_metadata.role = operator`인 퇴역 Auth 사용자는 삭제하거나 메타데이터를 변경하지 않으며, 슬롯이 없어 `is_staff()` 검증을 통과하지 못하는 상태로 보존합니다. 관리자와 회원 Auth 사용자는 퇴역 대상 판정이나 변경 대상에 포함하지 않습니다.

> `.env.local`, Supabase secret/service role key, 카카오 Client Secret, 운영자 비밀번호를 Git에 커밋하지 마세요. 로그·스크린샷·이슈·PR 본문에도 비밀 값을 남기지 않습니다.

## 역할과 권한

권한은 클라이언트 토글이 아니라 Supabase가 발급한 JWT의 `app_metadata.role`에서만 판정합니다.

| 역할 | 로그인 | 주요 권한 |
| --- | --- | --- |
| 회원 (`member`) | 카카오 OAuth | 공개 상품 조회·입찰, 본인 상담, 배송지 관리와 낙찰 상품 택배 접수 |
| 운영자 (`operator`) | 설정한 운영자 아이디와 비밀번호 | 전체 상담함·회원 현황 조회, 상품 단건/일괄 등록·수정·삭제 |
| 관리자 (`admin`) | 기존 관리자 이메일과 비밀번호 | 운영자 권한 전체, 회원 상태와 배송 이용권 변경 |

상품 수정과 삭제는 테이블 직접 쓰기가 아니라 검증 RPC를 사용합니다. 입찰이 있는 상품의 가격 변경·삭제, 마감 입찰 상품 재오픈은 서버에서 거부하며, 회원 정지와 배송 이용권 변경은 기존 관리자만 수행할 수 있습니다.

## 운영 센터와 상품 일괄 등록

관리자 메뉴는 `운영 센터`로 표시되며 관리자와 등록된 운영자가 접근합니다. 운영 현황, 회원 관리, 상품 관리, 상품 등록은 각각 독립적으로 열고 닫을 수 있습니다.

일괄 등록은 아직 고정 양식을 내려주지 않습니다. `.xlsx`의 상품명 또는 설명, 시작가, 이미지명 열을 자동 탐지하며 사진 폴더에서 상대 경로, 정확한 파일명, 고유한 확장자 제외 파일명 순으로 매칭합니다. 중복·모호·미매칭 사진이 하나라도 있으면 저장하지 않고 행별 오류를 먼저 표시합니다. Excel에 적힌 이미지명 순서가 Storage 업로드와 상품 사진 표시 순서가 됩니다.

## 경매 마감 규칙

모든 시각 판정은 한국시간 기준입니다.

- `20:56:00` 전: 정상 입찰
- `20:56:00`부터 `21:00:00` 전: 이미 입찰한 회원만 해당 상품에 계속 참여 가능
- 이 시간대에 입찰 기록이 전혀 없는 상품: 첫 입찰 한 건을 허용하고 그 금액으로 즉시 확정·잠금
- 즉시 확정된 상품: 추가 입찰 불가
- `21:00:00` 이후: 전체 마감

화면의 버튼 상태만 신뢰하지 않고, 입찰 저장 시 최신 상품과 입찰 원장을 트랜잭션 안에서 다시 확인해야 합니다. 그래야 20:56 이후 무입찰 상품에 동시에 들어온 두 요청 중 한 건만 확정할 수 있습니다.

## 1:1 상담 채팅 보안

회원 간 직접 채팅은 제공하지 않습니다. 회원 화면에는 본인과 운영팀의 단일 상담만 보이며, 관리자·운영자 화면은 회원별 대화함과 선택한 대화 내용을 나란히 다루는 상담 인터페이스를 사용합니다.

RLS의 핵심 원칙은 다음과 같습니다.

- 회원은 본인 소유 상담 스레드와 그 메시지만 읽고 전송할 수 있습니다.
- 회원은 다른 회원의 프로필, 상담방, 메시지를 조회할 수 없습니다.
- 운영자와 관리자는 전체 상담 목록과 메시지를 읽고 답변할 수 있습니다.
- 메시지 발신자는 현재 인증된 `auth.uid()`와 일치해야 합니다.
- 브라우저의 필터링이 아니라 Database RLS가 접근을 최종 차단합니다.

상담 테이블의 Realtime 구독도 동일한 RLS를 적용받으므로, 구독 이벤트만으로 다른 회원의 대화가 노출되지 않아야 합니다.

## 배포

Vercel 프로젝트에 아래 공개 환경 변수만 등록합니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

`vercel.json`과 Vite 설정은 vinext를 정적 사이트가 아닌 Nitro/Vercel SSR 출력으로 빌드합니다. pnpm이 네이티브 빌드 스크립트를 차단하지 않도록 `pnpm-workspace.yaml`의 허용 목록도 유지합니다.

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm dlx vercel@latest --prod --yes
```

## 배포 후 확인

최소한 다음 항목을 실제 운영 도메인에서 확인합니다.

- `/`와 `/auth/callback`이 404 없이 열리고 SSR 응답을 반환하는지
- 카카오 신규 가입·재로그인·로그아웃이 정상인지
- 기존 관리자 로그인이 유지되고 설정한 두 계정만 운영자 권한을 갖는지
- 일반 회원에게 공개 시각 이전 또는 비활성 상품이 노출되지 않는지
- 사진 업로드 후 Storage Public URL과 상품 레코드가 함께 저장되는지
- 운영 센터에서 회원 상태를 조회하고 상품 단건/일괄 등록·수정·삭제가 권한대로 동작하는지
- 회원 배송지 패널이 기본으로 닫히며 낙찰 상품 택배 접수 후 배송 이용권이 1회 차감되는지
- 20:56 전후, 무입찰 즉시 확정, 21:00 마감 경계가 정확한지
- 회원 A가 회원 B의 상담방·메시지를 REST와 Realtime 모두에서 읽지 못하는지
- 운영자·관리자 상담함에서 여러 회원의 대화를 선택해 답변할 수 있는지

운영 검증 중에는 브라우저 콘솔뿐 아니라 Supabase Auth/Database 로그와 Vercel Function 로그도 함께 확인합니다.
