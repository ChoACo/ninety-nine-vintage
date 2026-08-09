import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("store plans keep independent immediate scheduled and pending quotas", async () => {
  const migration = await source(
    "supabase/migrations/20260809175343_enforce_store_plan_publication_quotas.sql",
  );

  assert.match(migration, /then 60 else 30 end/);
  assert.match(migration, /then 80 else 40 end/);
  assert.match(migration, /then 200 else 100 end/);
  assert.match(migration, /immediate_publish_count/);
  assert.match(migration, /scheduled_publish_count/);
  assert.match(migration, /products\.status = 'pending'/);
  assert.match(migration, /products_enforce_store_publication_quota/);
  assert.match(migration, /before insert or update of status,publish_at/);
  assert.doesNotMatch(migration, /before delete on public\.products/);
});

test("premium automation is owner-linked and limited to 300 items per rolling week", async () => {
  const [migration, ownerRoute, ownerPanel, operatorPanel] = await Promise.all([
    source("supabase/migrations/20260809175343_enforce_store_plan_publication_quotas.sql"),
    source("src/app/api/admin/owner/platform/route.ts"),
    source("src/components/admin/owner/OwnerPlanApprovalPanel.tsx"),
    source("src/components/admin/operator/OperatorPlatformConsole.tsx"),
  ]);

  assert.match(migration, /automation_client_id/);
  assert.match(migration, /automation_version/);
  assert.match(migration, /created_at>=clock_timestamp\(\)-interval '7 days'/);
  assert.match(migration, /v_used\+p_item_count>300/);
  assert.match(migration, /unique \(store_id, idempotency_key\)/);
  assert.match(migration, /store_service_subscription_audits/);
  assert.match(migration, /next_billing_at/);
  assert.match(migration, /reject_owner_store_service_plan/);
  assert.match(ownerRoute, /configure_owner_store_automation/);
  assert.match(ownerPanel, /프리미엄 승인/);
  assert.match(ownerPanel, /자동화 연결/);
  assert.match(operatorPanel, /기본 3만원/);
  assert.match(operatorPanel, /프리미엄 5만원/);
  assert.match(operatorPanel, /다음 청구일 전 변경·해지/);
});
