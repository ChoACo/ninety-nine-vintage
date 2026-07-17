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
    /<title>다미네 구제 \| 믿고 참여하는 구제 의류 경매<\/title>/i,
  );
  assert.match(html, /매일 만나는 믿을 수 있는 구제 옷, 다미네 구제/);
  assert.match(html, /무입찰 첫 건 즉시 확정/);
  assert.match(html, /Supabase에서 경매 상품을 불러오는 중이에요/);
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

test("uses Kakao membership and server-only operator provisioning", async () => {
  const [auth, authSession, modal, callback, provision, auctionApp] = await Promise.all([
    source("src/lib/supabase/auth.ts"),
    source("src/hooks/useAuthSession.ts"),
    source("src/components/auth/AuthModal.tsx"),
    source("app/auth/callback/page.tsx"),
    source("scripts/provision-operators.mjs"),
    source("src/components/AuctionApp.tsx"),
  ]);

  assert.match(auth, /provider:\s*"kakao"/);
  assert.match(auth, /\/auth\/callback/);
  assert.match(auth, /"unauthorized"/);
  assert.match(auth, /providers\.includes\("kakao"\)/);
  assert.match(auth, /hasKakaoProvider && hasMemberCompatibleRole/);
  assert.doesNotMatch(auth, /:\s*"member";\s*\n\}/);
  assert.match(auth, /client\.rpc\([\s\S]*"is_staff"/);
  assert.match(authSession, /getUserRole\(nextSession\.user\) === "unauthorized"/);
  assert.match(authSession, /hasAuthorizedSession/);
  assert.match(authSession, /isStaffRole\(role\) \? "is_staff" : "is_member"/);
  assert.match(authSession, /client\.rpc\(accessFunction\)/);
  assert.match(authSession, /client\.auth\.signOut\(\)/);
  assert.match(auth, /operator01/);
  assert.match(auth, /operator02/);
  assert.match(auth, /operator03/);
  assert.match(modal, /카카오로 로그인/);
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(provision, /email_confirm:\s*true/);
  assert.match(provision, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(provision, /sb_secret_|service_role\s*=\s*["'][A-Za-z0-9]/);
  assert.doesNotMatch(auctionApp, /RoleToggle|MOCK_BIDDER|chatThreadState/);
});

test("enforces private member-to-staff chat in SQL and UI", async () => {
  const [migration, hardening, kakaoOnly, repository, chatPage, floatingChat, staffInbox, hook] = await Promise.all([
    source("supabase/migrations/20260717210000_add_accounts_support_and_bids.sql"),
    source("supabase/migrations/20260717220000_harden_auth_chat_bids.sql"),
    source("supabase/migrations/20260717230000_require_kakao_for_members.sql"),
    source("src/lib/supabase/supportChat.ts"),
    source("src/components/chat/ChatPage.tsx"),
    source("src/components/chat/FloatingAdminChat.tsx"),
    source("src/components/chat/StaffChatInbox.tsx"),
    source("src/hooks/useSupportChat.ts"),
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
  assert.match(chatPage, /<MemberChat key=\{userId\} userId=\{userId\}/);
  assert.match(chatPage, /<StaffChatInbox key=\{userId\} staffId=\{userId\}/);
  assert.match(floatingChat, /isOpen \? \(/);
  assert.match(floatingChat, /<MemberFloatingChat\s+key=\{userId\}/);
  assert.match(floatingChat, /새 문의 시작/);
  assert.doesNotMatch(floatingChat, /disabled=\{!chat\.conversation/);
  assert.match(hook, /selectedConversationIdRef\.current === conversationId/);
  assert.match(hook, /conversation \?\? \(await getOrCreateMemberSupportConversation\(\)\)/);
  assert.match(hook, /messagesRequestIdRef\.current \+= 1;[\s\S]*selectedConversationIdRef\.current = conversationId/);
  assert.match(hook, /if \(!conversationId \|\| !selectedConversation\?\.isUnread\) return/);
  assert.match(staffInbox, /회원명 또는 메시지 검색/);
  assert.match(staffInbox, /내가 담당하기/);
});

test("keeps the administrator intact and reserves exactly three operator IDs", async () => {
  const [migration, hardening] = await Promise.all([
    source("supabase/migrations/20260717210000_add_accounts_support_and_bids.sql"),
    source("supabase/migrations/20260717220000_harden_auth_chat_bids.sql"),
  ]);

  assert.match(migration, /app_metadata\.role = 'admin' account remains an administrator/);
  assert.doesNotMatch(migration, /update\s+auth\.users/i);
  assert.match(migration, /\('operator01', '운영자 1'\)/);
  assert.match(migration, /\('operator02', '운영자 2'\)/);
  assert.match(migration, /\('operator03', '운영자 3'\)/);
  assert.match(migration, /in \('admin', 'operator'\)/);
  assert.match(hardening, /username in \('operator01', 'operator02', 'operator03'\)/);
  assert.match(hardening, /users\.raw_app_meta_data ->> 'operator_id' = new\.username/);
  assert.match(hardening, /operators\.auth_user_id = auth\.uid\(\)/);
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
  assert.doesNotMatch(auctionApp, /setPosts|bid-local-/);
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
  assert.ok(
    accountPage.indexOf("선택 상품 택배 접수하기") <
      accountPage.indexOf("택배 가능 횟수"),
  );
  assert.doesNotMatch(accountPage, /localStorage|data:image\//);
  assert.match(accountRepository, /\.from\("member_accounts"\)/);
  assert.match(accountRepository, /\.from\("shipping_addresses"\)/);
  assert.match(accountRepository, /"get_my_won_products"/);
  assert.match(accountRepository, /"request_product_shipping"/);
  assert.match(accountHook, /Promise\.all\(/);
  assert.match(migration, /create table if not exists public\.member_accounts/);
  assert.match(migration, /create table if not exists public\.shipping_addresses/);
  assert.match(migration, /create or replace function public\.request_product_shipping/);
  assert.match(migration, /shipping_credit_count = shipping_credit_count - 1/);
  assert.doesNotMatch(migration, /assign_product_winner_on_close/);
});

test("provides a collapsible Supabase operator center with constrained product management", async () => {
  const [auctionApp, navigation, adminPage, products, operations, migration] = await Promise.all([
    source("src/components/AuctionApp.tsx"),
    source("src/components/common/Navigation.tsx"),
    source("src/components/admin/AdminPage.tsx"),
    source("src/lib/supabase/products.ts"),
    source("src/lib/supabase/operations.ts"),
    source("supabase/migrations/20260718000000_add_member_operations_and_staff_products.sql"),
  ]);

  assert.match(navigation, /label: "운영 센터"/);
  assert.match(navigation, /role !== "admin" && role !== "operator"/);
  assert.match(auctionApp, /role === "admin" \|\| role === "operator"/);
  assert.match(auctionApp, /onOpenBulkImport=\{\(\) => setBulkAuctionOpen\(true\)\}/);
  assert.doesNotMatch(auctionApp, /emptyAdminSales|shipments=\{\[\]\}/);
  assert.ok((adminPage.match(/<CollapsibleSection/g) ?? []).length >= 4);
  assert.match(adminPage, /getStaffMemberDirectory/);
  assert.match(adminPage, /updateManagedProduct/);
  assert.match(adminPage, /deleteManagedProduct/);
  assert.match(operations, /"get_staff_member_directory"/);
  assert.match(products, /fetchManagedProducts/);
  assert.match(products, /\.rpc\("update_managed_product"/);
  assert.match(products, /\.rpc\("delete_managed_product"/);
  assert.match(migration, /create policy "Staff insert products"/);
  assert.match(migration, /revoke update, delete on public\.products from authenticated/);
  assert.match(migration, /create or replace function public\.update_managed_product/);
  assert.match(migration, /for update;/);
  assert.match(migration, /p_expected_updated_at/);
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
