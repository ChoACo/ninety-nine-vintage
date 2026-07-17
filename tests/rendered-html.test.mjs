import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

function getStandaloneJsx(html) {
  const marker = '<script type="text/babel">';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, "standalone Babel script must exist");
  const contentStart = start + marker.length;
  const end = html.indexOf("</script>", contentStart);
  assert.notEqual(end, -1, "standalone Babel script must close");
  return html.slice(contentStart, end);
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
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

test("server-renders the Dami vintage auction feed", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>다미네 구제 \| 믿고 참여하는 구제 의류 경매<\/title>/i,
  );
  assert.match(html, /매일 만나는 믿을 수 있는 구제 옷, 다미네 구제/);
  assert.match(html, /날짜별 구제 의류 경매/);
  assert.match(html, /전체보기/);
  assert.match(html, /Supabase에서 경매 상품을 불러오는 중이에요/);
  assert.doesNotMatch(html, /버버리 체크 안감 트렌치코트 여성 66~77/);
  assert.doesNotMatch(html, /울 100% 카멜 핸드메이드 코트/);
  assert.match(html, /내 실시간 경매 현황/);
  assert.match(html, /현재 접속 중인 사용자/);
  assert.match(html, /관리자 직통/);
  assert.doesNotMatch(html, /경매 진행 중|개별 남은 시간/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps Vercel routes on vinext SSR instead of the standalone HTML demo", async () => {
  const [viteConfig, vercelConfigSource] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  const vercelConfig = JSON.parse(vercelConfigSource);

  assert.match(viteConfig, /process\.env\.VERCEL === "1"/);
  assert.match(viteConfig, /nitro\(\{ renderer: false \}\)/);
  assert.equal(vercelConfig.framework, "nitro");
  assert.equal(vercelConfig.buildCommand, "pnpm exec vite build");
  assert.equal(vercelConfig.outputDirectory, null);
});

test("keeps the auction UI modular while Supabase owns the product source", async () => {
  const requiredFiles = [
    "src/data/mockData.ts",
    "src/hooks/useAuctionClock.ts",
    "src/hooks/useAuctionPolicyClock.ts",
    "src/hooks/useFulfillmentFlow.ts",
    "src/hooks/usePaymentDeadlineCountdown.ts",
    "src/hooks/useOnlineMembers.ts",
    "src/utils/bidding.ts",
    "src/utils/bidStatus.ts",
    "src/utils/auctionBidPolicy.ts",
    "src/utils/formatters.ts",
    "src/utils/shipping.ts",
    "src/lib/supabase/client.ts",
    "src/lib/supabase/database.types.ts",
    "src/lib/supabase/products.ts",
    "src/lib/supabase/adminAuth.ts",
    "src/hooks/useSupabaseProducts.ts",
    "src/components/common/Navigation.tsx",
    "src/components/feed/DateFilterChips.tsx",
    "src/components/feed/ProductInquiryModal.tsx",
    "src/components/feed/BidConfirmModal.tsx",
    "src/components/feed/BidHistoryModal.tsx",
    "src/components/feed/PostCard.tsx",
    "src/components/feed/PhotoGalleryModal.tsx",
    "src/components/live/OnlineMembersSidebar.tsx",
    "src/components/live/LiveBidSidebar.tsx",
    "src/components/chat/FloatingAdminChat.tsx",
    "src/hooks/useMockLiveBids.ts",
    "src/components/profile/ProfilePage.tsx",
    "src/components/profile/AddShippingAddressModal.tsx",
    "src/components/profile/KeepAllModal.tsx",
    "src/components/profile/KeepItemCard.tsx",
    "src/components/profile/PaymentModal.tsx",
    "src/components/profile/ShipmentStatusBoard.tsx",
    "src/components/profile/ShippingAddressSelectModal.tsx",
    "src/components/profile/ShippingCreditModal.tsx",
    "src/components/profile/ShippingWallet.tsx",
    "src/components/profile/KeepStorage.tsx",
    "src/components/profile/ShippingRequestList.tsx",
    "src/components/admin/AdminPage.tsx",
    "src/components/admin/adminTypes.ts",
    "src/components/admin/adminUtils.ts",
    "src/components/admin/AdminShipmentBoard.tsx",
    "src/components/admin/PickingPreviewModal.tsx",
    "src/components/admin/ShipmentRegistrationModal.tsx",
    "src/components/admin/RecentClosingList.tsx",
    "src/components/admin/RecentClosingDayAccordion.tsx",
    "src/components/admin/SettlementSummaryTable.tsx",
    "src/components/admin/AdminCsChatModal.tsx",
    "src/components/admin/AdminLoginModal.tsx",
    "supabase/migrations/20260717000000_create_products.sql",
    ".env.example",
  ];

  await Promise.all(
    requiredFiles.map((path) => access(new URL(`../${path}`, import.meta.url))),
  );

  const [page, auctionApp, mockData, feedFiles, liveFiles, profileFiles, adminFiles] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/AuctionApp.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/data/mockData.ts", import.meta.url), "utf8"),
      readdir(new URL("../src/components/feed/", import.meta.url)),
      readdir(new URL("../src/components/live/", import.meta.url)),
      readdir(new URL("../src/components/profile/", import.meta.url)),
      readdir(new URL("../src/components/admin/", import.meta.url)),
    ]);

  assert.match(page, /<AuctionApp \/>/);
  assert.doesNotMatch(page, /useState|mockData|auctionPosts/);
  assert.match(auctionApp, /useSupabaseProducts\(\)/);
  assert.doesNotMatch(auctionApp, /\bauctionPosts\b|useMockLiveBids/);
  assert.match(mockData, /TODO: DB 연동 필요/);
  assert.match(mockData, /다미네 구제 운영자/);
  assert.match(mockData, /images\.unsplash\.com/);
  assert.equal((mockData.match(/^\s+id: "auction-/gm) ?? []).length, 12);
  assert.equal((mockData.match(/^\s+status: "active"/gm) ?? []).length, 12);
  const auctionData = mockData.slice(
    mockData.indexOf("export const auctionPosts"),
    mockData.indexOf("export const currentUser"),
  );
  assert.doesNotMatch(auctionData, /description:\s*\n\s*"[^"]*\\n/);
  assert.doesNotMatch(auctionData, /클래식한 베이지 컬러|여름부터 초가을까지/);
  assert.ok(feedFiles.length >= 11);
  assert.ok(liveFiles.length >= 3);
  assert.ok(profileFiles.length >= 16);
  assert.ok(adminFiles.length >= 4);
});

test("keeps bidding transparent, cutoff-aware, and mistake-proof", async () => {
  const [
    postCard,
    bidConfirmModal,
    bidHistoryModal,
    feedList,
    dateFilterChips,
    inquiryModal,
    photoGalleryModal,
    commonModal,
    auctionApp,
    bidding,
    bidStatus,
    liveSidebar,
    onlineSidebar,
    onlineMembersHook,
    floatingChat,
    chatPage,
    auctionBidPolicy,
    auctionPolicyClock,
  ] = await Promise.all([
    readFile(new URL("../src/components/feed/PostCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/feed/BidConfirmModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/feed/BidHistoryModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/feed/FeedList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/feed/DateFilterChips.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/feed/ProductInquiryModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/feed/PhotoGalleryModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/Modal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AuctionApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/bidding.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/bidStatus.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/live/LiveBidSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/live/OnlineMembersSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useOnlineMembers.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/chat/FloatingAdminChat.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/chat/ChatPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/auctionBidPolicy.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useAuctionPolicyClock.ts", import.meta.url), "utf8"),
  ]);

  assert.match(postCard, /pendingBidAmount/);
  assert.match(postCard, /getAuctionBidDecision/);
  assert.match(postCard, /auctionNow/);
  assert.match(postCard, /⛔ 신규 입찰 마감 \(기존 참여자 전용\)/);
  assert.match(postCard, /requestManualBid/);
  assert.match(postCard, /requestQuickBid/);
  assert.match(postCard, /onConfirm=\{confirmBid\}/);
  assert.match(postCard, /상품 문의하기/);
  assert.match(postCard, /입찰 현황 보기/);
  assert.match(postCard, /\+1,000원 입찰하기/);
  assert.match(postCard, /line-clamp-5/);
  assert.match(postCard, /text-\[17px\].*font-extrabold/);
  assert.match(postCard, /getUserBidState\(post, currentUserName\)/);
  assert.match(postCard, /"no-bids"/);
  assert.match(postCard, /"other-leading"/);
  assert.match(postCard, /"user-leading"/);
  assert.match(postCard, /"user-outbid"/);
  assert.match(postCard, /내 입찰 최고가/);
  assert.match(postCard, /재입찰 필요!/);
  assert.match(postCard, /bg-\[#e6f3f7\]/);
  assert.match(postCard, /bg-\[#e3f6ed\]/);
  assert.match(postCard, /bg-\[#ffe5df\]/);
  assert.equal(
    (postCard.match(/onClick=\{\(\) => setHistoryModalOpen\(true\)\}/g) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(postCard, /post\.category|post\.condition|참여 인원|<dl\b/);
  assert.doesNotMatch(postCard, /AuctionRemainingTime|post\.closesAt|경매 진행 중/);
  assert.doesNotMatch(postCard, /<h2[^>]*>\s*\{post\.title\}/);

  assert.match(bidConfirmModal, /\{formatKRW\(amount\)\}/);
  assert.match(bidConfirmModal, /입찰을 진행하시겠습니까\?/);
  assert.match(bidConfirmModal, />\s*아니오\s*</);
  assert.match(bidConfirmModal, />\s*예\s*</);
  assert.ok((bidConfirmModal.match(/min-h-16/g) ?? []).length >= 2);
  assert.match(bidConfirmModal, /closeOnBackdrop=\{false\}/);
  assert.match(
    bidConfirmModal,
    /⚠️ 입찰 후 취소 불가 \(미입금 시 누적 경고 부여\)/,
  );

  assert.match(bidHistoryModal, /읽기 전용 입찰 기록/);
  assert.match(bidHistoryModal, /\[\.\.\.history\]\.sort/);
  assert.doesNotMatch(
    bidHistoryModal,
    /<form\b|<input\b|<textarea\b|contentEditable|onChange=/,
  );

  assert.match(feedList, /xl:grid-cols-3/);
  assert.match(feedList, /currentUserName=\{currentUserName\}/);
  assert.match(feedList, /getKoreanDateKey\(post\.publish_at \?\? post\.createdAt\)/);
  assert.match(feedList, /post\.status !== "active"/);
  assert.match(feedList, /publishTime <= auctionNow\.getTime\(\)/);
  assert.match(dateFilterChips, /전체보기/);
  assert.match(dateFilterChips, /오늘 \(\$\{dateLabel\}\)/);
  assert.match(dateFilterChips, /어제 \(\$\{dateLabel\}\)/);
  assert.match(dateFilterChips, /min-h-12/);
  assert.match(inquiryModal, /현재 상품 화면은 그대로 유지됩니다/);
  assert.match(inquiryModal, /await onSubmit\(trimmedMessage\)/);
  assert.match(photoGalleryModal, /size="gallery"/);
  assert.match(photoGalleryModal, /tone="dark"/);
  assert.match(photoGalleryModal, /sm:h-\[calc\(100dvh-2rem\)\]/);
  assert.match(photoGalleryModal, /ArrowLeft/);
  assert.match(photoGalleryModal, /onTouchStart/);
  assert.doesNotMatch(photoGalleryModal, /size="full"/);
  assert.match(commonModal, /gallery:\s*"max-w-6xl"/);
  assert.match(commonModal, /tone === "dark"/);
  assert.match(bidStatus, /"no-bids"[\s\S]*"other-leading"[\s\S]*"user-leading"[\s\S]*"user-outbid"/);
  assert.match(bidStatus, /bid\.amount > highest\.amount/);
  assert.match(liveSidebar, /재입찰 필요 상품/);
  assert.match(liveSidebar, /내가 입찰 중인 상품/);
  assert.match(liveSidebar, /<BidConfirmModal/);
  assert.match(liveSidebar, /getQuickBidAmount\(confirmPost\)/);
  assert.doesNotMatch(onlineSidebar, /김\*수|DEFAULT_ONLINE_MEMBERS|Mock 데이터/);
  assert.match(onlineSidebar, /현재 접속 중인 사용자/);
  assert.match(onlineSidebar, /Supabase 실시간 연결 기준/);
  assert.match(onlineSidebar, /sticky top-24/);
  assert.match(onlineMembersHook, /site-online-members-v1/);
  assert.match(onlineMembersHook, /createSupabasePresenceClient\(\)/);
  assert.match(onlineMembersHook, /presence:\s*\{[\s\S]*key:\s*visitorId/);
  assert.match(onlineMembersHook, /\.on\("presence", \{ event: "sync" \}/);
  assert.match(onlineMembersHook, /channel\.presenceState\(\)/);
  assert.match(onlineMembersHook, /\.track\(\{\}\)/);
  assert.match(onlineMembersHook, /VISITOR_ID_TTL_MS/);
  assert.match(onlineMembersHook, /MAX_VISIBLE_ONLINE_MEMBERS/);
  assert.match(onlineMembersHook, /channel\.untrack\(\)/);
  assert.match(onlineMembersHook, /client\.removeChannel\(channel\)/);
  assert.match(floatingChat, /fixed bottom-/);
  assert.match(floatingChat, /scale-95 opacity-0/);
  assert.doesNotMatch(floatingChat, /thread\?\.online|🟢 온라인|⚪ 오프라인/);
  assert.match(floatingChat, /thread\.messages/);
  assert.doesNotMatch(chatPage, /thread\.online|🟢 온라인|⚪ 오프라인/);
  assert.match(auctionBidPolicy, /NEW_BID_CUTOFF_SECONDS\s*=\s*20 \* 60 \* 60 \+ 56 \* 60/);
  assert.match(auctionBidPolicy, /AUCTION_CLOSE_SECONDS\s*=\s*21 \* 60 \* 60/);
  assert.match(auctionBidPolicy, /if \(userHasBidHistory\)/);
  assert.match(auctionBidPolicy, /if \(!hasAnyBidHistory\)/);
  assert.match(auctionBidPolicy, /"new-bid-cutoff"/);
  assert.match(auctionPolicyClock, /window\.setInterval/);
  assert.match(auctionApp, /관리자에게 문의가 전송되었습니다\./);
  assert.match(auctionApp, /assertAuctionBidAllowed/);
  assert.match(auctionApp, /useFulfillmentFlow/);
  assert.match(auctionApp, /max-w-\[1800px\]/);
  assert.match(auctionApp, /xl:grid-cols-\[170px_minmax\(0,1fr\)_235px\]/);
  assert.match(auctionApp, /<OnlineMembersSidebar/);
  assert.match(auctionApp, /useOnlineMembers\(\)/);
  assert.match(auctionApp, /<LiveBidSidebar/);
  assert.match(auctionApp, /<FloatingAdminChat/);
  assert.match(auctionApp, /useSupabaseProducts\(\)/);
  assert.doesNotMatch(auctionApp, /useMockLiveBids|\bauctionPosts\b/);
  assert.doesNotMatch(auctionApp, /setActivePage\("chat"\)/);
  assert.doesNotMatch(auctionApp, /new Date\(target\.closesAt\)|target\.closesAt.*Date\.now/);

  assert.match(bidding, /QUICK_BID_INCREMENT\s*=\s*1_000/);
  assert.match(bidding, /participantCount\s*===\s*0/);
  assert.match(bidding, /post\.startingPrice/);
  assert.match(bidding, /post\.currentPrice\s*\+\s*QUICK_BID_INCREMENT/);
});

test("batches secure payment and manages addresses, Keep, and shipment status", async () => {
  const [
    profilePage,
    userInfoForm,
    addShippingAddressModal,
    paymentSummary,
    paymentModal,
    paymentDeadlineCountdown,
    shippingCreditModal,
    shippingWallet,
    wonAuctionList,
    keepStorage,
    keepAllModal,
    keepItemCard,
    shippingAddressSelectModal,
    shipmentStatusBoard,
    shippingRequestList,
    fulfillmentFlow,
    shipping,
    mockData,
    auctionApp,
  ] = await Promise.all([
    readFile(new URL("../src/components/profile/ProfilePage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/UserInfoForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/AddShippingAddressModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/PaymentSummary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/PaymentModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/usePaymentDeadlineCountdown.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/ShippingCreditModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/ShippingWallet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/WonAuctionList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/KeepStorage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/KeepAllModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/KeepItemCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/ShippingAddressSelectModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/ShipmentStatusBoard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/ShippingRequestList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useFulfillmentFlow.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/shipping.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/data/mockData.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AuctionApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(paymentSummary, /accountNumber|account\.accountNumber/);
  assert.match(paymentSummary, /계좌번호는 기본 화면에서 보호됩니다/);
  assert.match(paymentSummary, /전체 상품 일괄 결제 진행하기/);
  assert.match(paymentModal, /if \(!open \|\| payableAuctions\.length === 0\) return null/);
  assert.match(paymentModal, /summarizeAuctionNames/);
  assert.match(paymentModal, /payableAuctions\.length/);
  assert.match(paymentModal, /상품 낙찰 총액/);
  assert.match(paymentModal, /입금할 총 금액/);
  assert.match(paymentModal, /checked=\{includeShippingFee\}/);
  assert.match(paymentModal, /택배비.*formatKRW\(SHIPPING_FEE\).*함께 결제/s);
  assert.match(paymentModal, /account\.accountNumber/);
  assert.match(paymentModal, /auctionIds: payableAuctions\.map/);
  assert.match(paymentModal, /(?:모든|전체) 상품의 입금 확인을 서버 트랜잭션/);
  assert.match(shippingCreditModal, /if \(!open\) return null/);
  assert.match(shippingCreditModal, /택배 가능 횟수 충전/);
  assert.match(shippingWallet, /📦 택배 가능 횟수/);
  assert.match(shippingWallet, /sm:flex-row sm:items-center sm:justify-between/);
  assert.match(shippingWallet, /➕ 택배비만 입금하기/);

  assert.match(wonAuctionList, /onStartBatchPayment/);
  assert.match(wonAuctionList, /usePaymentDeadlineCountdown\(pendingAuctions\)/);
  assert.match(wonAuctionList, /입금 마감까지 남은 시간/);
  assert.match(
    wonAuctionList,
    /⚠️ 마감 내 미입금 시 자동 취소 및 누적 경고가 부여됩니다/,
  );
  assert.match(wonAuctionList, /☑️ 전체 상품 일괄 결제 진행하기/);
  assert.match(wonAuctionList, /🔎 계좌번호 보기/);
  assert.doesNotMatch(wonAuctionList, /onStartPayment|onClick=\{\(\) => onPay\(auction\)\}/);
  assert.equal((wonAuctionList.match(/<button\b/g) ?? []).length, 1);
  assert.match(paymentDeadlineCountdown, /deadline\.setHours\(11, 59, 59, 999\)/);
  assert.match(paymentDeadlineCountdown, /new Date\(Math\.min\(\.\.\.timestamps\)\)/);
  assert.match(paymentDeadlineCountdown, /getCountdown\(deadline \?\? currentTime, currentTime\)/);

  assert.match(userInfoForm, /const \[isOpen, setIsOpen\] = useState\(true\)/);
  assert.match(userInfoForm, /aria-expanded=\{isOpen\}/);
  assert.match(userInfoForm, /onClick=\{\(\) => setIsOpen\(\(current\) => !current\)\}/);
  assert.match(userInfoForm, /grid-rows-\[1fr\].*grid-rows-\[0fr\]/s);
  assert.match(userInfoForm, /shippingAddresses: updatedAddresses/);
  assert.match(userInfoForm, /➕ 새 배송지 추가/);
  assert.match(userInfoForm, /sortedAddresses\.map/);
  assert.match(userInfoForm, /<AddShippingAddressModal/);
  assert.match(addShippingAddressModal, /title="➕ 새 배송지 추가"/);
  assert.match(addShippingAddressModal, /recipientName/);
  assert.match(addShippingAddressModal, /phone/);
  assert.match(addShippingAddressModal, /address/);
  assert.match(addShippingAddressModal, /await onAdd/);

  assert.match(keepStorage, /나의 보관함 \(Keep\)/);
  assert.match(keepStorage, /sortKeepItemsByExpiration\(items\)/);
  assert.match(keepStorage, /KEEP_PREVIEW_LIMIT = 6/);
  assert.match(keepStorage, /sortedItems\.slice\(0, KEEP_PREVIEW_LIMIT\)/);
  assert.match(keepStorage, /grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3/);
  assert.match(keepStorage, /전체 보관함 보기/);
  assert.match(keepStorage, /<KeepAllModal/);
  assert.match(keepStorage, /<ShippingAddressSelectModal/);
  assert.match(keepStorage, /선택 상품 택배 접수하기 \(전체 선택 가능\)/);
  assert.match(keepStorage, /택배 가능 횟수가 부족합니다\. 택배비 선결제를 진행해 주세요\./);
  assert.match(keepStorage, /shippingAddress: immutableAddress/);
  assert.ok(
    keepStorage.indexOf("if (!selectedAddress") <
      keepStorage.indexOf("if (shippingCount <= 0)"),
  );
  assert.match(keepAllModal, /title="📦 전체 보관함 보기"/);
  assert.match(keepAllModal, /items\.map/);
  assert.match(keepAllModal, /selectedIds\.has/);
  assert.match(keepAllModal, /선택 상품 택배 접수하기/);
  assert.match(keepItemCard, /formatKeepDday/);
  assert.match(keepItemCard, /getKeepItemExpiration/);
  assert.match(shippingAddressSelectModal, /📦 발송 받으실 배송지 선택/);
  assert.match(shippingAddressSelectModal, /addresses\.map/);
  assert.match(shippingAddressSelectModal, /기본 배송지/);
  assert.match(shippingAddressSelectModal, /이 주소로 발송 신청/);

  assert.match(shipmentStatusBoard, /grid grid-cols-1 gap-6 lg:grid-cols-2/);
  assert.match(shipmentStatusBoard, /관리자 발송 대기열/);
  assert.match(shipmentStatusBoard, /택배 발송 처리된 정보/);
  assert.match(shipmentStatusBoard, /item\.courier \?\? "한진택배"/);
  assert.match(shipmentStatusBoard, /item\.trackingNumber/);
  assert.match(shipmentStatusBoard, /📋 복사하기/);
  assert.match(shipmentStatusBoard, /🚚 택배 조회하기/);
  assert.match(shipmentStatusBoard, /navigator\.clipboard\?\.writeText/);
  assert.match(shipmentStatusBoard, /WaybillResult\.do/);
  assert.match(shipmentStatusBoard, /wblnumText/);
  assert.match(shippingRequestList, /requestedItems=\{requestedItems \?\? items\}/);
  assert.match(shippingRequestList, /shippedItems=\{shippedItems\}/);

  assert.match(profilePage, /controlledFlow/);
  assert.match(profilePage, /onBatchPaymentStart/);
  assert.match(profilePage, /onBatchPaymentComplete/);
  assert.match(profilePage, /onShippingCreditComplete/);
  assert.match(profilePage, /onShippingRequest/);
  assert.match(profilePage, /addresses=\{profile\.shippingAddresses\}/);
  assert.match(profilePage, /stage === "shipped"/);
  assert.match(profilePage, /requestedItems=\{shippingRequestedItems\}/);
  assert.match(profilePage, /shippedItems=\{shippedItems\}/);
  assert.match(fulfillmentFlow, /startBatchPayment/);
  assert.match(fulfillmentFlow, /completeBatchPayment/);
  assert.match(fulfillmentFlow, /stage: "keep"/);
  assert.match(fulfillmentFlow, /shippingCount: current\.shippingCount \+ 1/);
  assert.match(fulfillmentFlow, /shippingCount: Math\.max\(0, current\.shippingCount - 1\)/);
  assert.match(fulfillmentFlow, /profile\.shippingAddresses\.find/);
  assert.match(fulfillmentFlow, /address\.id === payload\.shippingAddress\.id/);
  assert.match(fulfillmentFlow, /shippingAddress: \{ \.\.\.savedAddress \}/);
  assert.match(fulfillmentFlow, /stage: "shipping-requested"/);
  assert.match(shipping, /SHIPPING_FEE = 4_000/);
  assert.match(shipping, /REGULAR_KEEP_DAYS = 14/);
  assert.match(shipping, /BULKY_KEEP_DAYS = 7/);
  assert.match(shipping, /weekday === 2 \|\| weekday === 3 \|\| weekday === 4/);
  assert.match(shipping, /오후 5시 한진택배 발송 예정/);
  assert.match(mockData, /shippingCount: 2/);
  assert.match(mockData, /shippingAddresses: \[/);
  assert.match(mockData, /label: "딸네 집"/);
  assert.match(mockData, /label: "가게"/);
  assert.match(mockData, /isBulky: true/);
  assert.match(mockData, /stage: "keep"/);
  assert.ok((mockData.match(/stage: "shipped"/g) ?? []).length >= 2);
  assert.ok((mockData.match(/trackingNumber: "5400/g) ?? []).length >= 2);
  assert.match(auctionApp, /wonAuctions=\{wonAuctionState\}/);
  assert.match(auctionApp, /onBatchPaymentStart=\{startBatchPayment\}/);
  assert.match(auctionApp, /onBatchPaymentComplete=\{completeBatchPayment\}/);
  assert.match(auctionApp, /onShippingRequest=\{requestShipping\}/);
});

test("runs the admin warehouse, tracking sync, recent settlements, and direct CS flow", async () => {
  const [
    adminPage,
    adminShipmentBoard,
    pickingPreviewModal,
    shipmentRegistrationModal,
    adminUtils,
    recentClosingList,
    settlementSummaryTable,
    adminCsChatModal,
    fulfillmentFlow,
    auctionApp,
    auctionTypes,
    mockData,
  ] = await Promise.all([
    readFile(new URL("../src/components/admin/AdminPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin/AdminShipmentBoard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin/PickingPreviewModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin/ShipmentRegistrationModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin/adminUtils.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin/RecentClosingList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin/SettlementSummaryTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin/AdminCsChatModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useFulfillmentFlow.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AuctionApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/types/auction.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/data/mockData.ts", import.meta.url), "utf8"),
  ]);

  assert.match(adminShipmentBoard, /batch\.status === "packing"/);
  assert.match(adminShipmentBoard, /batch\.status === "shipped"/);
  assert.match(adminShipmentBoard, /grid grid-cols-1 gap-6 lg:grid-cols-2/);
  assert.match(adminShipmentBoard, /관리자 발송 대기열/);
  assert.match(adminShipmentBoard, /배송 중 \/ 발송 완료/);
  assert.match(adminShipmentBoard, /고객명: \{batch\.buyer\.name\}/);
  assert.match(adminShipmentBoard, /총 상품 수량: 총 \{batch\.items\.length\}벌/);
  assert.match(adminShipmentBoard, /getItemSummary\(batch\)/);
  assert.match(adminShipmentBoard, /👕 상품 상세 미리보기/);
  assert.match(adminShipmentBoard, /🚚 배송하기/);

  assert.match(pickingPreviewModal, /상품 상세 미리보기/);
  assert.match(pickingPreviewModal, /activeItem\.imageUrls/);
  assert.match(pickingPreviewModal, /원본 사진/);
  assert.match(pickingPreviewModal, /activeItem\.description/);
  assert.match(shipmentRegistrationModal, /택배 발송 처리 및 송장 등록/);
  assert.match(shipmentRegistrationModal, /최종 배송지 정보/);
  assert.match(shipmentRegistrationModal, /batch\.shippingAddress\.recipientName/);
  assert.match(shipmentRegistrationModal, /batch\.shippingAddress\.phone/);
  assert.match(shipmentRegistrationModal, /batch\.shippingAddress\.address/);
  assert.match(shipmentRegistrationModal, /normalized\.length < 10 \|\| normalized\.length > 14/);
  assert.match(shipmentRegistrationModal, /courier: "한진택배"/);
  assert.match(shipmentRegistrationModal, /송장 등록하기/);

  assert.match(auctionTypes, /interface AdminShipmentBatch/);
  assert.match(auctionTypes, /interface ShipmentRegistrationPayload/);
  assert.match(auctionTypes, /shipmentBatchId\?: string/);
  assert.match(fulfillmentFlow, /const registerShipment = useCallback/);
  assert.match(fulfillmentFlow, /auction\.shipmentBatchId === payload\.batchId/);
  assert.match(fulfillmentFlow, /auction\.stage === "shipping-requested"/);
  assert.match(fulfillmentFlow, /stage: "shipped"/);
  assert.match(fulfillmentFlow, /trackingNumber/);
  assert.match(fulfillmentFlow, /commitAuctions/);
  assert.match(auctionApp, /await registerShipment\(payload\)/);
  assert.match(auctionApp, /shipments=\{shipmentBatches\}/);
  assert.match(auctionApp, /onRegisterShipment=\{handleRegisterShipment\}/);
  assert.match(auctionApp, /customerChats=\{adminCustomerChatState\}/);
  assert.match(mockData, /export const adminShipmentBatches/);
  assert.match(mockData, /status: "packing"/);
  assert.match(mockData, /status: "shipped"/);

  assert.match(adminUtils, /KST_TIME_ZONE = "Asia\/Seoul"/);
  assert.match(adminUtils, /Array\.from\(\{ length: 7 \}/);
  assert.match(adminUtils, /buildRecentSevenClosingDays/);
  assert.match(recentClosingList, /최근 7일 날짜별 마감 관리/);
  assert.match(recentClosingList, /days\.map/);
  assert.match(settlementSummaryTable, /낙찰자 성명/);
  assert.match(settlementSummaryTable, /낙찰 상품 사진/);
  assert.match(settlementSummaryTable, /낙찰 금액/);
  assert.match(settlementSummaryTable, /진행 상태/);
  assert.doesNotMatch(settlementSummaryTable, /buyer\.phone|buyer\.address|배송 주소|연락처/);
  assert.match(settlementSummaryTable, /💬 1:1 톡/);

  assert.match(adminCsChatModal, /1:1 직통 톡/);
  assert.match(adminCsChatModal, /입금이 지연되고 있습니다/);
  assert.match(adminCsChatModal, /상품 사이즈와 상태/);
  assert.match(adminCsChatModal, /await onSendMessage/);
  assert.match(adminPage, /onSendCustomerMessage/);
  assert.match(adminPage, /setFallbackChats/);
  assert.match(adminPage, /messages: \[\.\.\.thread\.messages, message\]/);
  assert.match(auctionApp, /onSendCustomerMessage=\{handleSendCustomerMessage\}/);
});

test("persists auction products and images through Supabase", async () => {
  const [
    modal,
    auctionApp,
    feedList,
    postCard,
    auctionTypes,
    auctionBidPolicy,
    supabaseClient,
    productRepository,
    productsHook,
    adminAuth,
    adminLoginModal,
    migration,
    envExample,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../src/components/feed/NewAuctionModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AuctionApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/feed/FeedList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/feed/PostCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/types/auction.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/auctionBidPolicy.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/products.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useSupabaseProducts.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/adminAuth.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin/AdminLoginModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260717000000_create_products.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(modal, /카테고리|상품 상태|사진 URL/);
  assert.match(modal, /type="file"/);
  assert.match(modal, /\bmultiple\b/);
  assert.match(modal, /accept="image\/\*"/);
  assert.match(modal, /URL\.createObjectURL\(file\)/);
  assert.match(modal, /URL\.revokeObjectURL/);
  assert.match(modal, /사진 삭제/);
  assert.match(modal, /useState<PublishMode>\("scheduled"\)/);
  assert.match(modal, /다음날 오전 10시 예약 등록/);
  assert.match(modal, /즉시 올리기/);
  assert.match(modal, /status: isScheduled \? "pending" : "active"/);
  assert.match(modal, /publish_at: isScheduled/);
  assert.match(modal, /사진 업로드 중\.\.\./);

  assert.match(supabaseClient, /createClient<Database>/);
  assert.match(supabaseClient, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(supabaseClient, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(supabaseClient, /export function createSupabasePresenceClient/);
  assert.match(supabaseClient, /persistSession: false/);
  assert.doesNotMatch(supabaseClient, /SERVICE_ROLE|service_role/);
  assert.match(productRepository, /product-images/);
  assert.match(productRepository, /Date\.now\(\).*crypto\.randomUUID\(\)/);
  assert.match(productRepository, /\.upload\(path, file/);
  assert.match(productRepository, /\.getPublicUrl\(data\.path\)/);
  assert.match(productRepository, /image_urls: uploaded\.imageUrls/);
  assert.match(productRepository, /\.from\("products"\)\.insert\(row\)/);
  assert.match(productRepository, /\.eq\("status", "active"\)/);
  assert.match(productRepository, /\.lte\("publish_at", nowIso\)/);
  assert.match(productRepository, /\.order\("publish_at", \{ ascending: false \}\)/);
  assert.match(productRepository, /isSupabaseAdmin\(user\)/);
  assert.doesNotMatch(productRepository, /FileReader|readAsDataURL/);

  assert.match(productsHook, /channel\("products-feed"\)/);
  assert.match(productsHook, /"postgres_changes"/);
  assert.match(productsHook, /table: "products"/);
  assert.match(productsHook, /removeChannel\(channel\)/);
  assert.match(auctionApp, /useSupabaseProducts\(\)/);
  assert.match(auctionApp, /await createProduct\(draft\)/);
  assert.doesNotMatch(auctionApp, /\bauctionPosts\b|readImageFilesAsDataUrls|useMockLiveBids/);
  assert.match(feedList, /post\.status !== "active"/);
  assert.match(feedList, /publishTime <= auctionNow\.getTime\(\)/);
  assert.match(postCard, /post\.publish_at \?\? post\.createdAt/);

  assert.match(adminAuth, /signInWithPassword/);
  assert.match(adminAuth, /app_metadata\?\.role === "admin"/);
  assert.match(adminLoginModal, /Supabase 관리자 로그인/);
  assert.match(auctionTypes, /"pending" \| "active" \| "closed"/);
  assert.match(auctionBidPolicy, /reason: "item-pending"/);

  assert.match(migration, /create table if not exists public\.products/);
  assert.match(migration, /'product-images'/);
  assert.match(migration, /status = 'active' and publish_at <= now\(\)/);
  assert.match(migration, /app_metadata/);
  assert.match(migration, /supabase_realtime add table public\.products/);
  assert.match(migration, /cron\.schedule/);
  assert.match(migration, /status = 'pending'[\s\S]*publish_at <= now\(\)/);
  assert.match(envExample, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(envExample, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(packageJson, /@supabase\/supabase-js/);
  await assert.rejects(access(new URL("../src/utils/imageFiles.ts", import.meta.url)));
});

test("aligns the admin session lifecycle and Storage image policy", async () => {
  const [
    modal,
    productRepository,
    imagePolicy,
    adminAuth,
    auctionApp,
    siteHeader,
    databaseTypes,
    migration,
  ] = await Promise.all([
    readFile(new URL("../src/components/feed/NewAuctionModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/products.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/productImagePolicy.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/adminAuth.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AuctionApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/SiteHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260717000000_create_products.sql", import.meta.url), "utf8"),
  ]);

  assert.match(modal, /isSupportedProductImageMimeType\(file\.type\)/);
  assert.match(modal, /PRODUCT_IMAGE_FORMAT_LABEL/);
  assert.match(productRepository, /isSupportedProductImageMimeType\(file\.type\)/);

  for (const mimeType of [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/heic",
    "image/heif",
  ]) {
    assert.match(imagePolicy, new RegExp(`"${mimeType}"`));
    assert.match(migration, new RegExp(`'${mimeType}'`));
  }

  assert.match(adminAuth, /export async function signOutSupabaseAdmin/);
  assert.match(adminAuth, /\.auth\.signOut\(\)/);
  assert.match(auctionApp, /handleAdminSignOut/);
  assert.match(auctionApp, /await signOutSupabaseAdmin\(\)/);
  assert.match(siteHeader, /관리자 로그아웃/);
  assert.match(siteHeader, /관리자 인증됨/);
  assert.match(databaseTypes, /is_admin:[\s\S]*Returns: boolean/);
});

test("keeps the double-click index.html synchronized with the updated business rules", async () => {
  const standalone = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const postCardSource = standalone.slice(
    standalone.indexOf("function PostCard"),
    standalone.indexOf("function FeedPage"),
  );
  const inquiryHandlerSource = standalone.slice(
    standalone.indexOf("const sendProductInquiry"),
    standalone.indexOf("const saveProfile"),
  );
  const gallerySource = standalone.slice(
    standalone.indexOf("function PhotoGalleryModal"),
    standalone.indexOf("function PhotoGallery({"),
  );
  const profileFormSource = standalone.slice(
    standalone.indexOf("function ProfileForm"),
    standalone.indexOf("function ShippingPassCard"),
  );
  const paymentWaitingSource = standalone.slice(
    standalone.indexOf("function PaymentWaitingList"),
    standalone.indexOf("function KeepList"),
  );
  const adminSettlementTableSource = standalone.slice(
    standalone.indexOf("function RecentSalesTable"),
    standalone.indexOf("function RecentDateSalesGroup"),
  );
  const standaloneAppStateSource = standalone.slice(
    standalone.indexOf("function App()"),
    standalone.indexOf("ReactDOM.createRoot"),
  );
  const newAuctionModalSource = standalone.slice(
    standalone.indexOf("function NewAuctionModal"),
    standalone.indexOf("function Toast"),
  );
  const createAuctionSource = standalone.slice(
    standalone.indexOf("const createAuction"),
    standalone.indexOf("const salesWithCurrentProfile"),
  );

  assert.match(standalone, /다미네 구제 \| 믿고 참여하는 구제 의류 경매/);
  assert.match(standalone, /function ProductInquiryModal/);
  assert.match(standalone, /function DateFilterChips/);
  assert.match(standalone, /전체보기/);
  assert.match(standalone, /상품 문의하기/);
  assert.match(standalone, /관리자에게 문의가 전송되었습니다\./);
  assert.match(standalone, /function BidInputModal/);
  assert.match(standalone, /function BidConfirmModal/);
  assert.match(standalone, /function BidHistoryModal/);
  assert.match(standalone, /입찰 현황 보기/);
  assert.match(standalone, /\+1,000원 입찰하기/);
  assert.match(standalone, /입찰을 진행하시겠습니까\?/);
  assert.match(standalone, /⚠️ 입찰 후 취소 불가 \(미입금 시 누적 경고 부여\)/);
  assert.match(standalone, /function getBidAccess/);
  assert.match(standalone, /getTodayKstTime\(now, 20, 56\)/);
  assert.match(standalone, /getTodayKstTime\(now, 21, 0\)/);
  assert.match(standalone, /⛔ 신규 입찰 마감 \(기존 참여자 전용\)/);
  assert.match(standalone, /grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(standalone, /bidHistory: Object\.freeze\(\[bidRecord/);
  assert.match(postCardSource, /line-clamp-5/);
  assert.match(postCardSource, /getUserBidState\(post, currentUserName\)/);
  assert.match(standalone, /"no-bids"[\s\S]*"other-leading"[\s\S]*"user-leading"[\s\S]*"user-outbid"/);
  assert.match(standalone, /내 입찰 최고가/);
  assert.match(standalone, /재입찰 필요!/);
  assert.equal((postCardSource.match(/입찰 현황 보기/g) ?? []).length, 1);
  assert.doesNotMatch(postCardSource, /post\.category|post\.condition|참여 인원|<dl\b/);
  assert.doesNotMatch(postCardSource, /post\.title|post\.closesAt|남은 시간|경매 진행 중/);
  assert.match(gallerySource, /max-w-6xl/);
  assert.match(gallerySource, /h-\[90dvh\]/);
  assert.match(gallerySource, /max-h-\[64rem\]/);
  assert.match(gallerySource, /bg-\[#28333b\]/);
  assert.doesNotMatch(gallerySource, /fullScreen/);
  assert.doesNotMatch(inquiryHandlerSource, /setPage\("chat"\)/);
  assert.doesNotMatch(standalone, /new Date\(target\.closesAt\)/);
  assert.doesNotMatch(standalone, /하루옥션/);
  assert.match(standalone, /function OnlineMembersSidebar/);
  assert.match(standalone, /function LiveBidSidebar/);
  assert.match(standalone, /function FloatingAdminChat/);
  assert.match(standalone, /현재 접속 중인 사용자/);
  assert.match(standalone, /site-online-members-v1/);
  assert.match(standalone, /\.on\("presence", \{ event: "sync" \}/);
  assert.match(standalone, /channel\.presenceState\(\)/);
  assert.match(standalone, /channel\.track\(\{\}\)/);
  assert.doesNotMatch(standalone, /김\*수|const ONLINE_MEMBERS\s*=|Mock 접속 상태/);
  assert.match(standalone, /🔥 재입찰 필요 상품/);
  assert.match(standalone, /🟢 내가 입찰 중인 상품/);
  assert.doesNotMatch(standalone, /thread\?*\.online|🟢 온라인|⚪ 오프라인/);
  assert.match(standalone, /max-w-\[1800px\]/);
  assert.match(standalone, /xl:grid-cols-\[170px_minmax\(0,1fr\)_235px\]/);

  assert.doesNotMatch(newAuctionModalSource, /카테고리|상품 상태|사진 URL/);
  assert.match(newAuctionModalSource, /type="file"/);
  assert.match(newAuctionModalSource, /\bmultiple\b/);
  assert.match(newAuctionModalSource, /accept="image\/\*"/);
  assert.match(newAuctionModalSource, /URL\.createObjectURL\(file\)/);
  assert.match(newAuctionModalSource, /URL\.revokeObjectURL/);
  assert.match(newAuctionModalSource, /사진 삭제/);
  assert.match(newAuctionModalSource, /useState\("scheduled"\)/);
  assert.match(newAuctionModalSource, /다음날 오전 10시 예약 등록/);
  assert.match(newAuctionModalSource, /즉시 올리기/);
  assert.match(newAuctionModalSource, /status: scheduled \? "pending" : "active"/);
  assert.match(newAuctionModalSource, /publish_at: scheduled/);
  assert.match(standalone, /function nextScheduledPublishAt/);
  assert.match(standalone, /post\.status === "pending"/);
  assert.match(standaloneAppStateSource, /const \[posts, setPosts\] = useState\(\[\]\)/);
  assert.match(standaloneAppStateSource, /fetchPublishedProducts\(\)/);
  assert.match(standaloneAppStateSource, /"postgres_changes"/);
  assert.match(standaloneAppStateSource, /table: "products"/);
  assert.match(createAuctionSource, /await createSupabaseProduct\(values\)/);
  assert.match(createAuctionSource, /await loadPublishedProducts/);
  assert.match(standalone, /window\.__SUPABASE_CONFIG__/);
  assert.match(standalone, /@supabase\/supabase-js@2/);
  assert.match(standalone, /signInWithPassword/);
  assert.match(standalone, /app_metadata\?\.role === "admin"/);
  assert.match(standalone, /storage\.from\(PRODUCT_IMAGES_BUCKET\)/);
  assert.match(standalone, /\.upload\(path, file/);
  assert.match(standalone, /getPublicUrl\(path\)/);
  assert.match(standalone, /client\.from\("products"\)\.insert\(productRow\)/);
  assert.match(standalone, /\.eq\("status", "active"\)/);
  assert.match(standalone, /\.lte\("publish_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(standalone, /publish_at: values\.publish_at/);
  assert.match(standalone, /closes_at: nextActiveDeadline\(values\.publish_at\)/);
  assert.match(standalone, /status: values\.status/);
  assert.match(newAuctionModalSource, /사진 업로드 중\.\.\./);
  assert.doesNotMatch(standalone, /MOCK_POSTS|FileReader|readAsDataURL|readImageFileAsDataUrl/);

  assert.match(standalone, /shippingCount: 2/);
  assert.match(standalone, /shippingAddresses:\s*\[/);
  assert.match(standalone, /딸네 집/);
  assert.match(standalone, /가게/);
  assert.match(profileFormSource, /기본 배송 정보/);
  assert.match(profileFormSource, /aria-expanded=/);
  assert.match(profileFormSource, /set[A-Za-z]*Open/);
  assert.match(profileFormSource, /➕ 새 배송지 추가/);
  assert.match(standalone, /받는 분 이름|수령인 이름/);
  assert.match(standalone, /추가 배송지|배송지 목록/);
  assert.match(standalone, /📦 택배 가능 횟수/);
  assert.match(standalone, /➕ 택배비만 입금하기/);

  assert.match(standalone, /function nextPaymentDeadline/);
  assert.match(standalone, /11,\s*59,\s*59/);
  assert.match(paymentWaitingSource, /입금 마감까지 남은 시간/);
  assert.match(
    paymentWaitingSource,
    /⚠️ 마감 내 미입금 시 자동 취소 및 누적 경고가 부여됩니다/,
  );
  assert.match(paymentWaitingSource, /☑️ 전체 상품 일괄 결제 진행하기/);
  assert.match(paymentWaitingSource, /🔎 계좌번호 보기/);
  assert.doesNotMatch(paymentWaitingSource, /onPay\(item\)|onPayItem\(item\)/);
  assert.match(standalone, /function PaymentModal/);
  assert.match(standalone, /결제 및 계좌 안내/);
  assert.match(standalone, /결제 상품/);
  assert.match(standalone, /상품 낙찰 총액|상품 금액 합계/);
  assert.match(standalone, /입금할 총 금액/);
  assert.match(standalone, /무통장 입금 계좌/);
  assert.match(standalone, /☑️ 택배비 4,000원 함께 결제/);
  assert.match(standalone, /🔎 계좌번호 보기/);
  assert.match(standalone, /택배 가능 횟수 1회 추가/);

  assert.match(standalone, /function KeepList/);
  assert.match(standalone, /function KeepAllModal/);
  assert.match(standalone, /나의 보관함 \(Keep\)/);
  assert.match(standalone, /전체 보관함 보기/);
  assert.match(standalone, /\.slice\(0,\s*6\)/);
  assert.match(
    standalone,
    /grid-cols-1[^"\n]*md:grid-cols-2[^"\n]*lg:grid-cols-3/,
  );
  assert.match(standalone, /📦 발송 받으실 배송지 선택/);
  assert.match(standalone, /이 주소로 발송 신청/);
  assert.match(standalone, /선택 상품 택배 접수하기/);
  assert.match(standalone, /shippingAddress|selectedAddress/);
  assert.match(standalone, /택배 가능 횟수가 부족합니다/);

  assert.match(standalone, /function ShippingStatusBoard/);
  assert.match(standalone, /관리자 발송 대기열/);
  assert.match(standalone, /택배 발송 처리된 정보/);
  assert.match(standalone, /grid-cols-1[^"\n]*lg:grid-cols-2/);
  assert.match(standalone, /SHIPPED_ITEMS/);
  assert.match(standalone, /trackingNumber/);
  assert.match(standalone, /📋 복사하기/);
  assert.match(standalone, /🚚 택배 조회하기/);
  assert.match(standalone, /WaybillResult\.do/);
  assert.match(standalone, /wblnum/);
  assert.match(standalone, /function getNextShippingSchedule/);
  assert.match(standalone, /화·수·목 오후 5시/);
  assert.match(standalone, /한진택배 발송 예정/);

  assert.match(standalone, /function AdminShippingQueue/);
  assert.match(standalone, /고객명/);
  assert.match(standalone, /총 \{request\.items\.length\}벌/);
  assert.match(standalone, /상품명 요약/);
  assert.match(standalone, /👕 상품 상세 미리보기/);
  assert.match(standalone, /function AdminPickingPreviewModal/);
  assert.match(standalone, /item\.imageUrls/);
  assert.match(standalone, /피킹 \{itemIndex \+ 1\}/);
  assert.match(standalone, /function ShipmentRegistrationModal/);
  assert.match(standalone, /택배 발송 처리 및 송장 등록/);
  assert.match(standalone, /최종 배송지 정보/);
  assert.match(standalone, /한진택배 송장번호/);
  assert.match(standalone, /\^\\d\{10,14\}\$/);
  assert.match(standalone, /송장 등록하기/);
  assert.match(standaloneAppStateSource, /setShippingQueue\(\(current\) => current\.filter/);
  assert.match(standaloneAppStateSource, /setShippedItems\(\(current\) => \[shippedBatch, \.\.\.current\]\)/);
  assert.match(standaloneAppStateSource, /shippedItems=\{shippedItems\}/);
  assert.match(standaloneAppStateSource, /onRegisterShipment=\{registerShipment\}/);

  assert.match(standalone, /Array\.from\(\{ length: 7 \}/);
  assert.match(standalone, /오늘 ·/);
  assert.match(standalone, /어제 ·/);
  assert.match(standalone, /최근 7일 날짜별 마감 정보/);
  assert.match(adminSettlementTableSource, /낙찰자 성명/);
  assert.match(adminSettlementTableSource, /낙찰 상품들의 썸네일 사진 목록/);
  assert.match(adminSettlementTableSource, /낙찰 금액/);
  assert.match(adminSettlementTableSource, /진행 상태/);
  assert.doesNotMatch(adminSettlementTableSource, /연락처|배송 주소|sale\.phone|sale\.address/);
  assert.match(standalone, /function AdminDirectChatModal/);
  assert.match(standalone, /💬 1:1 톡/);
  assert.match(standaloneAppStateSource, /setAdminCsMessages/);
  assert.match(standaloneAppStateSource, /onSendAdminCsMessage=\{appendAdminCsMessage\}/);
  assert.ok((standalone.match(/closedAt: dateAt\(-?[0-6], 21/g) ?? []).length >= 7);
});

test("ships demo.html as the same complete standalone snapshot", async () => {
  const [indexHtml, demoHtml] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../demo.html", import.meta.url), "utf8"),
  ]);

  assert.equal(demoHtml, indexHtml);
  assert.match(demoHtml, /https:\/\/cdn\.tailwindcss\.com/);
  assert.match(demoHtml, /react@18\/umd\/react\.production\.min\.js/);
  assert.match(demoHtml, /react-dom@18\/umd\/react-dom\.production\.min\.js/);
  assert.match(demoHtml, /@babel\/standalone\/babel\.min\.js/);
  assert.match(demoHtml, /images\.unsplash\.com/);
  assert.match(demoHtml, /function ProductInquiryModal/);
  assert.match(demoHtml, /function BidConfirmModal/);
  assert.match(demoHtml, /function BidHistoryModal/);

  const transpiled = ts.transpileModule(getStandaloneJsx(demoHtml), {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "demo-standalone.jsx",
    reportDiagnostics: true,
  });
  const syntaxErrors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    syntaxErrors.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ),
    [],
    "standalone Babel JSX must parse without syntax errors",
  );
});
