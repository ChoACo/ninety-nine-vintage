import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);

const source = (path) => readFile(new URL(path, rootUrl), "utf8");

async function render(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("route-test", `${process.pid}-${Date.now()}-${path}`);
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

test("exposes home, feed, shop, account, chat, and operator as independent routes", async () => {
  const [home, homeGuide, feed, shop, account, chat, operator, app] = await Promise.all([
    source("src/app/page.tsx"),
    source("src/app/home/page.tsx"),
    source("src/app/feed/page.tsx"),
    source("src/app/shop/page.tsx"),
    source("src/app/account/page.tsx"),
    source("src/app/chat/page.tsx"),
    source("src/app/operator/page.tsx"),
    source("src/components/AuctionApp.tsx"),
  ]);

  assert.match(home, /<AuctionApp page="home"/);
  assert.match(homeGuide, /<AuctionApp page="home"/);
  assert.match(feed, /<AuctionApp page="feed"/);
  assert.match(shop, /<AuctionApp page="shop"/);
  assert.match(account, /<AuctionApp page="profile"/);
  assert.match(chat, /<AuctionApp page="chat"/);
  assert.match(operator, /<AuctionApp page="admin"/);
  assert.match(app, /feed: "\/feed"/);
  assert.match(app, /profile: "\/account"/);
  assert.match(app, /chat: "\/chat"/);
  assert.match(app, /admin: "\/operator"/);
});

test("separates auction and fixed catalog realtime while keeping sold work on its archive route", async () => {
  const [app, productsHook] = await Promise.all([
    source("src/components/AuctionApp.tsx"),
    source("src/hooks/useSupabaseProducts.ts"),
  ]);

  assert.match(app, /const isFeedPage = activePage === "feed"/);
  assert.match(app, /const isProductSurface = isHomePage \|\| isFeedPage/);
  assert.match(app, /useSupabaseProducts\(\{ enabled: isProductSurface \}\)/);
  assert.match(app, /enabled: isShopPage/);
  assert.match(app, /saleType: "fixed"/);
  assert.match(
    app,
    /enabled: isFeedPage && !auth\.isLoading && showOnlineMembers/,
  );
  assert.match(productsHook, /if \(!enabled\) \{/);
});

test("coalesces product realtime bursts and rejects stale request results", async () => {
  const productsHook = await source("src/hooks/useSupabaseProducts.ts");

  assert.match(productsHook, /REALTIME_REFETCH_DEBOUNCE_MS = 160/);
  assert.match(productsHook, /realtimeRefreshQueuedRef\.current = true/);
  assert.match(productsHook, /window\.clearTimeout\(realtimeTimerRef\.current\)/);
  assert.match(productsHook, /const activeRequest = activeRequestRef\.current/);
  assert.match(productsHook, /requestGenerationRef\.current/);
  assert.ok(
    (productsHook.match(/requestGeneration !== requestGenerationRef\.current/g) ?? [])
      .length >= 2,
  );
  assert.match(productsHook, /enabledRef\.current = false/);
  assert.match(productsHook, /setPosts\(\[\]\)/);
});

test("pages the public product feed in stable 24-row server ranges", async () => {
  const [products, productsHook, app, feed] = await Promise.all([
    source("src/lib/supabase/products.ts"),
    source("src/hooks/useSupabaseProducts.ts"),
    source("src/components/AuctionApp.tsx"),
    source("src/components/feed/FeedList.tsx"),
  ]);

  assert.match(products, /PUBLISHED_PRODUCTS_PAGE_SIZE = 24/);
  assert.match(products, /\.eq\("status", "active"\)/);
  assert.match(products, /\.lte\("publish_at", nowIso\)/);
  assert.match(products, /\.order\("publish_at", \{ ascending: false \}\)/);
  assert.match(products, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(products, /\.range\(rangeStart, rangeEnd\)/);
  assert.match(products, /fetchPublishedProductsPage\(\{ now \}\)/);

  assert.match(productsHook, /hasMoreProducts: boolean/);
  assert.match(productsHook, /isLoadingMore: boolean/);
  assert.match(productsHook, /loadMoreProducts: \(\) => Promise<void>/);
  assert.match(productsHook, /const requestedPageCount = Math\.max\(nextPageRef\.current, 1\)/);
  assert.match(productsHook, /for \(let page = 0; page < requestedPageCount; page \+= 1\)/);
  assert.match(productsHook, /setPosts\(uniquePosts\)/);
  assert.match(productsHook, /const pageSnapshot = pageSnapshotRef\.current/);
  assert.match(productsHook, /new Set\(currentPosts\.map\(\(post\) => post\.id\)\)/);
  assert.match(productsHook, /\[\.\.\.currentPosts, \.\.\.uniqueNextPosts\]/);
  assert.match(productsHook, /requestGeneration !== requestGenerationRef\.current/);
  assert.match(app, /hasMoreProducts=\{hasMoreProducts\}/);
  assert.match(app, /isLoadingMore=\{productsLoadingMore\}/);
  assert.match(app, /onLoadMore=\{loadMoreProducts\}/);
  assert.match(feed, /const PAGE_SIZE = 24/);
  assert.match(feed, /aria-label="경매 상품 페이지 이동"/);
  assert.match(feed, /const renderedPageCount/);
  assert.match(feed, /page \* PAGE_SIZE > posts\.length/);
});

test("defers closed operator section bodies until their first expansion", async () => {
  const collapsible = await source(
    "src/components/admin/CollapsibleSection.tsx",
  );

  assert.match(
    collapsible,
    /const \[hasBeenOpened, setHasBeenOpened\] = useState\(defaultOpen\)/,
  );
  assert.match(collapsible, /if \(!isOpen\) setHasBeenOpened\(true\)/);
  assert.match(collapsible, /\{hasBeenOpened \? \(/);
  assert.match(collapsible, /다시 접어도 DOM에 남겨 두어 입력값과 스크롤 문맥을 잃지 않습니다/);
});

test("loads heavyweight route screens and modals on demand", async () => {
  const [app, admin] = await Promise.all([
    source("src/components/AuctionApp.tsx"),
    source("src/components/admin/AdminPage.tsx"),
  ]);

  assert.match(app, /const AdminPage = lazy\(/);
  assert.match(app, /const ChatPage = lazy\(/);
  assert.match(app, /const FeedList = lazy\(/);
  assert.match(app, /const AccountPage = lazy\(/);
  assert.match(app, /newAuctionOpen && canManageProducts\(auth\.role\)/);
  assert.match(app, /bulkAuctionOpen && canManageProducts\(auth\.role\)/);
  assert.match(app, /authOpen \? \(/);
  assert.match(admin, /const ManualBankTransferPanel = lazy\(/);
  assert.match(admin, /const RevenuePanel = lazy\(/);
  assert.match(admin, /const ShippingWorkPanel = lazy\(/);
  assert.match(admin, /const ProductEditModal = lazy\(/);
  assert.match(admin, /<Suspense fallback=\{<DeferredPanelFallback/);
});

test("server-renders every split route without a Vercel-style 404", async () => {
  for (const path of ["/", "/feed", "/shop", "/account", "/chat", "/operator"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.doesNotMatch(html, /404: NOT_FOUND|Code: NOT_FOUND/);
    assert.match(html, new RegExp(`"pathname":"${path}"`));
  }
});
