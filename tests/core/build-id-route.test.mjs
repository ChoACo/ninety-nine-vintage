import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BUILD_ID exposes only the deployment commit and is never cached", async () => {
  const route = await readFile(
    new URL("../../src/app/BUILD_ID/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(route, /Content-Type": "text\/plain; charset=utf-8"/);
  assert.doesNotMatch(route, /SUPABASE|SECRET|TOKEN|PASSWORD/);
});
