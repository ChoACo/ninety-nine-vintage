import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("seller dashboard and live auctions expose mobile realtime work surfaces", async () => {
  const [dashboard, live, route] = await Promise.all([
    source("src/components/admin/operator/OperatorConsole.tsx"),
    source("src/components/admin/operator/LiveAuctionOperations.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
  ]);
  for (const label of ["신규 발송", "보관 출고 요청", "미결제 낙찰", "미답변 문의"])
    assert.match(dashboard, new RegExp(label));
  assert.match(dashboard, /onTouchStart/);
  assert.match(live, /table: "auction_bids"/);
  assert.match(live, /flashedProductId/);
  assert.match(live, /visibilitychange/);
  assert.match(route, /bid_count/);
});

test("seller operational modules use mobile cards, D-Day progress, quick replies and batch tracking input", async () => {
  const [orders, products, storage, shipping, chat] = await Promise.all([
    source("src/components/admin/operator/orders/OrderTable.tsx"),
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorMemberOperationsConsole.tsx"),
    source("src/components/admin/operator/OperatorShippingConsole.tsx"),
    source("src/components/admin/operator/OperatorChatConsole.tsx"),
  ]);
  assert.match(orders, /md:hidden/);
  assert.match(products, /size-16/);
  assert.match(products, /min-h-11 min-w-11/);
  assert.match(storage, /role="progressbar"/);
  assert.match(storage, /남은 보관 기간/);
  assert.match(shipping, /inputMode="numeric"/);
  assert.match(chat, /보관 배송 가능합니다/);
  assert.match(chat, /실측 치수 안내/);
});

test("store notice and settings persist through scoped RPCs with compressed 16 by 7 media", async () => {
  const [settings, notice, route, migration, storefront] = await Promise.all([
    source("src/components/operator/platform/StoreSettingsWorkspace.tsx"),
    source("src/components/admin/operator/StoreNoticeManager.tsx"),
    source("src/app/api/admin/operator/platform/route.ts"),
    source("supabase/migrations/20260823123000_add_operator_store_notice.sql"),
    source("src/components/features/catalog/StoreMallExperience.tsx"),
  ]);
  assert.match(settings, /compressProductImageForUpload/);
  assert.match(settings, /aspect-\[16\/7\]/);
  assert.match(settings, /safe-area-inset-bottom/);
  assert.match(notice, /모바일 미리보기/);
  assert.match(route, /save_operator_store_notice/);
  assert.match(migration, /has_store_permission\(p_store_id, 'manage_store'\)/);
  assert.match(migration, /pg_catalog\.pg_constraint/);
  assert.doesNotMatch(migration, /add constraint if not exists/i);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
  assert.match(storefront, /store\.announcementEnabled/);
});
