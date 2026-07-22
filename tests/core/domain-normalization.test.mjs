import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const canonicalOrigin = "https://www.ninety-nine-vintage.store";

test("the public domain has one canonical www origin", async () => {
  const [layout, sitemap, robots, readme] = await Promise.all([
    readFile(new URL("src/app/layout.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/sitemap.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/robots.ts", rootUrl), "utf8"),
    readFile(new URL("README.md", rootUrl), "utf8"),
  ]);

  assert.match(layout, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(sitemap, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(robots, new RegExp(canonicalOrigin.replaceAll(".", "\\.")));
  assert.match(readme, /Runtime: Next\.js App Router on OpenAI Sites/);
  assert.doesNotMatch(readme, /Runtime: Next\.js App Router on Vercel/);
});
