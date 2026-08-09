import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("storage routing is Supabase then R2 then disabled Google Drive and fails closed", async () => {
  const [migration, router, factory, drive, r2, cron, vercel, schedule] = await Promise.all([
    source("supabase/migrations/20260809181917_enforce_fail_closed_storage_routing.sql"),
    source("src/lib/multicloud/MultiProviderRouter.ts"),
    source("src/lib/multicloud/factory.ts"),
    source("src/lib/multicloud/googleDrive.ts"),
    source("src/lib/multicloud/r2.ts"),
    source("src/app/api/cron/storage-policy/route.ts"),
    source("vercel.json"),
    source("supabase/migrations/20260810100000_schedule_storage_policy_probe.sql"),
  ]);
  assert.match(migration, /values\('supabase',1,true/i);
  assert.match(migration, /\('r2',2,false/i);
  assert.match(migration, /\('google_drive',3,false/i);
  assert.match(migration, /restore_threshold numeric not null default 0\.4/i);
  assert.match(migration, /safe_threshold numeric not null default 0\.9/i);
  assert.match(router, /if \(!activeUsage\.verified\) return active\.upload\(input\)/);
  assert.match(router, /nextUsage\.verified/);
  assert.doesNotMatch(router, /storageCircuit|storageCursor/);
  assert.match(factory, /R2_CANARY_VERIFIED_AT/);
  assert.match(factory, /R2_ROLLBACK_VERIFIED_AT/);
  assert.match(factory, /CLOUDFLARE_API_TOKEN/);
  assert.match(r2, /r2StorageAdaptiveGroups/);
  assert.match(r2, /payloadSize metadataSize/);
  assert.match(factory, /GOOGLE_DRIVE_STORAGE_ENABLED === "true"/);
  assert.match(factory, /adapters\.some\(\(adapter\) => adapter\.id === "r2"\)/);
  assert.match(drive, /3 \* 1024 \*\* 4/);
  assert.match(drive, /google_drive_credentials_expired/);
  assert.match(migration, /set_storage_active_provider/);
  assert.match(migration, /storage_routing_events/);
  assert.match(cron, /update_storage_provider_runtime_state/);
  assert.match(cron, /set_storage_active_provider/);
  assert.doesNotMatch(vercel, /api\/cron\/storage-policy/);
  assert.match(schedule, /17 \*\/6 \* \* \*/);
});

test("object byte usage is exact, old unknown rows block rollover, and cleanup stays object first", async () => {
  const [migration, contracts, product, cleanup] = await Promise.all([
    source("supabase/migrations/20260809181917_enforce_fail_closed_storage_routing.sql"),
    source("src/lib/multicloud/contracts.ts"),
    source("src/lib/multicloud/ProductService.ts"),
    source("src/lib/multicloud/cleanup.ts"),
  ]);
  assert.match(migration, /add column object_size_bytes bigint/i);
  assert.match(migration, /records\.object_size_bytes is null/i);
  assert.match(contracts, /sizeBytes: number/);
  assert.match(contracts, /verified: boolean/);
  assert.match(product, /sizeBytes: stored\.sizeBytes/);
  assert.ok(cleanup.indexOf("await storage.delete") < cleanup.indexOf("await deleteLocator"));
});
