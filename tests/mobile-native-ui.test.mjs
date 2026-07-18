import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("uses a permission-aware safe-area bottom navigation and compact two-column feeds", async () => {
  const [navigation, clock, feed, soldFeed, globalStyles] = await Promise.all([
    source("src/components/common/Navigation.tsx"),
    source("src/components/common/AuctionClock.tsx"),
    source("src/components/feed/FeedList.tsx"),
    source("src/components/feed/SoldAuctionFeed.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(navigation, /visibleNavigationItems = navigationItems\.filter/);
  assert.match(navigation, /!item\.staffOnly \|\| canAccessOperationsWorkspace\(role\)/);
  assert.match(navigation, /visibleNavigationItems\.length === 4 \? "grid-cols-4" : "grid-cols-3"/);
  assert.match(globalStyles, /\.app-primary-navigation[\s\S]*safe-area-inset-bottom/);
  assert.match(clock, /className="hidden gap-2 border-t[^"]*sm:grid/);
  assert.match(feed, /grid grid-cols-2 gap-3\.5 bg-transparent/);
  assert.match(feed, /grid grid-cols-2 items-stretch gap-3\.5 bg-transparent/);
  assert.match(soldFeed, /grid grid-cols-2 gap-3\.5 bg-transparent/);
});

test("keeps commerce handlers while enforcing native bottom sheets and 48px actions", async () => {
  const [button, account, bidForm, bidConfirm, layout] = await Promise.all([
    source("src/components/common/Button.tsx"),
    source("src/components/profile/AccountPage.tsx"),
    source("src/components/feed/BidFormModal.tsx"),
    source("src/components/feed/BidConfirmModal.tsx"),
    source("app/layout.tsx"),
  ]);

  assert.match(button, /sm: "min-h-12[^"]*sm:min-h-10"/);
  assert.match(button, /md: "min-h-12[^"]*sm:min-h-11"/);
  assert.match(button, /active:scale-\[0\.98\]/);
  assert.match(account, /beginManualBankTransfer\(product\.productId\)/);
  assert.match(account, /navigator\.clipboard\?\.writeText/);
  assert.match(account, /max-sm:absolute max-sm:bottom-0 max-sm:max-h-\[92dvh\]/);
  assert.match(account, /className="mt-2 min-h-12 active:scale-\[0\.98\]"/);
  assert.match(bidForm, /max-sm:bottom-0[^"]*max-sm:max-h-\[92dvh\]/);
  assert.match(bidConfirm, /max-sm:bottom-0[^"]*max-sm:max-h-\[92dvh\]/);
  assert.match(layout, /interactiveWidget: "resizes-content"/);
});

test("adds pinch zoom without losing cyclic swipe and keyboard gallery contracts", async () => {
  const gallery = await source("src/components/feed/PhotoGalleryModal.tsx");

  assert.match(gallery, /const pinchStartRef = useRef/);
  assert.match(gallery, /getTouchDistance\(event\.touches\)/);
  assert.match(gallery, /Math\.min\(Math\.max\(pinchStart\.scale \* \(distance \/ pinchStart\.distance\), 1\), 3\)/);
  assert.match(gallery, /gestureConsumedRef\.current = true/);
  assert.match(gallery, /if \(gestureConsumedRef\.current\)[\s\S]*touchStartX\.current = null/);
  assert.match(gallery, /onTouchMove=\{updatePinchZoom\}/);
  assert.match(gallery, /touch-none/);
  assert.match(gallery, /touchAction: "none"/);
  assert.match(gallery, /핀치하거나 탭하여 확대 검수/);
  assert.match(gallery, /hidden size-12[^"]*sm:grid/);
  assert.match(gallery, /Math\.abs\(distance\) < 45/);
  assert.match(gallery, /event\.key === "ArrowLeft"[\s\S]*event\.key === "ArrowRight"/);
});

test("uses single-surface mobile chat with keyboard-safe composers and gesture lanes", async () => {
  const [memberChat, staffChat, floatingChat] = await Promise.all([
    source("src/components/chat/ChatPage.tsx"),
    source("src/components/chat/StaffChatInbox.tsx"),
    source("src/components/chat/FloatingAdminChat.tsx"),
  ]);

  assert.match(memberChat, /h-\[calc\(100dvh-9\.5rem\)\] min-h-0/);
  assert.match(memberChat, /touch-pan-x snap-x snap-mandatory/);
  assert.match(memberChat, /safe-area-inset-bottom/);
  assert.match(staffChat, /setIsMobileConversationOpen\(true\)/);
  assert.match(staffChat, /fixed inset-0 z-\[80\] h-dvh[\s\S]*md:static/);
  assert.match(staffChat, /aria-label="상담 목록으로 돌아가기"/);
  assert.match(staffChat, /scroll-pb-28/);
  assert.match(floatingChat, /fixed inset-0 z-\[70\] flex h-dvh/);
  assert.match(floatingChat, /isOpen \? "hidden md:flex" : "flex"/);
  assert.match(floatingChat, /safe-area-inset-top/);
});

test("makes the operator workspace touch-scrollable with compact mobile KPIs", async () => {
  const [admin, revenue] = await Promise.all([
    source("src/components/admin/AdminPage.tsx"),
    source("src/components/admin/RevenuePanel.tsx"),
  ]);

  assert.match(admin, /top-\[calc\(env\(safe-area-inset-top\)\+\.5rem\)\]/);
  assert.match(admin, /snap-x snap-mandatory/);
  assert.match(admin, /min-h-12 shrink-0 snap-start/);
  assert.match(admin, /grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4/);
  assert.match(admin, /max-sm:bottom-\[calc\(5\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(revenue, /grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4/);
  assert.match(revenue, /touch-pan-x overflow-x-auto overscroll-x-contain/);
});

test("keeps owner controls guarded while exposing touch tabs and danger bottom sheets", async () => {
  const [owner, security, rbac, danger] = await Promise.all([
    source("src/components/owner/OwnerPrivatePage.tsx"),
    source("src/components/owner/OwnerSecurityAdminPanel.tsx"),
    source("src/components/owner/OwnerRbacPanel.tsx"),
    source("src/components/owner/OwnerDangerConfirmModal.tsx"),
  ]);

  assert.match(owner, /touch-pan-x snap-x snap-mandatory/);
  assert.match(owner, /safe-area-inset-top/);
  assert.match(owner, /safe-area-inset-bottom/);
  assert.match(security, /touch-pan-x snap-x snap-mandatory/);
  assert.match(rbac, /touch-pan-x overflow-x-auto overscroll-x-contain/);
  assert.match(rbac, /<OwnerDangerConfirmModal/);
  assert.match(danger, /min-h-dvh[^"]*overscroll-none/);
  assert.match(danger, /max-h-\[calc\(100dvh-env\(safe-area-inset-top\)-\.5rem\)\]/);
  assert.match(danger, /safe-area-inset-bottom/);
  assert.match(danger, /role="alertdialog"/);
});
