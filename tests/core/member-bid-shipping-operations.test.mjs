import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("delivery work is member-grouped and transitions into a 30-day minimal archive", async () => {
  const [migration, route, consoleSource] = await Promise.all([
    source("supabase/migrations/20260724091825_member_bid_shipping_operations.sql"),
    source("src/app/api/admin/operator/shipping/route.ts"),
    source("src/components/admin/operator/OperatorShippingConsole.tsx"),
  ]);

  assert.match(migration, /delivery_completed_at/);
  assert.match(migration, /shipped_at \+ interval '7 days'/);
  assert.match(migration, /shipped_at \+ interval '37 days'/);
  assert.match(migration, /delete from public\.inventory_delivery_history/);
  assert.match(migration, /inventory-delivery-retention/);
  assert.match(route, /completedDeliveries/);
  assert.match(consoleSource, /groupShipmentsByMember/);
  assert.match(consoleSource, /groupCompletedByMember/);
  assert.match(consoleSource, /<details className="group border-t border-line"/);
  assert.match(consoleSource, /완료 후 30일 보관/);
});

test("active bidding page is placed between home and live auction and supports realtime quick bidding", async () => {
  const [component, desktopHeader, mobileHeader, desktopPage, mobilePage] =
    await Promise.all([
      source("src/components/features/auction/ActiveBidProducts.tsx"),
      source("src/components/layout/PcHeader.tsx"),
      source("src/components/mobile/MobileSiteHeader.tsx"),
      source("src/app/(shop)/bidding/page.tsx"),
      source("src/app/(mobile)/m/bidding/page.tsx"),
    ]);

  assert.match(desktopHeader, /홈[\s\S]*입찰 중인 상품[\s\S]*실시간 경매/);
  assert.match(mobileHeader, /홈[\s\S]*입찰 중인 상품[\s\S]*실시간 경매/);
  assert.match(component, /productStatus === "active"/);
  assert.match(component, /postgres_changes/);
  assert.match(component, /다른 회원이 더 높은 가격으로 입찰했습니다/);
  assert.match(component, /currentPrice \+ 1_000/);
  assert.match(component, /확인하고 간편입찰/);
  assert.match(desktopPage, /<ActiveBidProducts/);
  assert.match(mobilePage, /basePath="\/m"/);
});

test("home no longer renders curated shop archive sections", async () => {
  const [desktopHome, mobileHome] = await Promise.all([
    source("src/app/(shop)/home/page.tsx"),
    source("src/app/(mobile)/m/home/page.tsx"),
  ]);

  for (const home of [desktopHome, mobileHome]) {
    assert.doesNotMatch(home, /엄선된 숍/);
    assert.doesNotMatch(home, /각자의 시선, 하나의 아카이브/);
    assert.doesNotMatch(home, /전체 숍 보기/);
    assert.doesNotMatch(home, /fetchActiveStores/);
  }
});
