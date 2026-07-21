import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("shared bank account is owner-managed and server-read from the database", async () => {
  const [migration, route, panel, helper, envExample, integrationCheck] = await Promise.all([
    readFile(new URL("supabase/migrations/20260721130000_owner_managed_manual_transfer_account.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/owner/manual-transfer-account/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/admin/owner/OwnerManualTransferAccountPanel.tsx", rootUrl), "utf8"),
    readFile(new URL("src/lib/manualTransferConfig.ts", rootUrl), "utf8"),
    readFile(new URL(".env.example", rootUrl), "utf8"),
    readFile(new URL("scripts/verify-integrations.mjs", rootUrl), "utf8"),
  ]);

  assert.match(migration, /update_manual_transfer_settings[\s\S]*not public\.is_owner\(\)/i);
  assert.match(migration, /get_manual_transfer_account_for_service[\s\S]*auth\.role\(\) <> 'service_role'/i);
  assert.match(migration, /revoke all on function public\.sync_manual_transfer_runtime_settings/i);
  assert.match(route, /authenticateOwnerAccessRequest\(request\)/);
  assert.match(route, /update_manual_transfer_settings/);
  assert.match(route, /\^\[0-9 -\]\+\$/);
  assert.match(panel, /수동 계좌이체 설정/);
  assert.match(panel, /기존 주문은 당시 계좌 기록을 유지/);
  assert.match(helper, /get_manual_transfer_account_for_service/);
  assert.doesNotMatch(helper, /process\.env/);
  assert.doesNotMatch(envExample, /MANUAL_TRANSFER_(BANK_NAME|ACCOUNT_NUMBER|ACCOUNT_HOLDER)/);
  assert.match(integrationCheck, /get_manual_transfer_account_for_service/);
  assert.doesNotMatch(integrationCheck, /required\("MANUAL_TRANSFER_/);
});

test("only the owner dashboard exposes the account editor", async () => {
  const [dashboard, operatorConsole] = await Promise.all([
    readFile(new URL("src/components/admin/owner/OwnerDashboard.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/admin/operator/OperatorConsole.tsx", rootUrl), "utf8"),
  ]);
  assert.match(dashboard, /OwnerManualTransferAccountPanel/);
  assert.doesNotMatch(operatorConsole, /OwnerManualTransferAccountPanel|manual-transfer-account/);
});
