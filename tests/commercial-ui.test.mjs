import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("exposes reusable high-end commerce primitives with accessible motion fallbacks", async () => {
  const [globals, button, modal, toast] = await Promise.all([
    source("src/app/globals.css"),
    source("src/components/common/Button.tsx"),
    source("src/components/common/Modal.tsx"),
    source("src/components/common/Toast.tsx"),
  ]);

  assert.match(globals, /\.commerce-numeric[\s\S]*font-variant-numeric: tabular-nums/);
  assert.match(globals, /\.commerce-skeleton::after[\s\S]*commerce-shimmer/);
  assert.match(globals, /\.commerce-empty-state/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(button, /transition-all duration-200 ease-out/);
  assert.match(button, /hover:scale-\[1\.02\]/);
  assert.match(button, /focus-visible:ring-2/);
  assert.match(modal, /items-end[\s\S]*sm:items-center/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /focusableSelector/);
  assert.match(toast, /aria-live="polite"/);
});

test("keeps auction urgency in the visual layer while preserving the policy clock", async () => {
  const [clock, auctionApp, homeLanding] = await Promise.all([
    source("src/components/common/AuctionClock.tsx"),
    source("src/components/AuctionApp.tsx"),
    source("src/components/home/HomeLandingPage.tsx"),
  ]);

  assert.match(clock, /displayCountdown\.totalSeconds <= 10 \* 60/);
  assert.match(clock, /displayCountdown\.totalSeconds <= 60 \* 60/);
  assert.match(clock, /auction-urgency-critical/);
  assert.match(clock, /auction-urgency-soon/);
  assert.match(clock, /font-mono[\s\S]*tabular-nums[\s\S]*tracking-tight/);
  assert.doesNotMatch(clock, /animate-pulse/);

  assert.match(
    auctionApp,
    /<AuctionClock[\s\S]*antiSnipingDeadlines=\{posts[\s\S]*antiSnipingExtensionCount/,
  );
  assert.match(auctionApp, /<FeedList[\s\S]*onBid=\{handleBid\}/);
  assert.match(auctionApp, /const HomeLandingPage = lazy/);
  assert.match(homeLanding, /LIVE AUCTION 입장/);
  assert.match(homeLanding, /지금 공개된 상품/);
  assert.match(homeLanding, /href="\/shop"/);
  assert.match(auctionApp, /commerce-skeleton/);
});

test("uses dense commerce surfaces for feed, operations, chat, and account payment", async () => {
  const [feed, card, admin, chat, account] = await Promise.all([
    source("src/components/feed/FeedList.tsx"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/admin/AdminPage.tsx"),
    source("src/components/chat/StaffChatInbox.tsx"),
    source("src/components/profile/AccountPage.tsx"),
  ]);

  assert.match(feed, /<FeedSkeleton/);
  assert.match(feed, /EmptyRackIcon/);
  assert.match(card, /font-mono[\s\S]*tabular-nums[\s\S]*tracking-tight/);
  assert.match(card, /transition-all duration-200 ease-out/);

  assert.match(admin, /OPERATIONS CENTER/);
  assert.match(admin, /lg:grid-cols-\[224px_minmax\(0,1fr\)\]/);
  assert.match(admin, /font-mono[\s\S]*tabular-nums/);
  assert.match(chat, /aria-live="polite"/);
  assert.match(chat, /<time[\s\S]*font-mono[\s\S]*tabular-nums/);

  assert.match(account, /ManualTransferPaymentModal/);
  assert.match(account, /PortOnePaymentModal/);
  assert.match(account, /commerce-skeleton/);
  assert.match(account, /font-mono[\s\S]*tabular-nums[\s\S]*tracking-tight/);
});

test("keeps the two-step bid contract while comparing the current price with the submitted bid", async () => {
  const [confirmModal, card, liveSidebar] = await Promise.all([
    source("src/components/feed/BidConfirmModal.tsx"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/live/LiveBidSidebar.tsx"),
  ]);

  assert.match(confirmModal, /currentPrice: number/);
  assert.match(confirmModal, /latestCurrentPrice\?: number/);
  assert.match(
    confirmModal,
    /aria-label=\{`현재가 \$\{formatKRW\(currentPrice\)\}에서 나의 입찰가 \$\{formatKRW\(amount\)\}로 입찰`\}/,
  );
  assert.match(confirmModal, /현재가[\s\S]*formatKRW\(currentPrice\)/);
  assert.match(confirmModal, /나의 입찰가[\s\S]*formatKRW\(amount\)/);
  assert.match(confirmModal, /await onConfirm\(\)/);

  assert.match(
    card,
    /<BidFormModal[\s\S]*onSubmit=\{requestManualBid\}[\s\S]*<BidConfirmModal/,
  );
  assert.match(
    card,
    /<BidConfirmModal[\s\S]*currentPrice=\{pendingCurrentPrice \?\? post\.currentPrice\}[\s\S]*latestCurrentPrice=\{post\.currentPrice\}[\s\S]*amount=\{pendingBidAmount \?\? 0\}[\s\S]*onConfirm=\{confirmBid\}/,
  );
  assert.match(card, /setPendingCurrentPrice\(post\.currentPrice\)/);
  assert.match(
    card,
    /pendingCurrentPrice !== post\.currentPrice[\s\S]*현재가가 변경되었습니다/,
  );
  assert.match(card, /await onBid\?\.\(post\.id, pendingBidAmount\)/);

  assert.match(
    liveSidebar,
    /onQuickBid=\{\(\) => openBidConfirmation\(post\)\}/,
  );
  assert.match(liveSidebar, /setConfirmCurrentPrice\(post\.currentPrice\)/);
  assert.match(liveSidebar, /setConfirmAmount\(getQuickBidAmount\(post\)\)/);
  assert.match(
    liveSidebar,
    /await onBid\(confirmPost\.id, confirmAmount\)/,
  );
  assert.match(
    liveSidebar,
    /<BidConfirmModal[\s\S]*currentPrice=\{confirmCurrentPrice\}[\s\S]*latestCurrentPrice=\{confirmPost\.currentPrice\}[\s\S]*amount=\{confirmAmount\}[\s\S]*onConfirm=\{handleConfirm\}/,
  );
  assert.match(confirmModal, /hasCurrentPriceChanged[\s\S]*현재가 변경됨/);
  assert.match(
    confirmModal,
    /disabled=\{isSubmitting \|\| hasCurrentPriceChanged\}/,
  );
});

test("shows honest live-bid participation badges without fabricating payment state", async () => {
  const [badge, card, liveSidebar] = await Promise.all([
    source("src/components/feed/BidParticipationBadge.tsx"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/live/LiveBidSidebar.tsx"),
  ]);

  assert.match(badge, /"user-leading"[\s\S]*label: "입찰 중"/);
  assert.match(badge, /"user-outbid"[\s\S]*label: "상위 입찰 발생"/);
  assert.match(badge, /motion-safe:animate-pulse/);
  assert.match(badge, /role="status"/);
  assert.match(badge, /data-participation-status=\{status\}/);
  assert.doesNotMatch(
    badge,
    /입금 대기|결제 완료|paymentStatus|manualTransferStatus/,
  );

  assert.match(card, /<BidParticipationBadge status=\{bidState\.status\} \/>/);
  assert.match(liveSidebar, /participationStatus="user-outbid"/);
  assert.match(liveSidebar, /participationStatus="user-leading"/);
});

test("uses seven stateful SPA workspace tabs and preserves a visited panel's local state", async () => {
  const [admin, collapsible] = await Promise.all([
    source("src/components/admin/AdminPage.tsx"),
    source("src/components/admin/CollapsibleSection.tsx"),
  ]);
  const expectedSectionIds = [
    "operations-registration",
    "operations-products",
    "operations-shipping",
    "operations-payments",
    "operations-overview",
    "operations-revenue",
    "operations-members",
  ];
  const sectionsStart = admin.indexOf("const operationSections = [");
  const sectionsEnd = admin.indexOf("] as const;", sectionsStart);
  assert.ok(sectionsStart >= 0 && sectionsEnd > sectionsStart);
  const sectionsBlock = admin.slice(sectionsStart, sectionsEnd);
  let previousSectionIndex = -1;
  for (const id of expectedSectionIds) {
    const sectionIndex = sectionsBlock.indexOf(`"${id}"`);
    assert.ok(
      sectionIndex > previousSectionIndex,
      `${id} must keep its operations workflow order`,
    );
    previousSectionIndex = sectionIndex;
  }
  assert.equal(
    [...sectionsBlock.matchAll(/\["operations-[^"]+"/g)].length,
    7,
  );

  const navLabel = admin.indexOf('aria-label="운영 센터 업무 선택"');
  const navStart = admin.lastIndexOf("<nav", navLabel);
  const navEnd = admin.indexOf("</nav>", navStart);
  assert.ok(navStart >= 0 && navEnd > navStart);
  const workspaceNav = admin.slice(navStart, navEnd);
  assert.match(workspaceNav, /<button/);
  assert.match(workspaceNav, /type="button"/);
  assert.match(workspaceNav, /role="tab"/);
  assert.match(workspaceNav, /aria-selected=\{activeSection === href\}/);
  assert.match(workspaceNav, /aria-controls=\{href\}/);
  assert.match(workspaceNav, /onClick=\{\(\) => openOperationSection\(href\)\}/);
  assert.doesNotMatch(workspaceNav, /<a\b|\bhref=/);
  assert.match(admin, /<nav aria-label="운영 센터 업무 선택" role="tablist"/);
  assert.match(
    admin,
    /const openOperationSection = \(section: OperationSectionId\) => \{[\s\S]*setActiveSection\(section\)/,
  );

  const activeBindings = [
    ...admin.matchAll(
      /active=\{activeSection === "(operations-[^"]+)"\}/g,
    ),
  ].map((match) => match[1]);
  assert.equal(activeBindings.length, 7);
  assert.deepEqual(
    [...activeBindings].sort(),
    [...expectedSectionIds].sort(),
  );

  const visitedBindings = [
    ...admin.matchAll(
      /visited=\{visitedSections\.has\("(operations-[^"]+)"\)\}/g,
    ),
  ].map((match) => match[1]);
  assert.equal(visitedBindings.length, 7);
  assert.deepEqual(
    [...visitedBindings].sort(),
    [...expectedSectionIds].sort(),
  );
  assert.match(
    admin,
    /setVisitedSections\(\(current\) => \{[\s\S]*next\.add\(section\)/,
  );

  assert.match(collapsible, /active\?: boolean/);
  assert.match(collapsible, /visited\?: boolean/);
  assert.match(
    collapsible,
    /const \[hasBeenOpened, setHasBeenOpened\] = useState\(defaultOpen\)/,
  );
  assert.match(collapsible, /const isControlled = active !== undefined/);
  assert.match(collapsible, /const isExpanded = isControlled \? active : isOpen/);
  assert.match(
    collapsible,
    /const shouldMount = isControlled \? \(visited \?\? active === true\) : hasBeenOpened/,
  );
  assert.match(
    collapsible,
    /isControlled && !isExpanded \? "hidden" : ""/,
  );
  assert.match(collapsible, /hidden=\{isControlled && !isExpanded\}/);
  assert.match(collapsible, /inert=\{!isExpanded\}/);
  assert.match(collapsible, /shouldMount \? \([\s\S]*\{children\}/);
  assert.match(
    collapsible,
    /if \(!isOpen\) setHasBeenOpened\(true\);[\s\S]*setIsOpen\(\(current\) => !current\)/,
  );
  assert.doesNotMatch(collapsible, /setHasBeenOpened\(false\)/);
});

test("keeps operations handlers wired through the compact product workspace", async () => {
  const admin = await source("src/components/admin/AdminPage.tsx");

  for (const handlerPattern of [
    /onClick=\{onOpenBulkImport\}/,
    /onClick=\{onCreateProduct\}/,
    /onClick=\{\(\) => void loadProducts\(\)\}/,
    /onClick=\{\(\) => void handlePublishPendingProducts\(\)\}/,
    /onClick=\{\(\) => setEditingProduct\(product\)\}/,
    /setDeletingProduct\(product\)/,
    /onSave=\{handleProductSave\}/,
    /onClick=\{\(\) => void handleProductDelete\(\)\}/,
    /void handleMemberRoleChange\(/,
    /void handleMemberStatusChange\(/,
    /void handleShippingCreditChange\(/,
    /onClick=\{\(\) => openMemberEdit\(member\)\}/,
    /onClick=\{\(\) => void saveMemberEdit\(\)\}/,
    /onClick=\{\(\) => void confirmMemberDelete\(\)\}/,
  ]) {
    assert.match(admin, handlerPattern);
  }

  assert.match(
    admin,
    /hidden grid-cols-\[20px_48px_minmax\(180px,1fr\)_140px_110px_112px\][^\"]*xl:grid/,
  );
  assert.match(
    admin,
    /<ul className="divide-y[^\"]*"[\s\S]*pagedProducts\.map[\s\S]*className="grid grid-cols-\[20px_48px_minmax\(0,1fr\)\][^\"]*xl:grid-cols-\[20px_48px_minmax\(180px,1fr\)_140px_110px_112px\]/,
  );
  assert.match(
    admin,
    /font-mono text-sm font-black tabular-nums tracking-tight[\s\S]*formatKRW\(managedProductPrice\(product\)\)/,
  );
  assert.match(
    admin,
    /function managedProductPrice\(product: ManagedProduct\)[\s\S]*product\.saleType === "fixed"[\s\S]*product\.fixedPrice \?\? product\.startingPrice[\s\S]*product\.currentPrice/,
  );
  assert.match(
    admin,
    /rounded-full border px-2 py-1 text-\[10px\] font-black \$\{productStatusClasses\[product\.status\]\}[\s\S]*managedProductStatusLabel\(product\)/,
  );

  const actionBarStart = admin.indexOf(
    "className={`mt-4 flex flex-col gap-3 rounded-xl border p-3",
  );
  const actionBarEnd = admin.indexOf("{publishFeedback ?", actionBarStart);
  assert.ok(actionBarStart >= 0 && actionBarEnd > actionBarStart);
  const selectedActionBar = admin.slice(actionBarStart, actionBarEnd);
  assert.match(selectedActionBar, /selectedPendingProductIds\.size > 0/);
  assert.match(selectedActionBar, /sticky bottom-4/);
  assert.match(
    selectedActionBar,
    /onClick=\{\(\) => void handlePublishPendingProducts\(\)\}/,
  );
  assert.doesNotMatch(selectedActionBar, /삭제|delete/i);
  assert.match(
    admin,
    /const handlePublishPendingProducts = async \(\) => \{[\s\S]*publishPendingProductsNow\(\[[\s\S]*selectedPendingProductIds/,
  );
  assert.doesNotMatch(
    admin,
    /bulkDeleteProducts|deleteManagedProducts|deleteSelectedProducts|handleBulkDelete/,
  );
});

test("shows truthful high-density payment and shipping workload KPIs", async () => {
  const [manualPayments, shipping] = await Promise.all([
    source("src/components/admin/ManualBankTransferPanel.tsx"),
    source("src/components/admin/ShippingWorkPanel.tsx"),
  ]);
  const kpiClasses =
    /inline-flex items-baseline gap-1 rounded-md[^"]*font-mono tabular-nums text-lg font-bold tracking-tight/;

  assert.match(manualPayments, kpiClasses);
  assert.match(
    manualPayments,
    /\{pendingTotalCount\.toLocaleString\("ko-KR"\)\}[\s\S]*건 대기/,
  );

  assert.match(shipping, kpiClasses);
  assert.match(
    shipping,
    /전체 \{totalCount\.toLocaleString\("ko-KR"\)\}건 중/,
  );
  assert.match(
    shipping,
    /\{selectableItems\.length\.toLocaleString\("ko-KR"\)\}[\s\S]*현재 페이지 대기/,
  );
});
