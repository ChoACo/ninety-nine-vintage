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

레거시 프로젝트는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 publishable key 대신 사용할 수 있습니다. `SUPABASE_SECRET_KEY`, service role key, 카카오 Client Secret에는 절대로 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

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

모든 회원과 운영 스태프는 카카오 OIDC와 Supabase Auth를 연결해 가입과 로그인을 한 번에 처리합니다.
인가 요청에는 `scope`를 직접 넣지 않고 Kakao Developers에 실제로 설정된 동의항목만
사용하므로, 심사 전 미승인 항목을 요청해 발생하는 KOE205를 방지합니다.

1. Kakao Developers에서 앱의 웹 플랫폼 도메인에 `https://www.ninety-nine-vintage.store`를 등록합니다.
2. 카카오 로그인과 OpenID Connect를 활성화합니다.
3. 카카오 로그인 Redirect URI에 아래 서버 콜백을 정확히 등록합니다.

   ```text
   https://www.ninety-nine-vintage.store/api/auth/kakao/oidc
   ```

4. Vercel 서버 환경에 `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`,
   `KAKAO_OIDC_REDIRECT_URI`와 `SUPABASE_SECRET_KEY`를 설정합니다. Client Secret과
   Supabase secret key에는 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.
5. 개인정보 동의항목 권한 심사 전에는 현재 설정된 닉네임만 사용합니다. 사업자 정보가
   등록된 비즈 앱에서 심사 승인을 받은 뒤 Kakao Developers > 카카오 로그인 >
   동의항목에서 이름(`name`), 성별(`gender`), 출생연도(`birthyear`)를 필수 동의로
   저장합니다. 이메일(`account_email`)과 카카오계정 전화번호(`phone_number`)는
   설정하거나 요청하지 않습니다.
6. 심사 자료에는 다음 공개 URL을 사용합니다.

   ```text
   회원가입 URL: https://www.ninety-nine-vintage.store/signup
   개인정보처리방침 URL: https://www.ninety-nine-vintage.store/privacy
   ```

서버는 카카오 액세스 토큰으로 OIDC UserInfo를 한 번 조회해 이름·성별·출생연도를
민감정보 테이블에 저장한 뒤 토큰을 폐기합니다. 카카오 앱별 회원번호(`sub`)에는
UNIQUE 제약을 적용해 같은 카카오 계정의 중복 가입을 차단합니다. 이메일이나 전화번호는
변경될 수 있으므로 회원 고유키로 사용하지 않습니다.

심사 승인 및 동의항목 저장을 모두 확인한 뒤 아래 SQL을 한 번 실행하면, 이름·성별·
출생연도 세 값이 확인되지 않은 세션은 회원 기능을 사용할 수 없습니다. 승인 전에는
반드시 `false`를 유지해야 KOE205 없이 기존 닉네임 로그인으로 심사 자료를 준비할 수
있습니다.

```sql
update public.kakao_profile_requirements
set enforce_verified_profile = true, updated_at = now()
where singleton;
```

## 운영 계정

회원·직원·운영자는 먼저 자신의 카카오 계정으로 가입합니다. 권한이 있는 운영 계정은 같은 카카오 로그인 버튼으로 들어오며 별도 아이디·비밀번호 입력창은 없습니다. 권한 변경은 `account_access_roles`와 서버 RPC에서만 수행합니다.

서비스 총책임자 계정도 카카오로 로그인하고 외부에는 언제나 `운영자`로만 표시됩니다. 이 계정은 온라인 명단과 일반 회원 목록에서 제외되며, 본인에게만 보이는 모드 전환 버튼으로 기본 `운영자 모드`와 전용 `관리자 모드`를 선택합니다. 관리자 모드는 화면 편의를 위한 전용 UI이며 실제 권한의 최종 판정은 항상 Database 함수와 RLS가 수행합니다.

> `.env.local`, Supabase secret/service role key, 카카오 Client Secret을 Git에 커밋하지 마세요. 로그·스크린샷·이슈·PR 본문에도 비밀 값을 남기지 않습니다.

## 역할과 권한

권한은 클라이언트 토글이 아니라 `account_access_roles`와 Kakao identity를 확인하는 Supabase 함수에서 판정합니다. 내부 최고 권한 값은 회원·직원·운영자 화면에 반환하지 않습니다.

| 역할 | 로그인 | 주요 권한 |
| --- | --- | --- |
| 일반 회원 (`member`) | 카카오 | 공개 상품 조회·입찰, 본인 상담, 배송지 관리와 낙찰 상품 택배 접수 |
| 밴드 기존 회원 (`band_member`) | 카카오 | 일반 회원과 동일하며 결제 마감·결제 지연 경고 면제 |
| 직원 (`employee`) | 카카오 | 상품 단건/일괄 등록, 배송 대기 처리, 지정 운영자와 내부 대화 |
| 운영자 (`operator`) | 카카오 | 회원·경고·배송·상품 관리, 본인에게 배정된 상담함 |
| 총책임 운영 계정 | 카카오 | 모든 운영 기능, 운영자별 상담 읽기 전용 감사, 운영자 지정 |

상품 수정과 삭제는 테이블 직접 쓰기가 아니라 검증 RPC를 사용합니다. 입찰이 있는 상품의 가격 변경·삭제, 마감 입찰 상품 재오픈은 서버에서 거부합니다. 경고는 3회마다 제재로 전환되고 제재 회차만큼 입찰 제한 일수가 늘어나며, 제재 시 진행 중인 해당 회원 입찰은 감사 테이블로 옮긴 뒤 취소합니다.

## 운영 센터와 상품 일괄 등록

운영 메뉴는 `운영 센터`로 표시됩니다. 운영 현황, 매출, 배송, 회원 관리, 상품 관리, 상품 등록은 각각 독립적으로 열고 닫을 수 있습니다. 매출은 실제 입금이 확인된 하루 합계와 결제 건수만 날짜당 한 행으로 저장하고 일·주·월·연 단위로 합산합니다.

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

회원 간 직접 채팅은 제공하지 않습니다. 회원은 본인의 일반 상담과 상품 문의만 보고, 상품 문의는 상품을 등록한 운영자 또는 직원의 담당 운영자에게 연결됩니다. 직원은 지정 운영자와의 내부 대화만 볼 수 있습니다.

RLS의 핵심 원칙은 다음과 같습니다.

- 회원은 본인 소유 상담 스레드와 그 메시지만 읽고 전송할 수 있습니다.
- 회원은 다른 회원의 프로필, 상담방, 메시지를 조회할 수 없습니다.
- 운영자는 본인에게 배정된 상담만 읽고 답변하며 다른 운영자의 상담함은 볼 수 없습니다.
- 총책임 운영 계정은 전용 모드에서 운영자별 상담함을 읽기 전용으로 확인하며 메시지는 보내지 않습니다.
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
- 이메일·비밀번호 입력 없이 모든 계정이 카카오로만 로그인하는지
- 총책임 운영 계정이 외부에 운영자로만 보이고 온라인 명단에 나타나지 않는지
- 일반 회원에게 공개 시각 이전 또는 비활성 상품이 노출되지 않는지
- 사진 업로드 후 Storage Public URL과 상품 레코드가 함께 저장되는지
- 운영 센터에서 회원 상태를 조회하고 상품 단건/일괄 등록·수정·삭제가 권한대로 동작하는지
- 회원 배송지 패널이 기본으로 닫히며 낙찰 상품 택배 접수 후 배송 이용권이 1회 차감되는지
- 20:56 전후, 무입찰 즉시 확정, 21:00 마감 경계가 정확한지
- 회원 A가 회원 B의 상담방·메시지를 REST와 Realtime 모두에서 읽지 못하는지
- 운영자는 본인 상담에만 답변하고 총책임 운영 계정은 운영자별 상담을 읽기 전용으로만 확인하는지

운영 검증 중에는 브라우저 콘솔뿐 아니라 Supabase Auth/Database 로그와 Vercel Function 로그도 함께 확인합니다.
