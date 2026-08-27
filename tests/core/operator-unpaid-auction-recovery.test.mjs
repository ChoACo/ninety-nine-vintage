import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("unpaid auction recovery rpc is store-scoped, deadline-gated, and audited", async () => {
  const migration = await source(
    "supabase/migrations/20260821000000_operator_unpaid_auction_recovery.sql",
  );

  assert.match(
    migration,
    /create or replace function public\.operator_recover_unpaid_auction\(/i,
  );
  assert.match(migration, /p_mode not in \('reauction', 'fixed'\)/i);
  assert.match(migration, /v_role not in \('owner', 'operator'\)/i);
  assert.match(
    migration,
    /not public\.can_manage_product_store\(v_product\.store_id\)/i,
  );
  assert.match(migration, /v_product\.sale_completed_at is not null/i);
  assert.match(
    migration,
    /offers\.status in \('payment_due', 'offered', 'accepted'\)/i,
  );
  assert.match(migration, /v_original\.status <> 'expired_unpaid'/i);
  assert.match(
    migration,
    /v_publish_at := public\.next_auction_drop_at\(v_now\)/i,
  );
  assert.match(
    migration,
    /closes_at = public\.auction_close_at\(v_publish_at\)/i,
  );
  assert.match(migration, /current_price = starting_price/i);
  assert.match(migration, /final_bid_id = null/i);
  assert.match(migration, /sale_type = 'fixed',/i);
  assert.match(migration, /starting_price = v_price/i);
  assert.match(migration, /current_price = v_price/i);
  assert.match(migration, /auction\.unpaid\.reauction/i);
  assert.match(migration, /auction\.unpaid\.fixed_conversion/i);
  assert.match(
    migration,
    /grant execute on function public\.operator_recover_unpaid_auction\(uuid, text\)\s+to authenticated/i,
  );
});

test("legacy unpaid recovery endpoint is authenticated and retired", async () => {
  const route = await source(
    "src/app/api/admin/operator/auctions/[id]/recover/route.ts",
  );

  assert.match(route, /authenticateOperatorStoreRequest\(request, true\)/);
  assert.match(route, /auction_recovery_route_retired/);
  assert.match(route, /410/);
  assert.doesNotMatch(route, /operator_recover_unpaid_auction/);
});

test("unpaid console reuses authenticated store scope and keeps failures user-facing", async () => {
  const [route, consoleSource, layout] = await Promise.all([
    source("src/app/api/admin/operator/auctions/unpaid/route.ts"),
    source("src/components/admin/operator/OperatorUnpaidAuctionsConsole.tsx"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
  ]);

  assert.match(route, /\.eq\("id", auth\.selectedStoreId\)/);
  assert.doesNotMatch(route, /admin[\s\S]*\.from\("store_memberships"\)/);
  assert.match(route, /message:\s*"미결제 낙찰 정보를 불러오지 못했습니다/);
  assert.match(consoleSource, /payload\.message \?\? "미결제 낙찰을 불러오지 못했습니다/);
  assert.match(consoleSource, /미결제 낙찰 정보를 불러오는 중입니다/);
  assert.match(consoleSource, /미결제 낙찰 정보를 표시할 수 없습니다/);
  assert.match(consoleSource, />\s*다시 시도\s*</);
  assert.match(layout, /eyebrow="운영자 업무 공간"/);
  assert.doesNotMatch(layout, /Seller workspace/);
});

test("past console keeps winner state visible and uses sequential second chance handling", async () => {
  const [pastRoute, pastConsole, resolveRoute] = await Promise.all([
    source("src/app/api/admin/operator/products/past/route.ts"),
    source("src/components/admin/operator/OperatorPastProductsConsole.tsx"),
    source("src/app/api/admin/operator/auctions/[id]/resolve/route.ts"),
  ]);

  assert.match(pastRoute, /auction_purchase_offers/);
  assert.match(pastRoute, /winnerState/);
  assert.match(
    pastRoute,
    /"awaiting_payment"\s*\|\s*"completed"\s*\|\s*"none"\s*\|\s*"unpaid_expired"/,
  );
  assert.match(pastConsole, /winnerStateBadge/);
  assert.match(pastConsole, /미결제 만료/);
  assert.match(pastConsole, /결제 진행 중/);
  assert.doesNotMatch(pastConsole, /<OperatorUnpaidRecoveryButtons/);
  assert.match(pastConsole, /<OperatorSecondChanceButton/);
  assert.doesNotMatch(pastConsole, /paymentMode|portone/i);
  assert.match(resolveRoute, /body\?\.action === "relist"/);
  assert.match(resolveRoute, /body\?\.action === "archive"/);
  assert.match(resolveRoute, /body\?\.action === "delete"/);
  assert.doesNotMatch(resolveRoute, /convert_fixed|reauction/);
});

test("registration form states that bid increments are per-product", async () => {
  const consoleSource = await source(
    "src/components/admin/operator/OperatorProductsConsole.tsx",
  );

  assert.match(consoleSource, /최소 입찰 단위 \(원\)/);
  assert.match(
    consoleSource,
    /기본값은 1,000원이며 입력칸에서 상품별로 자유롭게 수정할 수\s*있습니다/,
  );
  assert.doesNotMatch(consoleSource, /입찰 최소 단위는 1,000원으로 자동 적용됩니다/);
});
