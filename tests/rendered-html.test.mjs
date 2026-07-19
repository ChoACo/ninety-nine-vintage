import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Supabase-backed auction application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>나인티 나인 빈티지 \| 투명한 빈티지 의류 경매<\/title>/i,
  );
  assert.match(html, /나인티 나인 빈티지/);
  assert.doesNotMatch(html, /다미네 구제|DAMINE VINTAGE/i);
  assert.match(html, /오늘 단 한 번/);
  assert.match(html, /전체 경매 피드 보기/);
  assert.match(html, /commerce-skeleton/);
  assert.match(html, /카카오로 시작하기/);
  assert.doesNotMatch(html, /버버리 체크 안감|카멜 핸드메이드|Mock Data/i);
});

test("keeps the OAuth callback on the vinext SSR router", async () => {
  const response = await render("/auth/callback");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /카카오 로그인 확인 중/);
  assert.doesNotMatch(html, /404: NOT_FOUND|Code: NOT_FOUND/);
});

test("publishes PG review business, terms, privacy, refund, and price information", async () => {
  const [footer, termsSource, refundSource, privacySource, productCard, soldFeed] = await Promise.all([
    source("src/components/common/BusinessFooter.tsx"),
    source("app/terms/page.tsx"),
    source("app/refund/page.tsx"),
    source("app/privacy/page.tsx"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/feed/SoldAuctionFeed.tsx"),
  ]);
  const [homeResponse, termsResponse, privacyResponse, refundResponse] = await Promise.all([
    render("/"),
    render("/terms"),
    render("/privacy"),
    render("/refund"),
  ]);

  for (const response of [homeResponse, termsResponse, privacyResponse, refundResponse]) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  }

  const [home, terms, privacy, refund] = await Promise.all([
    homeResponse.text(),
    termsResponse.text(),
    privacyResponse.text(),
    refundResponse.text(),
  ]);

  for (const html of [home, terms, privacy, refund]) {
    assert.match(html, /나인티 나인 빈티지/);
    assert.match(html, /875-07-03297/);
    assert.match(html, /이영준/);
    assert.match(html, /0507-1494-3519/);
    assert.match(html, /ninety-nine@kakao\.com/);
    assert.match(html, /\/terms/);
    assert.match(html, /\/privacy/);
    assert.match(html, /\/refund/);
  }

  assert.match(footer, /부산광역시 수영구 수미로50번길 37-1/);
  assert.match(footer, /통신판매업 신고 면제 사유/);
  assert.match(footer, /간이과세자/);
  assert.match(footer, /<details className=/);
  assert.match(footer, /<summary className=/);
  assert.match(footer, /사업자 정보 열기 또는 닫기/);
  assert.doesNotMatch(footer, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.doesNotMatch(footer, /1973|생년월일|개업 연월일|발급 사유/);
  assert.match(terms, /서비스 이용약관/);
  assert.match(termsSource, /최고 유효 입찰가가 낙찰가/);
  assert.match(termsSource, /공개 닉네임, 입찰 시각과 입찰 금액을 마스킹 없이/);
  assert.match(termsSource, /중고품, 단일 재고 또는 경매 상품이라는 이유만으로/);
  assert.match(privacy, /개인정보처리방침/);
  assert.match(privacySource, /개인정보 보호 담당/);
  assert.match(privacySource, /접속 IP, 세션·요청 식별자/);
  assert.match(privacySource, /운영 총책임자만/);
  assert.match(privacySource, /IP 일부를 가리거나 통계 형태/);
  assert.match(privacySource, /필수 동의와 선택 동의를/);
  assert.match(privacySource, /접속·활동 기록의 열람/);
  assert.match(privacySource, /최대 24시간/);
  assert.match(privacySource, /최소 1년/);
  assert.match(privacySource, /90일/);
  assert.match(refund, /취소·반품·환불 및 청약철회 정책/);
  assert.match(refundSource, /7일 이내/);
  assert.match(refundSource, /3개월 이내/);
  assert.match(refundSource, /30일/);
  assert.match(refundSource, /3영업일 이내/);
  assert.match(refundSource, /반환 비용은 회사가 부담/);
  assert.match(productCard, /시작 가격/);
  assert.match(productCard, /현재 입찰가/);
  assert.match(productCard, /formatKRW\(displayedPrice\)/);
  assert.match(soldFeed, /공개 닉네임을 투명하게 확인/);
  assert.doesNotMatch(soldFeed, /낙찰자 닉네임은[^\n]*일부만 표시/);
});

test("renders canonical product information with optional condition and legacy fallback", async () => {
  const [detailSource, productCard] = await Promise.all([
    source("src/utils/productFeedDetails.ts"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/feed/SoldAuctionFeed.tsx"),
  ]);
  const compiled = ts.transpileModule(detailSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const details = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );

  assert.deepEqual(
    details.getProductFeedDetails({
      title: "BOSS 셔츠 화이트",
      description:
        "Name: BOSS 셔츠 화이트\nSize : 100 / 추천 L\n상품상태: 새상품",
    }),
    {
      isCanonical: true,
      name: "BOSS 셔츠 화이트",
      size: "100 / 추천 L",
      condition: "새상품",
      legacyDescription:
        "Name: BOSS 셔츠 화이트\nSize : 100 / 추천 L\n상품상태: 새상품",
    },
  );
  assert.deepEqual(
    details.getProductFeedDetails({
      title: "구형 등록 상품",
      description: "예전에 등록한 자유 형식 설명",
    }),
    {
      isCanonical: false,
      name: "예전에 등록한 자유 형식 설명",
      size: undefined,
      condition: undefined,
      legacyDescription: "예전에 등록한 자유 형식 설명",
    },
  );
  assert.deepEqual(
    details.getProductFeedDetails({
      title: "Code:graphy 셔츠 네이비",
      description:
        "Name: Code:graphy 셔츠 네이비\nSize : 95 / 추천 M",
    }),
    {
      isCanonical: true,
      name: "Code:graphy 셔츠 네이비",
      size: "95 / 추천 M",
      condition: undefined,
      legacyDescription:
        "Name: Code:graphy 셔츠 네이비\nSize : 95 / 추천 M",
    },
  );
  for (const legacyDescription of [
    "Size : 100 / 추천 L\nName: BOSS 셔츠 화이트",
    "Name: BOSS 셔츠 화이트\nSize : 100 / 추천 L\n자유 설명",
    "Name: BOSS 셔츠 화이트\nSize : 100 / 추천 L\n상품상태: 새상품\n추가 설명",
    "Name: BOSS 셔츠 화이트\nName: 중복 상품명\nSize : 100 / 추천 L",
  ]) {
    const parsed = details.getProductFeedDetails({
      title: "BOSS 셔츠 화이트",
      description: legacyDescription,
    });
    assert.equal(parsed.isCanonical, false);
    assert.equal(parsed.legacyDescription, legacyDescription);
  }

  assert.match(productCard, /aria-label="상품 정보"/);
  assert.match(productCard, />Name:<\/dt>/);
  assert.match(productCard, />Size :<\/dt>/);
  assert.match(productCard, />상품상태:<\/dt>/);
  assert.match(productCard, /productDetails\.isCanonical/);
  assert.match(productCard, /productDetails\.legacyDescription/);
});

test("server-renders a persistent light and dark theme selector", async () => {
  const [layout, globalStyles, toggle, toggleStyles, header, commonExports] = await Promise.all([
    source("app/layout.tsx"),
    source("app/globals.css"),
    source("src/components/common/ThemeToggle.tsx"),
    source("src/components/common/ThemeToggle.module.css"),
    source("src/components/common/SiteHeader.tsx"),
    source("src/components/common/index.ts"),
  ]);
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(layout, /data-theme="light"/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /localStorage\.getItem\(storageKey\)/);
  assert.match(layout, /root\.dataset\.theme = theme/);
  assert.match(globalStyles, /:root\[data-theme="dark"\]/);
  assert.match(globalStyles, /--app-gradient:/);
  assert.match(globalStyles, /--surface-raised:/);
  assert.match(globalStyles, /\[class~="bg-\[#fee500\]"\]/);
  assert.match(toggle, /THEME_STORAGE_KEY = "ninety-nine-theme"/);
  assert.match(toggle, /LEGACY_THEME_STORAGE_KEY = "damine-theme"/);
  assert.match(toggle, /localStorage\.setItem\(THEME_STORAGE_KEY, nextTheme\)/);
  assert.match(toggle, /aria-pressed=\{theme === "light"\}/);
  assert.match(toggle, /aria-pressed=\{theme === "dark"\}/);
  assert.match(toggle, /addEventListener\("storage", syncTheme\)/);
  assert.match(toggleStyles, /min-height:\s*44px/);
  assert.match(toggleStyles, /html\[data-theme="dark"\]/);
  assert.match(header, /<ThemeToggle \/>/);
  assert.match(commonExports, /ThemeToggle/);

  assert.match(html, /<html[^>]*data-theme="light"/i);
  assert.match(html, /ninety-nine-theme/);
  assert.match(html, /damine-theme/);
  assert.match(html, /aria-label="화면 테마 선택"/);
  assert.match(
    html,
    /aria-pressed="true"[^>]*>[\s\S]*?라이트[\s\S]*?<\/button>/,
  );
  assert.match(
    html,
    /aria-pressed="false"[^>]*>[\s\S]*?다크[\s\S]*?<\/button>/,
  );
});

test("keeps Vercel routes on the Nitro SSR output", async () => {
  const [viteConfig, vercelSource] = await Promise.all([
    source("vite.config.ts"),
    source("vercel.json"),
  ]);
  const vercel = JSON.parse(vercelSource);

  assert.match(viteConfig, /process\.env\.VERCEL === "1"/);
  assert.match(viteConfig, /nitro\(\{ renderer: false \}\)/);
  assert.equal(vercel.framework, "nitro");
  assert.equal(vercel.buildCommand, "pnpm exec vite build");
  assert.equal(vercel.outputDirectory, null);
});

test("keeps native build dependencies approved in both pnpm config locations", async () => {
  const [packageSource, workspace] = await Promise.all([
    source("package.json"),
    source("pnpm-workspace.yaml"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const expected = ["esbuild", "sharp", "unrs-resolver", "workerd"];

  assert.deepEqual(packageJson.pnpm.onlyBuiltDependencies, expected);
  for (const dependency of expected) {
    assert.match(workspace, new RegExp(`- ${dependency}\\b`));
  }
});

test("uses console-approved Kakao OIDC consent as the only interactive login", async () => {
  const [auth, authSession, modal, callback, oidcHelper, oidcStart, oidcCallback, oidcSession, oidcProfile, kakaoMigration, requirementMigration, privacy, signup, environmentExample, packageSource, auctionApp] = await Promise.all([
    source("src/lib/supabase/auth.ts"),
    source("src/hooks/useAuthSession.ts"),
    source("src/components/auth/AuthModal.tsx"),
    source("app/auth/callback/page.tsx"),
    source("src/lib/kakao/oidc.ts"),
    source("app/api/auth/kakao/start/route.ts"),
    source("app/api/auth/kakao/oidc/route.ts"),
    source("app/api/auth/kakao/session/route.ts"),
    source("app/api/auth/kakao/profile/route.ts"),
    source("supabase/migrations/20260718020000_add_verified_kakao_profiles.sql"),
    source("supabase/migrations/20260718023000_gate_required_kakao_profiles.sql"),
    source("app/privacy/page.tsx"),
    source("app/signup/page.tsx"),
    source(".env.example"),
    source("package.json"),
    source("src/components/AuctionApp.tsx"),
  ]);

  assert.match(auth, /window\.location\.assign\("\/api\/auth\/kakao\/start"\)/);
  assert.doesNotMatch(auth, /signInWithPassword|signInStaff|signInOwner/);
  assert.doesNotMatch(auth, /signInWithOAuth/);
  assert.match(auth, /"unauthorized"/);
  assert.match(auth, /providers\.includes\("kakao"\)/);
  assert.match(auth, /if \(!hasKakaoProvider\) return "unauthorized"/);
  assert.match(auth, /if \(!hasMemberCompatibleRole\) return "unauthorized"/);
  assert.match(authSession, /"current_access_role"/);
  assert.match(authSession, /mapAccessRoleToAppRole\(accessRole\)/);
  assert.match(authSession, /nextRole === "employee"[\s\S]*"can_manage_products"/);
  assert.match(authSession, /if \(nextRole !== "admin"\)[\s\S]*touch_my_last_seen/);
  assert.match(authSession, /client\.auth\.signOut\(\)/);
  assert.match(modal, /카카오로 로그인/);
  assert.match(modal, /회원과 운영 스태프는 모두 카카오 계정으로 로그인/);
  assert.doesNotMatch(modal, /type="(?:email|password)"|아이디로 로그인|signInWithPassword/);
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(callback, /signInWithIdToken/);
  assert.match(callback, /provider:\s*"kakao"/);
  assert.match(callback, /\/api\/auth\/kakao\/session/);
  assert.match(callback, /\/api\/auth\/kakao\/profile/);
  assert.doesNotMatch(oidcHelper, /searchParams\.set\("scope"/);
  assert.match(oidcHelper, /omit `scope`/);
  assert.match(oidcHelper, /hashTokenSha256/);
  assert.match(oidcHelper, /HttpOnly/);
  assert.match(oidcHelper, /SameSite=Lax/);
  assert.match(oidcHelper, /timingSafeStringEqual/);
  assert.match(oidcStart, /KAKAO_STATE_COOKIE/);
  assert.match(oidcStart, /KAKAO_NONCE_COOKIE/);
  assert.match(oidcStart, /hashTokenSha256\(rawNonce\)/);
  assert.match(oidcCallback, /client_secret:\s*configuration\.clientSecret/);
  assert.match(oidcCallback, /AbortSignal\.timeout/);
  assert.match(oidcSession, /hasTrustedRequestOrigin/);
  assert.match(oidcSession, /clearHttpOnlyCookie/);
  assert.match(oidcProfile, /KAKAO_USERINFO_ENDPOINT/);
  assert.match(oidcProfile, /userHasKakaoSubject/);
  assert.match(oidcProfile, /identity\.provider !== "kakao"/);
  assert.doesNotMatch(oidcProfile, /user\.user_metadata/);
  assert.match(oidcProfile, /\.from\("kakao_member_profiles"\)/);
  assert.match(oidcProfile, /fullName && gender && birthYear/);
  assert.match(oidcProfile, /enforce_verified_profile/);
  assert.match(oidcProfile, /required_profile_incomplete/);
  assert.doesNotMatch(oidcProfile, /userInfo\.(?:email|phone_number)/);
  assert.match(kakaoMigration, /kakao_subject text not null unique/);
  assert.match(kakaoMigration, /full_name text/);
  assert.match(kakaoMigration, /gender text/);
  assert.match(kakaoMigration, /birth_year smallint/);
  assert.doesNotMatch(kakaoMigration, /create policy "Staff read verified Kakao profiles"/);
  assert.doesNotMatch(kakaoMigration, /account_email|phone_number/);
  assert.match(requirementMigration, /enforce_verified_profile boolean not null default false/);
  assert.match(requirementMigration, /public\.has_required_kakao_profile\(\)/);
  assert.match(requirementMigration, /and kakao_profiles\.profile_complete/);
  assert.match(requirementMigration, /and public\.has_required_kakao_profile\(\)/);
  assert.match(privacy, /개인정보처리방침/);
  assert.match(privacy, /이름/);
  assert.match(privacy, /성별/);
  assert.match(privacy, /출생연도/);
  assert.match(signup, /이메일과 카카오계정 전화번호는 동의 요청하지 않습니다/);
  assert.match(callback, /kakaoSessionCreated = true/);
  assert.match(callback, /if \(kakaoSessionCreated\)/);
  assert.doesNotMatch(environmentExample, /OPERATOR\d+_(?:ID|PASSWORD)=/);
  assert.match(environmentExample, /KAKAO_REST_API_KEY=/);
  assert.match(environmentExample, /KAKAO_CLIENT_SECRET=/);
  assert.doesNotMatch(environmentExample, /NEXT_PUBLIC_KAKAO_CLIENT_SECRET/);
  assert.doesNotMatch(packageSource, /operators:provision|provision-operators/);
  await assert.rejects(access(new URL("scripts/provision-operators.mjs", rootUrl)));
  assert.doesNotMatch(auctionApp, /RoleToggle|MOCK_BIDDER|chatThreadState/);
});

test("enforces private member-to-staff chat in SQL and UI", async () => {
  const [migration, hardening, kakaoOnly, routing, supportFix, repository, chatPage, floatingChat, staffInbox, hook, auctionApp] = await Promise.all([
    source("supabase/migrations/20260717210000_add_accounts_support_and_bids.sql"),
    source("supabase/migrations/20260717220000_harden_auth_chat_bids.sql"),
    source("supabase/migrations/20260717230000_require_kakao_for_members.sql"),
    source("supabase/migrations/20260718031000_route_support_by_operator.sql"),
    source("supabase/migrations/20260718052000_fix_support_inbox_and_product_inquiries.sql"),
    source("src/lib/supabase/supportChat.ts"),
    source("src/components/chat/ChatPage.tsx"),
    source("src/components/chat/FloatingAdminChat.tsx"),
    source("src/components/chat/StaffChatInbox.tsx"),
    source("src/hooks/useSupportChat.ts"),
    source("src/components/AuctionApp.tsx"),
  ]);

  assert.match(migration, /create table if not exists public\.support_conversations/);
  assert.match(migration, /member_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /sender_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /or \(select public\.is_staff\(\)\)/);
  assert.match(migration, /revoke all on public\.support_messages/);
  assert.match(migration, /grant insert \(conversation_id, sender_id, body, client_nonce\)/);
  assert.match(migration, /char_length\(btrim\(body\)\) between 1 and 2000/);
  assert.match(hardening, /create or replace function public\.is_member/);
  assert.match(kakaoOnly, /'provider'\) = 'kakao'/);
  assert.match(kakaoOnly, /'providers'\) \? 'kakao'/);
  assert.match(kakaoOnly, /'role'\) is null/);
  assert.match(hardening, /create or replace function public\.mark_support_conversation_read/);
  assert.match(hardening, /create or replace function public\.reopen_my_support_conversation/);
  assert.match(hardening, /revoke update \(last_read_at\)/);
  assert.match(repository, /MAX_SUPPORT_MESSAGE_LENGTH = 2_000/);
  assert.match(repository, /fetchMemberSupportConversation/);
  assert.match(repository, /startProductInquiry/);
  assert.match(repository, /"start_product_inquiry"/);
  assert.match(supportFix, /create or replace function public\.start_product_inquiry/);
  assert.match(supportFix, /where last_message_at is not null/);
  assert.match(repository, /getOrCreateEmployeeSupportConversation/);
  assert.match(repository, /fetchStaffSupportInbox\([\s\S]*inboxOperatorId/);
  assert.match(chatPage, /<MemberChat key=\{userId\} userId=\{userId\}/);
  assert.match(chatPage, /<EmployeeChat key=\{userId\} userId=\{userId\}/);
  assert.match(chatPage, /<StaffChatInbox key=\{userId\} staffId=\{userId\} role=\{role\}/);
  assert.match(floatingChat, /isOpen \? \(/);
  assert.match(floatingChat, /<MemberFloatingChat\s+key=\{userId\}/);
  assert.match(floatingChat, /새 문의 시작/);
  assert.doesNotMatch(floatingChat, /disabled=\{!chat\.conversation/);
  assert.match(hook, /participantType === "employee"[\s\S]*getOrCreateEmployeeSupportConversation/);
  assert.match(hook, /export function useEmployeeSupportChat/);
  assert.match(hook, /fetchMemberSupportThreads/);
  assert.match(hook, /selectedConversationIdRef/);
  assert.match(staffInbox, /회원명 또는 메시지 검색/);
  assert.match(staffInbox, /role === "admin"/);
  assert.match(staffInbox, /읽기 전용/);
  assert.match(staffInbox, /fetchSupportOperators/);
  assert.match(routing, /check \(conversation_type in \('general', 'product', 'internal'\)\)/);
  assert.match(routing, /create or replace function public\.get_or_create_product_inquiry_conversation/);
  assert.match(routing, /products\.inquiry_operator_id,[\s\S]*into v_operator_id, v_subject/);
  assert.match(routing, /create or replace function public\.get_or_create_employee_support_conversation/);
  assert.match(routing, /public\.support_employee_operator\(v_user_id\)/);
  assert.match(routing, /conversations\.assigned_staff_id = auth\.uid\(\)/);
  assert.match(routing, /public\.is_owner\(\)/);
  assert.match(routing, /public\.can_send_support_message\(conversation_id\)/);
  assert.match(auctionApp, /startProductInquiry\(postId, message\)/);
});

test("uses a row-locked server RPC as the only bid write path", async () => {
  const [migration, hardening, bidRepository, auctionApp, products] = await Promise.all([
    source("supabase/migrations/20260717210000_add_accounts_support_and_bids.sql"),
    source("supabase/migrations/20260717220000_harden_auth_chat_bids.sql"),
    source("src/lib/supabase/bids.ts"),
    source("src/components/AuctionApp.tsx"),
    source("src/lib/supabase/products.ts"),
  ]);

  assert.match(migration, /create table if not exists public\.auction_bids/);
  assert.match(migration, /create or replace function public\.place_bid/);
  assert.match(hardening, /for update;[\s\S]*v_now := clock_timestamp\(\)/);
  assert.match(hardening, /time '20:56:00'/);
  assert.match(hardening, /time '21:00:00'/);
  assert.match(hardening, /v_is_final := true/);
  assert.match(hardening, /bid_locked_at = case when v_is_final/);
  assert.match(hardening, /on delete restrict/);
  assert.match(hardening, /v_maximum_amount constant bigint := 1000000000/);
  assert.match(hardening, /not public\.is_member\(\)/);
  assert.match(hardening, /revoke all on function public\.place_bid/);
  assert.match(bidRepository, /\.rpc\("place_bid"/);
  assert.match(auctionApp, /await placeBid\(postId, amount\)/);
  const bidHandlerStart = auctionApp.indexOf("const handleBid = async");
  const bidHandlerEnd = auctionApp.indexOf("const handleProductInquiry", bidHandlerStart);
  const bidHandler = auctionApp.slice(bidHandlerStart, bidHandlerEnd);
  assert.doesNotMatch(bidHandler, /setPosts|bid-local-/);
  assert.match(products, /bidLockedAt: row\.bid_locked_at/);
});

test("handles all 20:56 and 21:00 client presentation boundaries", async () => {
  const policySource = await source("src/utils/auctionBidPolicy.ts");
  const compiled = ts.transpileModule(policySource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const policy = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );

  const emptyPost = { status: "active", bidHistory: [], bidLockedAt: undefined };
  const before = policy.getAuctionBidDecision({
    post: emptyPost,
    currentUserName: "민지",
    now: "2026-07-17T11:55:59.000Z",
  });
  assert.equal(before.allowed, true);
  assert.equal(before.finalOnAccept, false);

  for (const now of [
    "2026-07-17T11:56:00.000Z",
    "2026-07-17T11:59:59.000Z",
  ]) {
    const decision = policy.getAuctionBidDecision({
      post: emptyPost,
      currentUserName: "민지",
      now,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, "empty-item-first-bid");
    assert.equal(decision.finalOnAccept, true);
  }

  const bidHistory = [
    { id: "bid-1", bidAt: "2026-07-17T11:00:00.000Z", bidderName: "민지", amount: 10_000 },
  ];
  assert.equal(
    policy.getAuctionBidDecision({
      post: { ...emptyPost, bidHistory },
      currentUserName: "민지",
      now: "2026-07-17T11:56:00.000Z",
    }).reason,
    "existing-participant",
  );
  assert.equal(
    policy.getAuctionBidDecision({
      post: { ...emptyPost, bidHistory },
      currentUserName: "다른회원",
      now: "2026-07-17T11:56:00.000Z",
    }).reason,
    "new-bid-cutoff",
  );
  assert.equal(
    policy.getAuctionBidDecision({
      post: { ...emptyPost, bidLockedAt: "2026-07-17T11:56:00.000Z" },
      currentUserName: "민지",
      now: "2026-07-17T11:56:01.000Z",
    }).reason,
    "late-first-bid-finalized",
  );
  assert.equal(
    policy.getAuctionBidDecision({
      post: emptyPost,
      currentUserName: "민지",
      now: "2026-07-17T12:00:00.000Z",
    }).reason,
    "auction-closed",
  );
});

test("removes the old visible mock data and standalone demo", async () => {
  await assert.rejects(access(new URL("src/data/mockData.ts", rootUrl)));
  await assert.rejects(access(new URL("index.html", rootUrl)));
  await assert.rejects(access(new URL("demo.html", rootUrl)));
  await assert.rejects(access(new URL("src/components/common/RoleToggle.tsx", rootUrl)));
  await assert.rejects(access(new URL("src/hooks/useMockLiveBids.ts", rootUrl)));
});

test("uses real member delivery data with a default-closed address panel", async () => {
  const [accountPage, accountRepository, accountHook, migration] = await Promise.all([
    source("src/components/profile/AccountPage.tsx"),
    source("src/lib/supabase/memberAccount.ts"),
    source("src/hooks/useMemberAccount.ts"),
    source("supabase/migrations/20260718000000_add_member_operations_and_staff_products.sql"),
  ]);

  assert.match(accountPage, /\[isAddressOpen, setIsAddressOpen\] = useState\(false\)/);
  assert.match(accountPage, /aria-expanded=\{isAddressOpen\}/);
  assert.match(
    accountPage,
    /onClick=\{\(\) => setIsAddressOpen\(\(current\) => !current\)\}/,
  );
  assert.match(accountPage, /hidden=\{!isAddressOpen\}/);
  assert.match(accountPage, /선택 상품 택배 접수하기/);
  assert.match(accountPage, /우편번호 <span[^>]*>\(필수\)<\/span>/);
  assert.match(accountPage, /pattern="\[0-9\]\{5\}"/);
  assert.match(accountPage, /autoComplete="postal-code"/);
  assert.match(accountPage, /우편번호는 숫자 5자리로 입력해 주세요/);
  assert.match(accountPage, /postalCode: normalizedPostalCode/);
  assert.ok(
    accountPage.indexOf("택배 가능 횟수") <
      accountPage.indexOf("선택 상품 택배 접수하기"),
  );
  assert.doesNotMatch(accountPage, /localStorage|data:image\//);
  assert.match(accountRepository, /\.from\("member_accounts"\)/);
  assert.match(accountRepository, /\.from\("shipping_addresses"\)/);
  assert.match(accountRepository, /"get_my_won_products"/);
  assert.match(accountRepository, /"request_product_shipping"/);
  assert.match(accountRepository, /p_postal_code: postalCode/);
  assert.match(accountHook, /Promise\.all\(/);
  assert.match(migration, /create table if not exists public\.member_accounts/);
  assert.match(migration, /create table if not exists public\.shipping_addresses/);
  assert.match(migration, /create or replace function public\.request_product_shipping/);
  assert.match(migration, /shipping_credit_count = shipping_credit_count - 1/);
  assert.doesNotMatch(migration, /assign_product_winner_on_close/);
});

test("allows verified Kakao members to delete accounts without losing required shipping history", async () => {
  const [accountRoute, accountRepository, retentionMigration, policy] = await Promise.all([
    source("app/api/account/delete/route.ts"),
    source("src/lib/supabase/account.ts"),
    source("supabase/migrations/20260718022000_allow_account_deletion_with_shipping_history.sql"),
    source("app/privacy/page.tsx"),
  ]);
  assert.match(accountRoute, /verifier\.auth\.getUser\(accessToken\)/);
  assert.match(accountRoute, /identity\.provider === "kakao"/);
  assert.match(accountRoute, /account_access_roles/);
  assert.match(accountRoute, /accessRole\?\.role_code === "owner"/);
  assert.match(accountRoute, /protected_account/);
  assert.match(accountRoute, /admin\.auth\.admin\.deleteUser/);
  assert.match(accountRepository, /Authorization: `Bearer \$\{data\.session\.access_token\}`/);
  assert.match(retentionMigration, /alter column member_id drop not null/);
  assert.match(retentionMigration, /on delete set null/);
  assert.match(retentionMigration, /member_deleted_at/);
  assert.match(policy, /관계 법령/);
});

test("provides a collapsible Supabase operator center with constrained product management", async () => {
  const [auctionApp, navigation, siteHeader, adminPage, revenuePanel, shippingPanel, products, operations, migration, accessMigration] = await Promise.all([
    source("src/components/AuctionApp.tsx"),
    source("src/components/common/Navigation.tsx"),
    source("src/components/common/SiteHeader.tsx"),
    source("src/components/admin/AdminPage.tsx"),
    source("src/components/admin/RevenuePanel.tsx"),
    source("src/components/admin/ShippingWorkPanel.tsx"),
    source("src/lib/supabase/products.ts"),
    source("src/lib/supabase/operations.ts"),
    source("supabase/migrations/20260718000000_add_member_operations_and_staff_products.sql"),
    source("supabase/migrations/20260718030000_add_role_levels_revenue_enforcement.sql"),
  ]);

  assert.match(navigation, /label: "운영 센터"/);
  assert.match(navigation, /canAccessOperationsWorkspace\(role\)/);
  assert.match(navigation, /role === "employee"/);
  assert.match(auctionApp, /canAccessOperationsCenter\(auth\.role\)/);
  assert.match(auctionApp, /isOwnerRole\(auth\.role\) \? "admin" : "operator"/);
  assert.match(siteHeader, /isOwnerRole\(role\)[\s\S]*onOpenOwnerTools/);
  assert.match(siteHeader, /관리자 메뉴/);
  assert.doesNotMatch(siteHeader, /관리자 모드|운영자 모드|PIN/);
  assert.match(auctionApp, /onOpenBulkImport=\{\(\) => setBulkAuctionOpen\(true\)\}/);
  assert.doesNotMatch(auctionApp, /emptyAdminSales|shipments=\{\[\]\}/);
  assert.ok((adminPage.match(/<CollapsibleSection/g) ?? []).length >= 6);
  assert.match(adminPage, /getStaffMemberDirectory/);
  assert.match(adminPage, /setMemberAccessRole/);
  assert.match(adminPage, /addMemberWarning/);
  assert.match(adminPage, /deleteManagedMember/);
  assert.match(adminPage, /<RevenuePanel/);
  assert.match(adminPage, /<ShippingWorkPanel/);
  assert.match(revenuePanel, /getDailyRevenue/);
  assert.match(revenuePanel, /upsertDailyRevenue/);
  assert.match(shippingPanel, /getShippingWork/);
  assert.match(shippingPanel, /saveShippingTrackingBatch/);
  assert.match(shippingPanel, /downloadShippingRequestsWorkbook/);
  assert.match(shippingPanel, /parseTrackingWorkbook/);
  assert.match(adminPage, /updateManagedProduct/);
  assert.match(adminPage, /deleteManagedProduct/);
  assert.match(operations, /"get_staff_member_directory"/);
  assert.match(operations, /"set_member_access_role"/);
  assert.match(operations, /"upsert_daily_revenue"/);
  assert.match(products, /fetchManagedProducts/);
  assert.match(products, /\.rpc\("update_managed_product"/);
  assert.match(products, /\.rpc\("delete_managed_product"/);
  assert.match(migration, /create policy "Staff insert products"/);
  assert.match(migration, /revoke update, delete on public\.products from authenticated/);
  assert.match(migration, /create or replace function public\.update_managed_product/);
  assert.match(migration, /for update;/);
  assert.match(migration, /p_expected_updated_at/);
  assert.match(accessMigration, /create table if not exists public\.daily_revenue/);
  assert.match(accessMigration, /revenue_date date primary key/);
  assert.doesNotMatch(accessMigration, /auction_settlements/);
});

test("keeps the owner publicly operator-only while providing audited private test controls", async () => {
  const [
    auctionApp,
    siteHeader,
    ownerServer,
    ownerClient,
    delegationRoute,
    testMemberRoute,
    ownerPage,
    ownerMigration,
    delegationPanel,
    testPanel,
    auctionPanel,
  ] = await Promise.all([
    source("src/components/AuctionApp.tsx"),
    source("src/components/common/SiteHeader.tsx"),
    source("src/lib/ownerAccess/server.ts"),
    source("src/lib/ownerAccess/client.ts"),
    source("app/api/owner/delegation/route.ts"),
    source("app/api/owner/test-member/route.ts"),
    source("src/components/owner/OwnerPrivatePage.tsx"),
    source("supabase/migrations/20260718060000_hidden_owner_delegation_and_test_member.sql"),
    source("src/components/owner/OwnerDelegationPanel.tsx"),
    source("src/components/owner/OwnerHiddenTestPanel.tsx"),
    source("src/components/owner/OwnerAuctionControlPanel.tsx"),
  ]);

  assert.match(ownerServer, /Authorization/);
  assert.match(ownerServer, /auth\.getUser\(accessToken\)/);
  assert.match(ownerMigration, /drop table if exists public\.owner_mode_sessions/);
  assert.match(ownerMigration, /owner_operator_delegation_audit/);
  assert.match(ownerMigration, /owner_hidden_test_members/);
  assert.match(ownerMigration, /current_owner_delegated_operator/);
  assert.match(ownerMigration, /not public\.is_owner_hidden_test_member/);
  assert.match(delegationRoute, /begin_owner_operator_delegation/);
  assert.match(testMemberRoute, /get_owner_hidden_test_member/);
  assert.match(ownerClient, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(auctionApp, /if \(role === "admin"\) return "operator"/);
  assert.match(siteHeader, /관리자 메뉴/);
  assert.doesNotMatch(siteHeader, /관리자 모드|PIN/);
  assert.match(delegationPanel, /감사 기록 활성/);
  assert.match(testPanel, /ownerPlaceTestBid/);
  assert.match(testPanel, /requestProductPayment/);
  assert.match(testPanel, /requestOwnerHiddenTestShipping/);
  assert.match(auctionPanel, /ownerCloseAuctionNow/);
  assert.match(auctionPanel, /ownerOverrideAuctionPrice/);
  assert.match(ownerPage, /<StaffChatInbox staffId=\{ownerUserId\} role="admin"/);

  const response = await render("/owner");
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /404: NOT_FOUND|Code: NOT_FOUND/);
});

test("keeps the hidden Kakao owner private and enforces role, warning, and revenue rules", async () => {
  const [migration, routing, revenueFix, onlineDirectory, publicGuestDirectory, operatorPromotion, auth, presence, siteHeader, config] = await Promise.all([
    source("supabase/migrations/20260718030000_add_role_levels_revenue_enforcement.sql"),
    source("supabase/migrations/20260718031000_route_support_by_operator.sql"),
    source("supabase/migrations/20260718032000_fix_monthly_revenue_lint.sql"),
    source("supabase/migrations/20260718033000_secure_online_member_heartbeat.sql"),
    source("supabase/migrations/20260718101000_public_guest_online_directory.sql"),
    source("supabase/migrations/20260718034000_promote_initial_kakao_operator.sql"),
    source("src/lib/supabase/auth.ts"),
    source("src/hooks/useOnlineMembers.ts"),
    source("src/components/common/SiteHeader.tsx"),
    source("supabase/config.toml"),
  ]);

  assert.match(migration, /30be08c2-6259-42c6-af26-4ded6362de12/g);
  assert.match(migration, /identities\.provider = 'kakao'/);
  assert.match(migration, /users\.raw_app_meta_data ->> 'role' = 'admin'[\s\S]*delete from auth\.users/);
  assert.match(migration, /lower\(users\.email::text\) = 'cocoaline082@gmail\.com'/);
  assert.match(migration, /create trigger auth_users_protect_owner_delete/);
  assert.match(migration, /role_code in \('owner', 'operator', 'employee', 'band_member', 'member'\)/);
  assert.match(migration, /v_requested_role not in \('operator', 'employee', 'band_member', 'member'\)/);
  assert.match(migration, /mod\(v_warning_count, 3\) = 0/);
  assert.match(migration, /make_interval\(days => v_sanction_round\)/);
  assert.match(migration, /create table if not exists public\.cancelled_auction_bids/);
  assert.match(migration, /v_category = 'late_payment'[\s\S]*is_payment_deadline_exempt/);
  assert.match(migration, /delete from public\.auction_bids/);
  assert.doesNotMatch(migration, /create or replace function public\.place_bid/);
  assert.match(auth, /admin: \{ label: "운영자", grade: null \}/);
  assert.doesNotMatch(siteHeader, /0등급|최고 관리자/);
  assert.match(presence, /shouldTrackPresence\(role\)/);
  assert.match(presence, /"touch_my_last_seen"/);
  assert.match(presence, /"get_online_member_directory"/);
  assert.match(presence, /PUBLIC_GUEST_PRESENCE_CHANNEL/);
  assert.match(presence, /guestChannel\.track\(\{ guest_id: guestId \}\)/);
  assert.match(presence, /guestChannel\.presenceState\(\)/);
  assert.match(presence, /게스트\(\$\{guestId\}\)/);
  assert.match(routing, /roles\.role_code = 'operator'[\s\S]*has_kakao_identity/);
  assert.match(routing, /public\.is_owner\(\)/);
  assert.match(revenueFix, /with monthly as/);
  assert.match(revenueFix, /group by 1/);
  assert.match(revenueFix, /alter function public\.get_staff_member_directory\(integer, integer\) volatile/);
  assert.match(onlineDirectory, /auth_user_has_kakao_identity\(auth\.uid\(\)\)/);
  assert.match(onlineDirectory, /statement_timestamp\(\) - interval '75 seconds'/);
  assert.match(onlineDirectory, /roles\.role_code in \('operator', 'band_member', 'member'\)/);
  assert.match(onlineDirectory, /grant execute on function public\.get_online_member_directory\(integer\) to authenticated/);
  assert.doesNotMatch(publicGuestDirectory, /auth\.uid\(\) is null/);
  assert.match(publicGuestDirectory, /roles\.role_code in \('operator', 'band_member', 'member'\)/);
  assert.match(publicGuestDirectory, /not public\.is_owner_hidden_test_member/);
  assert.match(publicGuestDirectory, /to anon, authenticated/);
  assert.match(operatorPromotion, /4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee/);
  assert.match(operatorPromotion, /set_member_access_role\(v_operator_id, 'operator'\)/);
  assert.match(operatorPromotion, /products\.inquiry_operator_id is null/);
  assert.match(config, /\[auth\.email\][\s\S]*enable_signup = false/);
});

test("matches Excel image names in order and batches real Storage and database writes", async () => {
  const [parser, modal, products] = await Promise.all([
    source("src/lib/import/batchAuction.ts"),
    source("src/components/admin/BulkAuctionImportModal.tsx"),
    source("src/lib/supabase/products.ts"),
  ]);

  assert.match(parser, /await import\("exceljs"\)/);
  assert.match(parser, /strategy: "relative-path"/);
  assert.match(parser, /strategy: "basename"/);
  assert.match(parser, /strategy: "unique-stem"/);
  assert.match(parser, /code: "ambiguous_image"/);
  assert.match(parser, /code: "image_reused_across_products"/);
  assert.match(parser, /imageFiles: row\.imageMatches\.map\(\(match\) => match\.file\)/);
  assert.match(modal, /webkitdirectory/);
  assert.match(modal, /type="file"[\s\S]*multiple/);
  assert.doesNotMatch(modal, /download|양식 내려받기|템플릿 다운로드/);
  assert.match(products, /createProductsBatch/);
  assert.match(products, /await uploadProductImages/);
  assert.match(products, /client\.from\("products"\)\.insert\(rows\)/);
  assert.match(products, /await removeUploadedImages\(uploadedPaths\)/);
  assert.match(products, /hasSupportedProductImageSignature/);
});
