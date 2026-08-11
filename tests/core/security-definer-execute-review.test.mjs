import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260811131000_harden_internal_security_definer_execute.sql",
    import.meta.url,
  ),
  "utf8",
);

test("internal SECURITY DEFINER helpers are not client-executable", () => {
  assert.match(
    migration,
    /revoke all on function public\.cancel_member_active_bids\([\s\S]*?from public, anon, authenticated, service_role/,
  );

  const publicTriggers = [
    "anonymize_member_payment_history",
    "anonymize_member_shipping_history",
    "assign_kakao_identity_access_role",
    "assign_kakao_member_access_role",
    "ensure_member_account",
    "protect_owner_auth_update",
    "protect_owner_kakao_identity_delete",
    "protect_owner_kakao_identity_update",
    "refresh_support_conversation_summary",
    "resolve_product_inquiry_operator",
    "route_backlog_after_operator_promotion",
    "sync_access_role_to_auth_metadata",
    "sync_auth_user_profile",
    "validate_operator_account_user",
    "validate_support_assignment",
  ];

  for (const name of publicTriggers) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${name}\\(\\)[\\s\\S]*?from public, anon, authenticated, service_role`,
      ),
    );
  }

  assert.match(
    migration,
    /revoke all on function app_private\.mark_product_sale_completed_from_inventory\(\)[\s\S]*?from public, anon, authenticated, service_role/,
  );
});
