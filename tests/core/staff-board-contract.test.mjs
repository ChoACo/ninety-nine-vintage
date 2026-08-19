import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../supabase/migrations/20260817164334_create_staff_notice_communication_board.sql", import.meta.url), "utf8");
const api = await readFile(new URL("../../src/app/api/admin/staff-board/route.ts", import.meta.url), "utf8");
const operatorLayout = await readFile(new URL("../../src/app/(admin)/admin/operator/layout.tsx", import.meta.url), "utf8");
const employeeLayout = await readFile(new URL("../../src/app/(admin)/admin/employee/layout.tsx", import.meta.url), "utf8");
const ownerLayout = await readFile(new URL("../../src/app/(admin)/admin/owner/layout.tsx", import.meta.url), "utf8");

test("staff board stays staff-only and notices stay owner-authored", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.staff_board_posts from anon, authenticated/);
  assert.match(api, /authenticateStaffRequest\(request, true\)/);
  assert.match(api, /kind === "notice" && auth\.roleCode !== "owner"/);
});

test("all three administration workspaces expose the shared board", () => {
  assert.match(operatorLayout, /\/admin\/operator\/community/);
  assert.match(employeeLayout, /\/admin\/employee\/community/);
  assert.match(ownerLayout, /\/admin\/owner\/community/);
});

test("the seeded operator guide references only saved screenshots", () => {
  for (const filename of [
    "01-operator-home.png",
    "02-product-registration.png",
    "03-fulfillment.png",
    "04-orders-winners.png",
  ]) assert.match(migration, new RegExp(filename.replaceAll(".", "\\.")));
});
