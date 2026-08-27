import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("scheduled products show an exact KST deadline and reload with owner store scope", async () => {
  const [consoleSource, route] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
  ]);

  assert.match(consoleSource, /formatScheduledPublishAt/);
  assert.match(consoleSource, /timeZone:\s*"Asia\/Seoul"/);
  assert.match(consoleSource, /공개 예정 시각/);
  assert.match(consoleSource, /공개 지연/);
  assert.match(consoleSource, /storeScope\.storeId,\s*token/);
  assert.match(route, /serverNow:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(consoleSource, /Date\.parse\(payload\.serverNow/);
});

test("minute activation isolates one failed product and keeps the cron active", async () => {
  const migration = await source(
    "supabase/migrations/20260826193500_repair_scheduled_product_activation.sql",
  );

  assert.match(
    migration,
    /function app_private\.activate_due_scheduled_products[\s\S]*for v_product in[\s\S]*exception[\s\S]*when others/i,
  );
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /scheduled_product_publication_failures/i);
  assert.match(migration, /paused_at is null/i);
  assert.match(migration, /publish_at <= clock_timestamp\(\)/i);
  assert.match(migration, /jobname = 'activate-scheduled-products'/i);
  assert.match(migration, /active := true/i);
  assert.match(
    migration,
    /select app_private\.activate_due_scheduled_products\(\);/i,
  );
});

test("an exact 10:00 KST reservation stays on the selected day and repairs the shifted batch", async () => {
  const migration = await source(
    "supabase/migrations/20260826195500_fix_exact_ten_reservations_and_repair_aug27.sql",
  );

  assert.match(
    migration,
    /v_time <= time '10:00:00' then 0 else 1/i,
  );
  assert.doesNotMatch(
    migration,
    /v_time < time '10:00:00' then 0 else 1/i,
  );
  assert.match(
    migration,
    /scheduled_publication_repair_20260827_backup/i,
  );
  assert.match(
    migration,
    /publish_at = timestamptz '2026-08-28 10:00:00 Asia\/Seoul'/i,
  );
  assert.match(
    migration,
    /set publish_at = timestamptz '2026-08-27 10:00:00 Asia\/Seoul'/i,
  );
  assert.match(migration, /v_repaired_count <> v_backup_count/i);
});
