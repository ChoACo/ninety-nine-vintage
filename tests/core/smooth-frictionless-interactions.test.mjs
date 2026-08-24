import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("App Router navigation exposes immediate global progress without a new runtime package", async () => {
  const [layout, progress, styles] = await Promise.all([
    read("src/app/layout.tsx"),
    read("src/components/layout/NavigationProgress.tsx"),
    read("src/app/globals.css"),
  ]);
  assert.match(layout, /<Suspense fallback=\{null\}>[\s\S]*<NavigationProgress \/>/);
  assert.match(progress, /document\.addEventListener\("click", onClick\)/);
  assert.match(progress, /ninety-nine:navigation-start/);
  assert.match(progress, /role="progressbar"/);
  assert.match(styles, /\.navigation-progress[\s\S]*will-change:\s*transform/);
});

test("mobile sheets support hardware-accelerated slide and drag-to-dismiss", async () => {
  const [dialog, styles, filter] = await Promise.all([
    read("src/components/ui/PremiumDialog.tsx"),
    read("src/app/globals.css"),
    read("src/components/features/shop/ShopFilterDrawer.tsx"),
  ]);
  assert.match(dialog, /onPointerDown=\{beginDrag\}/);
  assert.match(dialog, /translate3d/);
  assert.match(dialog, /dragOffset >= 88/);
  assert.match(styles, /@keyframes premium-sheet-in[\s\S]*translate3d/);
  assert.match(filter, /basePath\.startsWith\("\/m"\) \? "sheet-bottom" : "center"/);
});

test("MY tabs animate their indicator and preserve document scroll during tab navigation", async () => {
  const dashboard = await read("src/components/features/mypage/MyDashboard.tsx");
  assert.match(dashboard, /layoutId=\{`my-tab-indicator-/);
  assert.match(dashboard, /router\.push\(href, \{ scroll: false \}\)/);
  assert.match(dashboard, /<AnimatePresence initial=\{false\} mode="popLayout">/);
});

test("realtime auction prices and incoming bids animate while commerce failures rollback", async () => {
  const [sticky, wishlist, cart] = await Promise.all([
    read("src/components/features/auction/detail/StickyBidPanel.tsx"),
    read("src/components/features/wishlist/WishlistFeed.tsx"),
    read("src/components/features/commerce/CartView.tsx"),
  ]);
  assert.match(sticky, /backgroundColor:[\s\S]*key=\{displayPrice\}/);
  assert.match(sticky, /AUCTION_BID_OPTIMISTIC_EVENT/);
  assert.match(sticky, /내 입찰 · \{activeOptimisticBid\.state === "pending" \? "전송 중"/);
  assert.match(sticky, /activeVisibleBids\.slice\(0, 5\)[\s\S]*<motion\.div/);
  assert.match(sticky, /removeFromCart\(item\.id\)/);
  assert.match(sticky, /찜을 저장하지 못해 이전 상태로 되돌렸습니다/);
  assert.match(wishlist, /removeFromCart\(product\.id\)/);
  assert.match(cart, /장바구니 삭제를 저장하지 못해 상품을 다시 복원했습니다/);
});

test("loading surfaces shimmer and storage payment feedback stays server-derived", async () => {
  const [styles, auctionSkeleton, account, transfer, image] = await Promise.all([
    read("src/app/globals.css"),
    read("src/components/skeletons/AuctionSkeletons.tsx"),
    read("src/components/features/account/AccountDashboard.tsx"),
    read("src/components/features/account/CombinedAuctionPayment.tsx"),
    read("src/components/ui/CatalogImage.tsx"),
  ]);
  assert.match(styles, /@keyframes skeleton-shimmer/);
  assert.match(auctionSkeleton, /skeleton-shimmer[\s\S]*aspect-\[3\/4\]/);
  assert.match(account, /vault-floating-summary/);
  assert.match(account, /신청 시 서버 확정/);
  assert.match(account, /shippingFeeAmount/);
  assert.match(transfer, /계좌번호를 복사했습니다/);
  assert.match(image, /CATALOG_BLUR_DATA_URL/);
  assert.match(image, /filter 240ms ease, opacity 240ms ease/);
});
