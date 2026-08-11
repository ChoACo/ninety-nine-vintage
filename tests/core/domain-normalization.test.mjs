import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const canonicalOrigin = "https://www.ninety-nine-vintage.store";

test("the public domain and deployment have one canonical origin", async () => {
  const [layout, sitemap, robots, readme, middleware, vercel] = await Promise.all([
    readFile(new URL("src/app/layout.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/sitemap.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/robots.ts", rootUrl), "utf8"),
    readFile(new URL("README.md", rootUrl), "utf8"),
    readFile(new URL("src/proxy.ts", rootUrl), "utf8"),
    readFile(new URL("vercel.json", rootUrl), "utf8"),
  ]);

  assert.match(layout, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(sitemap, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(robots, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(readme, /canonical 런타임·배포: Vercel Production \+ Next\.js/);
  assert.match(readme, /Cloudflare\/OpenNext 배포물은 과거 호환 자료/);
  assert.match(vercel, /"framework": "nextjs"/);
  assert.match(vercel, /"installCommand": "npm install"/);
  assert.match(vercel, /"buildCommand": "npm run build"/);
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
