import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260811121000_make_product_pause_persistent.sql",
  import.meta.url,
);

test("operator pause survives scheduled publication until explicit publish", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /add column if not exists paused_at timestamptz/i);
  assert.match(
    migration,
    /function public\.pause_managed_product[\s\S]*status = 'pending'[\s\S]*paused_at = clock_timestamp\(\)/i,
  );
  assert.match(
    migration,
    /function public\.publish_pending_products_now[\s\S]*paused_at = null/i,
  );
  assert.match(
    migration,
    /status = 'pending'[\s\S]*paused_at is null[\s\S]*publish_at <= now\(\)/i,
  );
});

