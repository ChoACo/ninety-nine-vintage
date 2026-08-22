import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator sidebar count requests wait for and send the Supabase bearer session", async () => {
  const [pendingBadge, inquiryBadge] = await Promise.all([
    source("src/components/admin/operator/OperatorPendingBadge.tsx"),
    source("src/components/admin/operator/OperatorInquiryBadge.tsx"),
  ]);

  for (const component of [pendingBadge, inquiryBadge]) {
    assert.match(component, /getSupabaseBrowserClient\(\)\.auth\.getSession\(\)/);
    assert.match(component, /if \(!session\?\.access_token\)/);
    assert.match(component, /Authorization: `Bearer \$\{session\.access_token\}`/);
  }
});
