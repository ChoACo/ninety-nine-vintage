import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("the immutable owner can rehearse an existing operator or employee authorization for three minutes", async () => {
  const [migration, state, staffAuth, ownerAuth, sessionRoute, memberModeRoute, storeScopeRoute] =
    await Promise.all([
      source("supabase/migrations/20260811122000_owner_role_canary_sessions.sql"),
      source("src/lib/ownerRoleCanary.server.ts"),
      source("src/lib/commerce/server.ts"),
      source("src/lib/ownerAccess/server.ts"),
      source("src/app/api/admin/session/route.ts"),
      source("src/app/api/owner/member-mode/route.ts"),
      source("src/app/api/admin/operator/store-scope/route.ts"),
    ]);

  assert.match(migration, /owner_id = '30be08c2-6259-42c6-af26-4ded6362de12'/);
  assert.match(migration, /target_role in \('operator', 'employee'\)/);
  assert.match(migration, /expires_at <= activated_at \+ interval '3 minutes'/);
  assert.match(migration, /grant select, insert, update on public\.owner_role_canary_sessions to service_role/);
  assert.match(migration, /revoke all on public\.owner_role_canary_sessions from public, anon, authenticated/);
  assert.match(migration, /owner_role_canary_audit_append_only/);
  assert.match(migration, /public\.current_authorization_principal\(\)/);
  assert.match(migration, /membership\.user_id = public\.current_authorization_principal\(\)/);
  assert.match(migration, /membership\.user_id = v_principal_id/);
  assert.match(migration, /update public\.owner_member_mode_sessions[\s\S]*ended_at = v_now/);

  assert.match(state, /target_user_id,target_role,ended_at,expires_at/);
  assert.match(state, /new Date\(expiresAt\)\.getTime\(\) > serverNow\.getTime\(\)/);
  assert.match(staffAuth, /getOwnerRoleCanaryState/);
  assert.match(staffAuth, /roleCanary\?\.targetUserId \?\? auth\.userId/);
  assert.match(ownerAuth, /role_canary_active/);
  assert.match(sessionRoute, /roleCanaryActive/);
  assert.match(memberModeRoute, /end_owner_role_canary/);
  assert.match(storeScopeRoute, /scopedOperatorId = auth\.effectiveOperatorId \?\? auth\.userId/);
  assert.match(storeScopeRoute, /auth\.admin[\s\S]*eq\("user_id", scopedOperatorId\)/);
});
