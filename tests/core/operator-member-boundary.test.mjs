import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator member API is read-only and exposes no global enforcement calls", async () => {
  const [route, consoleSource] = await Promise.all([
    source("src/app/api/admin/operator/members/route.ts"),
    source("src/components/admin/operator/OperatorMembersConsole.tsx"),
  ]);
  const patchHandler = route.slice(route.indexOf("export async function PATCH"));

  assert.match(patchHandler, /operator_member_mutation_forbidden/);
  assert.doesNotMatch(patchHandler, /set_member_access_role|add_member_warning|manage_member_sanction/);
  assert.doesNotMatch(consoleSource, /제재 추가|경고 추가|역할을 변경|sanction_|action:\s*["']role/);
  assert.match(consoleSource, /거래 지원용 최소 정보/);
});

test("database keeps global role warning and sanction RPCs owner-only", async () => {
  const sql = await source(
    "supabase/migrations/20260809155707_restrict_operator_member_and_inventory_scope.sql",
  );

  for (const functionName of ["set_member_access_role", "add_member_warning", "manage_member_sanction"]) {
    const body = sql.match(new RegExp(
      `create function public\\.${functionName}[\\s\\S]*?\\n\\$\\$;`,
      "i",
    ))?.[0] ?? "";
    assert.match(body, /if not public\.is_owner\(\)/i);
  }
});

test("operator member and inventory reads require a store relationship", async () => {
  const sql = await source(
    "supabase/migrations/20260809155707_restrict_operator_member_and_inventory_scope.sql",
  );

  const directory = sql.match(/create or replace function public\.get_operator_member_directory[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  assert.match(directory, /from public\.store_memberships membership/i);
  assert.match(directory, /customer_inventory_items inventory/i);
  assert.match(directory, /commerce_order_items order_items/i);
  assert.match(directory, /support_conversations conversations/i);
  assert.doesNotMatch(directory, /member_warnings|member_bid_sanctions/);

  for (const functionName of [
    "get_operator_member_storage",
    "get_inventory_exception_queue",
    "get_inventory_exception_candidates",
  ]) {
    const body = sql.match(new RegExp(
      `create or replace function public\\.${functionName}[\\s\\S]*?\\n\\$\\$;`,
      "i",
    ))?.[0] ?? "";
    assert.match(body, /has_exact_store_or_group_permission/i);
    assert.doesNotMatch(body, /can_view_shared_fulfillment|has_business_permission|public\.is_owner/i);
  }
});
