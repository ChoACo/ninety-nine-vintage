import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("rate limit module guards bid and cart with sliding window and fail-open", async () => {
  const moduleSource = await source("src/lib/ratelimit/server.ts");

  assert.match(moduleSource, /import \{ Ratelimit \} from "@upstash\/ratelimit"/);
  assert.match(moduleSource, /import \{ Redis \} from "@upstash\/redis"/);
  assert.match(moduleSource, /Ratelimit\.slidingWindow\(2, "5 s"\)/);
  assert.match(moduleSource, /const bidLimiter = buildRatelimit\("ratelimit:auction-bids"\)/);
  assert.match(moduleSource, /const cartLimiter = buildRatelimit\("ratelimit:cart"\)/);
  assert.match(moduleSource, /RATE_LIMIT_MESSAGE = "요청이 너무 많습니다\. 잠시 후 시도해주세요\."/);
  assert.match(moduleSource, /status: 429/);
  assert.match(moduleSource, /Retry-After/);
  assert.match(moduleSource, /catch \{\s*\/\/ Redis 장애가 실시간 경매를 마비시키면 안 되므로 통과시킨다\.\s*return \{ ok: true \};/);
});

test("bid and cart routes enforce rate limiting before the database call", async () => {
  const [bidRoute, cartRoute] = await Promise.all([
    source("src/app/api/auction/bids/route.ts"),
    source("src/app/api/cart/route.ts"),
  ]);

  assert.match(bidRoute, /enforceBidRateLimit\(request\)/);
  assert.match(bidRoute, /if \(!rateLimit\.ok\) return rateLimit\.response;/);
  assert.match(cartRoute, /enforceCartRateLimit\(request, auth\.userId\)/);
  assert.match(cartRoute, /if \(!rateLimit\.ok\) return rateLimit\.response;/);
});

test("middleware only calls the IP-block RPC for API paths", async () => {
  const middleware = await source("src/middleware.ts");

  assert.match(
    middleware,
    /if \(request\.nextUrl\.pathname\.startsWith\("\/api\/"\)\) \{[\s\S]*isBlockedIp\(ipAddress\)[\s\S]*blockedResponse\(request\)/,
  );
  assert.match(
    middleware,
    /canonicalHostRedirect[\s\S]*mobileSiteRedirect/,
  );
  assert.doesNotMatch(
    middleware,
    /^[\s\S]*NextResponse\.next\(\);\r?\n\s+const ipAddress = getTrustedClientIp\(request\);/,
  );
});
