import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

async function missing(path) {
  await assert.rejects(access(new URL(path, rootUrl)));
}

test("external payment execution is absent while legacy records are immutable", async () => {
  await Promise.all([
    missing("src/lib/portone/server.ts"),
    missing("src/lib/portone/payment.ts"),
    missing("src/app/api/payments/prepare/route.ts"),
    missing("src/app/api/payments/sync/route.ts"),
    missing("src/app/api/webhook/portone/route.ts"),
    missing("src/app/(shop)/payment/complete/page.tsx"),
    missing("src/app/(mobile)/m/payment/complete/page.tsx"),
  ]);

  const [manifest, checkout, migration, history] = await Promise.all([
    readFile(new URL("package.json", rootUrl), "utf8"),
    readFile(new URL("src/app/api/orders/checkout/route.ts", rootUrl), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/20260809163725_retire_portone_execution.sql",
        rootUrl,
      ),
      "utf8",
    ),
    readFile(new URL("src/app/api/orders/route.ts", rootUrl), "utf8"),
  ]);

  assert.doesNotMatch(manifest, /@portone\//);
  assert.doesNotMatch(checkout, /portone|payment_orders/i);
  assert.match(checkout, /create_commerce_manual_transfer_checkout/);
  assert.match(migration, /active_mode\s*=\s*'manual_transfer'/i);
  assert.match(migration, /drop function if exists public\.prepare_portone_payment/i);
  assert.match(migration, /drop function if exists public\.get_payment_runtime_mode_for_service/i);
  assert.match(migration, /payment_orders_legacy_provider_history_immutable/i);
  assert.match(migration, /payment_attempts_legacy_provider_history_immutable/i);
  assert.match(migration, /revoke insert, update, delete[\s\S]*payment_orders/i);
  assert.match(history, /legacyPaymentHistory/);
  assert.doesNotMatch(history, /canResume|virtualAccount|requestedMethod/);
});
