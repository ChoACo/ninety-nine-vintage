import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260805020000_prepare_multi_operator_store_memberships.sql",
  import.meta.url,
);

const source = () => readFile(migrationPath, "utf8");

test("operator memberships allow owners across stores but one store per regular operator", async () => {
  const migration = await source();

  assert.match(
    migration,
    /create\s+or\s+replace\s+function\s+public\.enforce_single_active_operator_store[\s\S]{0,1400}roles\.role_code\s*=\s*'operator'[\s\S]{0,1400}pg_advisory_xact_lock[\s\S]{0,1400}memberships\.store_id\s*<>\s*new\.store_id/i,
  );
  assert.match(
    migration,
    /store_memberships_active_operator_store_idx[\s\S]{0,180}on\s+public\.store_memberships\s*\(store_id,\s*user_id\)/i,
  );
  assert.match(
    migration,
    /roles\.role_code\s*=\s*'owner'[\s\S]{0,100}coalesce\(roles\.grade_level,\s*99\)\s*=\s*0[\s\S]{0,500}on\s+conflict\s*\(store_id,\s*user_id\)\s+do\s+nothing/i,
  );
});

test("membership validation no longer binds every operator to the representative column", async () => {
  const migration = await source();

  assert.doesNotMatch(
    migration,
    /v_store\.operator_id\s*<>\s*new\.user_id/i,
  );
  assert.match(
    migration,
    /new\.membership_role\s*=\s*'employee'[\s\S]{0,1200}operator_memberships\.membership_role\s*=\s*'operator'[\s\S]{0,220}operator_memberships\.status\s*=\s*'active'/i,
  );
  assert.match(
    migration,
    /v_store\.operator_id\s*=\s*new\.user_id[\s\S]{0,220}대표 운영자를 먼저 변경한 뒤 운영자 소속을 해제해 주세요/i,
  );
});
