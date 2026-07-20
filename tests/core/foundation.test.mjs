import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("foundation retains the server integration entrypoints", async () => {
  await Promise.all([
    access(new URL("src/app/api/auth/kakao/start/route.ts", rootUrl)),
    access(new URL("src/app/api/webhook/portone/route.ts", rootUrl)),
    access(new URL("src/lib/supabase/products.ts", rootUrl)),
    access(new URL("src/lib/portone/server.ts", rootUrl)),
    access(new URL("src/core/contracts/productDraft.ts", rootUrl)),
  ]);
  assert.ok(true);
});
