import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const canonicalOrigin = "https://www.ninety-nine-vintage.store";

test("the public domain has one canonical www origin", async () => {
  const [layout, sitemap, robots, readme, middleware] = await Promise.all([
    readFile(new URL("src/app/layout.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/sitemap.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/robots.ts", rootUrl), "utf8"),
    readFile(new URL("README.md", rootUrl), "utf8"),
    readFile(new URL("src/middleware.ts", rootUrl), "utf8"),
  ]);

  assert.match(layout, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(sitemap, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(robots, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(readme, /런타임: Cloudflare Workers \+ OpenNext/);
  assert.doesNotMatch(readme, /Runtime: Next\.js App Router on Vercel/);
  assert.match(middleware, /const APEX_HOST = "ninety-nine-vintage\.store"/);
  assert.match(
    middleware,
    /const CANONICAL_HOST = "www\.ninety-nine-vintage\.store"/,
  );
  assert.match(
    middleware,
    /destination\.hostname = CANONICAL_HOST[\s\S]*NextResponse\.redirect\(destination, 308\)/,
  );
});
