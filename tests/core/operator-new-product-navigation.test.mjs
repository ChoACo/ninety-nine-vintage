import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const [layout, contextBar, newPage, legacyPage, workspace] = await Promise.all([
  read("src/app/(admin)/admin/operator/layout.tsx"),
  read("src/components/admin/operator/OperatorContextBar.tsx"),
  read("src/app/(admin)/admin/operator/products/new/page.tsx"),
  read("src/app/(admin)/admin/operator/products/registration/page.tsx"),
  read("src/components/admin/AdminWorkspaceShell.tsx"),
]);

test("new product is a distinct exact sidebar route with the active amber treatment", () => {
  assert.match(layout, /exact:\s*true,\s*href:\s*"\/admin\/operator\/products"/);
  assert.match(layout, /exact:\s*true,\s*href:\s*"\/admin\/operator\/products\/new"/);
  assert.match(workspace, /border-amber-500\/50 bg-zinc-800 text-zinc-50/);
  assert.match(newPage, /<OperatorProductsConsole view="registration"\s*\/>/);
  assert.match(legacyPage, /redirect\("\/admin\/operator\/products\/new"\)/);
});

test("operator header and every quick action use the canonical new-product route", () => {
  assert.match(contextBar, /path:\s*"\/admin\/operator\/products\/new"[\s\S]*title:\s*"새 상품 등록"[\s\S]*breadcrumb:\s*\["운영자 센터",\s*"상품 관리",\s*"새 상품 등록"\]/);
  assert.match(contextBar, /href="\/admin\/operator\/products\/new"/);
  assert.doesNotMatch(contextBar, /products\/registration/);
  assert.match(contextBar, /aria-label="현재 위치"/);
});
