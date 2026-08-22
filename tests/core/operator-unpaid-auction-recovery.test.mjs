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

test("recover endpoint forwards operator mode through the user-scoped rpc", async () => {
  const route = await source(
    "src/app/api/admin/operator/auctions/[id]/recover/route.ts",
  );

  assert.match(route, /authenticateOperatorStoreRequest\(request, true\)/);
  assert.match(
    route,
    /auth\.roleCode !== "owner" && auth\.roleCode !== "operator"/,
  );
  assert.match(route, /body\?\.mode === "reauction" \|\| body\?\.mode === "fixed"/);
  assert.match(route, /verifyOperatorProductScope\(auth\.user, auth\.selectedStoreId, id\)/);
  assert.match(
    route,
    /auth\.user[\s\S]*\.rpc\("operator_recover_unpaid_auction"/,
  );
  assert.match(route, /data\?\.length === 1 \? data\[0\] : null/);
  assert.doesNotMatch(route, /auth\.admin[\s\S]*\.rpc\(/);
});

test("past console exposes one-click winner state actions", async () => {
  const [pastRoute, pastConsole, recoveryButtons] = await Promise.all([
    source("src/app/api/admin/operator/products/past/route.ts"),
    source("src/components/admin/operator/OperatorPastProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorUnpaidRecoveryButtons.tsx"),
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
  assert.match(pastConsole, /<OperatorUnpaidRecoveryButtons/);
  assert.match(pastConsole, /product\.winnerState === "unpaid_expired"/);
  assert.match(pastConsole, /<OperatorSecondChanceButton/);
  assert.doesNotMatch(pastConsole, /paymentMode|portone/i);
  assert.match(recoveryButtons, /\/recover`/);
  assert.match(recoveryButtons, /mode: "reauction"|mode \}|"reauction"/);
  assert.match(recoveryButtons, /재경매 등록/);
  assert.match(recoveryButtons, /즉시구매 전환/);
  assert.match(recoveryButtons, /<PremiumDialog/);
  assert.match(recoveryButtons, /보안 감사 로그에 기록됩니다/);
  assert.doesNotMatch(recoveryButtons, /window\.confirm/);
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
