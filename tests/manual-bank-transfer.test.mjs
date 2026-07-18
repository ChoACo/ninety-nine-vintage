import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);

function source(path) {
  return readFile(new URL(path, rootUrl), "utf8");
}

function functionBody(sql, name) {
  const publicStart = sql.indexOf(`function public.${name}`);
  const privateStart = sql.indexOf(`function app_private.${name}`);
  const start = publicStart === -1 ? privateStart : publicStart;
  assert.notEqual(start, -1, `${name} should exist`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} should have a complete body`);
  return sql.slice(start, end + 4);
}

test("manual transfer migration keeps one private global account and a separate ledger", async () => {
  const migration = await source(
    "supabase/migrations/20260718074000_manual_transfer_payment_mode.sql",
  );

  assert.match(migration, /create table public\.payment_runtime_settings/i);
  assert.match(migration, /singleton\s+boolean[\s\S]*primary key/i);
  assert.match(migration, /active_mode[\s\S]*manual_transfer[\s\S]*portone/i);
  assert.match(migration, /insert into public\.payment_runtime_settings/i);
  assert.match(migration, /'manual_transfer'/);
  assert.match(migration, /create table public\.manual_transfer_orders/i);
  assert.match(migration, /product_id\s+uuid\s+not null\s+unique/i);
  assert.match(migration, /awaiting_manual_transfer/);
  assert.match(migration, /bank_name_snapshot/);
  assert.match(migration, /account_number_snapshot/);
  assert.match(migration, /confirmed_at/);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all on public\.payment_runtime_settings[\s\S]*from anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on public\.manual_transfer_orders[\s\S]*from anon, authenticated/i,
  );
  assert.doesNotMatch(
    migration,
    /grant select on public\.payment_runtime_settings\s+to authenticated/i,
  );
});

test("the member ledger starts only through the account reveal RPC after server checks", async () => {
  const migration = await source(
    "supabase/migrations/20260718074000_manual_transfer_payment_mode.sql",
  );
  const begin = functionBody(migration, "begin_manual_transfer");

  assert.match(begin, /auth\.uid\(\)/);
  assert.match(begin, /public\.is_member\(\)/);
  assert.match(begin, /account_status\s*=\s*'active'/);
  assert.match(begin, /auth_user_has_kakao_identity/);
  assert.match(begin, /active_mode\s*=\s*'manual_transfer'/);
  assert.match(begin, /bank_name\s+is not null|bank_name\s*<>/i);
  assert.match(begin, /account_number\s+is not null|account_number\s*<>/i);
  assert.match(begin, /products\.status\s*<>\s*'closed'|status\s*=\s*'closed'/i);
  assert.match(begin, /auction_bids/);
  assert.match(begin, /v_winner_id\s*<>\s*v_user_id|winner.*bidder_id/i);
  assert.match(begin, /for update/i);
  assert.match(begin, /insert into public\.manual_transfer_orders/i);
  assert.match(begin, /v_order\.bank_name_snapshot/);
  assert.match(begin, /v_order\.account_number_snapshot/);
  assert.match(begin, /account_number/);
  assert.ok(
    begin.indexOf("active_mode") <
      begin.indexOf("insert into public.manual_transfer_orders"),
    "runtime/account checks must happen before a pending transfer is inserted",
  );
  assert.match(
    migration,
    /grant execute on function public\.begin_manual_transfer\(uuid\)\s+to authenticated/i,
  );
});

test("only operations staff can edit the global account or confirm an exact pending row", async () => {
  const migration = await source(
    "supabase/migrations/20260718074000_manual_transfer_payment_mode.sql",
  );
  const settings = functionBody(migration, "update_manual_transfer_settings");
  const pending = functionBody(migration, "get_pending_manual_transfers");
  const confirm = functionBody(migration, "confirm_manual_transfer");

  for (const body of [settings, pending, confirm]) {
    assert.match(body, /can_manage_members|access_role_for_user/i);
  }
  assert.match(confirm, /p_expected_updated_at/);
  assert.match(confirm, /for update/i);
  assert.match(confirm, /status\s*=\s*'confirmed'/i);
  assert.match(confirm, /confirmed_by\s*=\s*auth\.uid\(\)/i);
  assert.match(pending, /owner_hidden_test_members/);
  assert.match(pending, /public\.is_owner\(\)|access_role_for_user[\s\S]*owner/i);

  const securityCapture = migration.match(
    /create or replace function public\.[\w_]*manual[\w_]*activity[\s\S]*?\n\$\$;/i,
  )?.[0];
  if (securityCapture) {
    assert.doesNotMatch(securityCapture, /account_number|bank_name/);
  }
});

test("shipping and future PortOne restoration use one exact cross-provider settlement rule", async () => {
  const migration = await source(
    "supabase/migrations/20260718074000_manual_transfer_payment_mode.sql",
  );
  const settlement = functionBody(migration, "is_payment_settled");
  const memberShipping = functionBody(migration, "request_product_shipping");
  const ownerShipping = functionBody(
    migration,
    "owner_request_hidden_test_shipping",
  );

  assert.match(settlement, /portone_status\s*=\s*'PAID'/i);
  assert.match(settlement, /manual_transfer_orders/i);
  assert.match(settlement, /status\s*=\s*'confirmed'/i);
  assert.doesNotMatch(settlement, /PARTIAL_CANCELLED/);
  assert.match(memberShipping, /is_product_payment_settled/i);
  assert.match(ownerShipping, /is_product_payment_settled/i);
  assert.match(migration, /function app_private\.reject_portone_manual_overlap/i);
  assert.match(migration, /trigger payment_orders_reject_manual_overlap/i);
});

test("the UI reveals the account on a second explicit action and preserves dormant PortOne code", async () => {
  const [accountPage, repository, operatorPanel, adminPage, ownerPanel, ownerRoute, portoneRoutes] =
    await Promise.all([
      source("src/components/profile/AccountPage.tsx"),
      source("src/lib/supabase/manualPayments.ts"),
      source("src/components/admin/ManualBankTransferPanel.tsx"),
      source("src/components/admin/AdminPage.tsx"),
      source("src/components/owner/OwnerHiddenTestPanel.tsx"),
      source("app/api/owner/test-member/route.ts"),
      Promise.all([
        source("app/api/payments/prepare/route.ts"),
        source("app/api/payments/sync/route.ts"),
        source("app/api/webhook/portone/route.ts"),
      ]).then((parts) => parts.join("\n")),
    ]);

  assert.match(accountPage, /function ManualTransferPaymentModal/);
  assert.match(accountPage, /결제하기/);
  assert.match(accountPage, /계좌번호 보기/);
  assert.match(accountPage, /beginManualBankTransfer\(product\.productId\)/);
  assert.ok(
    accountPage.indexOf("beginManualBankTransfer(product.productId)") <
      accountPage.indexOf("계좌번호 보기"),
  );
  assert.match(accountPage, /activePaymentMode\s*===\s*"portone"/);
  assert.match(accountPage, /function PortOnePaymentModal/);
  assert.match(repository, /rpc\("begin_manual_transfer"/);
  assert.match(operatorPanel, /updateManualBankAccount/);
  assert.match(operatorPanel, /getPendingManualTransfers/);
  assert.match(operatorPanel, /입금 확정하기/);
  assert.match(adminPage, /<ManualBankTransferPanel\s*\/>/);
  assert.match(ownerPanel, /beginOwnerHiddenTestManualTransfer/);
  assert.match(ownerPanel, /active_payment_mode\s*===\s*"manual_transfer"/);
  assert.match(ownerRoute, /owner_begin_hidden_test_manual_transfer/);
  assert.match(portoneRoutes, /requirePortOneRuntimeMode/);
  assert.match(portoneRoutes, /manual_transfer_active/);
});
