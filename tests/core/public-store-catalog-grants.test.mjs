import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260809095020_grant_public_store_catalog_columns.sql",
  import.meta.url,
);

test("public catalog exposes only safe store columns and owner platform stays server-callable", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /revoke all on table public\.stores from anon, authenticated/i);
  assert.match(
    migration,
    /grant select \(id, name, slug\) on table public\.stores to anon, authenticated/i,
  );
  assert.doesNotMatch(migration, /grant select[^;]*operator_id/i);
  assert.doesNotMatch(migration, /grant select[^;]*business_id/i);
  assert.match(
    migration,
    /grant execute on function public\.get_owner_store_platform_management\(\)\s+to service_role/i,
  );
});
