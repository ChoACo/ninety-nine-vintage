import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("v2 commerce shell owns the shared desktop chrome without business credentials", async () => {
  const [layout, shell, styles] = await Promise.all([
    source("src/app/layout.tsx"),
    source("src/components/commerce/CommerceShell.tsx"),
    source("src/app/globals.css"),
  ]);

  assert.match(layout, /CommerceShell/);
  assert.match(shell, /LIVE DROP/);
  assert.match(shell, /LIVE AUCTION/);
  assert.match(shell, /BUY NOW/);
  assert.match(shell, /AUTH|AuthModal/);
  assert.doesNotMatch(shell, /SUPABASE_SECRET|PORTONE_API_SECRET|service_role/i);
  assert.match(styles, /\.nn-site/);
  assert.match(styles, /\.nn-page-title/);
  assert.match(styles, /\.nn-action/);
});

test("catalog surfaces normalize old product headers before visual rendering", async () => {
  const [adapter, card, detail, shop, sold] = await Promise.all([
    source("src/features/commerce/productViewModel.ts"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/features/auction/EditorialAuctionDetail.tsx"),
    source("src/components/shop/ShopPage.tsx"),
    source("src/components/sold/SoldArchivePage.tsx"),
  ]);

  assert.match(adapter, /cleanCommerceText/);
  assert.match(adapter, /ninety/iu);
  assert.match(adapter, /toCommerceProductView/);
  assert.match(card, /toCommerceProductView\(post\)/);
  assert.match(detail, /toCommerceProductView\(post\)/);
  assert.match(shop, /toCommerceProductView\(post\)/);
  assert.match(sold, /cleanCommerceText\(auction\.title\)/);
});

test("feed removes desktop side rails while retaining its product and operation controls", async () => {
  const app = await source("src/components/AuctionApp.tsx");

  assert.match(app, /const showDesktopRails = false/);
  assert.match(app, /<FeedList/);
  assert.match(app, /onBid=\{handleBid\}/);
  assert.match(app, /onInquiry=\{handleProductInquiry\}/);
  assert.match(app, /showOperatorControls=\{canAccessOperationsCenter\(auth\.role\)\}/);
});
