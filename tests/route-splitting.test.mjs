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

test("exposes feed, account, chat, and operator as independent routes", async () => {
  const [home, feed, account, chat, operator, app] = await Promise.all([
    source("app/page.tsx"),
    source("app/feed/page.tsx"),
    source("app/account/page.tsx"),
    source("app/chat/page.tsx"),
    source("app/operator/page.tsx"),
    source("src/components/AuctionApp.tsx"),
  ]);

  assert.match(home, /<AuctionApp page="feed"/);
  assert.match(feed, /<AuctionApp page="feed"/);
  assert.match(account, /<AuctionApp page="profile"/);
  assert.match(chat, /<AuctionApp page="chat"/);
  assert.match(operator, /<AuctionApp page="admin"/);
  assert.match(app, /feed: "\/feed"/);
  assert.match(app, /profile: "\/account"/);
  assert.match(app, /chat: "\/chat"/);
  assert.match(app, /admin: "\/operator"/);
});

test("keeps feed-only realtime work disabled on the other routes", async () => {
  const [app, productsHook, soldHook] = await Promise.all([
    source("src/components/AuctionApp.tsx"),
    source("src/hooks/useSupabaseProducts.ts"),
    source("src/hooks/usePublicSoldAuctions.ts"),
  ]);

  assert.match(app, /const isFeedPage = activePage === "feed"/);
  assert.match(app, /useSupabaseProducts\(\{ enabled: isFeedPage \}\)/);
  assert.match(app, /usePublicSoldAuctions\(\{ enabled: isFeedPage \}\)/);
  assert.match(
    app,
    /enabled: isFeedPage && !auth\.isLoading && showOnlineMembers/,
  );
  assert.match(productsHook, /if \(!enabled\) \{/);
  assert.match(soldHook, /if \(!enabled\) return;/);
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
  assert.match(productsHook, /setPosts\(firstPage\.posts\)/);
  assert.match(productsHook, /const pageSnapshot = pageSnapshotRef\.current/);
  assert.match(productsHook, /new Set\(currentPosts\.map\(\(post\) => post\.id\)\)/);
  assert.match(productsHook, /\[\.\.\.currentPosts, \.\.\.uniqueNextPosts\]/);
  assert.match(productsHook, /requestGeneration !== requestGenerationRef\.current/);
  assert.match(app, /hasMoreProducts=\{hasMoreProducts\}/);
  assert.match(app, /isLoadingMore=\{productsLoadingMore\}/);
  assert.match(app, /onLoadMore=\{loadMoreProducts\}/);
  assert.match(feed, /hiddenPostCount > 0 \|\| hasMoreProducts/);
  assert.match(feed, /await onLoadMore\(\)/);
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
  for (const path of ["/feed", "/account", "/chat", "/operator"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.doesNotMatch(html, /404: NOT_FOUND|Code: NOT_FOUND/);
    assert.match(html, new RegExp(`"pathname":"${path}"`));
  }
});
