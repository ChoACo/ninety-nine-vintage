import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("global toast host is mounted in the root layout and backed by a store", async () => {
  const [toastHost, toastStore, layout] = await Promise.all([
    source("src/components/features/notifications/GlobalToastHost.tsx"),
    source("src/store/useToastStore.ts"),
    source("src/app/layout.tsx"),
  ]);

  assert.match(toastHost, /export function GlobalToastHost\(\)/);
  assert.match(toastHost, /useToastStore\(\(state\) => state\.toasts\)/);
  assert.match(toastHost, /dismissToast\(toast\.id\)/);
  assert.match(toastHost, /aria-live="assertive"/);
  assert.match(toastHost, /role="status"/);
  assert.match(toastHost, /toast\.durationMs \?\? TOAST_AUTO_DISMISS_MS/);
  assert.match(toastHost, /toast\.action && \(/);
  assert.match(toastHost, /href=\{toast\.action\.href\}/);
  assert.match(toastHost, /\{toast\.action\.label\}/);
  assert.match(toastStore, /pushToast: \(kind, text, options = \{\}\) =>/);
  assert.match(toastStore, /dismissToast: \(id\)/);
  assert.match(layout, /import \{ GlobalToastHost \}/);
  assert.match(layout, /<GlobalToastHost \/>/);
});

test("cart no longer exposes an inventory hold limit", async () => {
  const client = await source("src/lib/commerce/client.ts");
  assert.doesNotMatch(client, /CART_HOLD_LIMIT_MESSAGE/);
  assert.doesNotMatch(client, /15분/);
  assert.match(client, /reserveCartProduct/);
});

test("bid rate limit helper detects 429 and starts a three-second cooldown", async () => {
  const rateLimitClient = await source("src/lib/ratelimit/client.ts");

  assert.match(
    rateLimitClient,
    /export const BID_RATE_LIMIT_MESSAGE =\s*"입찰 요청이 너무 빠릅니다\. 잠시 후 다시 시도해주세요\."/,
  );
  assert.match(rateLimitClient, /export function retryAfterMs\(response: Response\)/);
  assert.match(rateLimitClient, /response\.headers\.get\("Retry-After"\)/);
  assert.match(rateLimitClient, /export function useBidRateLimitCooldown\(\)/);
  assert.match(rateLimitClient, /export function isRateLimitedResponse\(response: Response\)/);
  assert.match(rateLimitClient, /response\.status === 429/);
  assert.match(rateLimitClient, /RATE_LIMIT_COOLDOWN_MS = 3_000/);
  assert.match(rateLimitClient, /pushToast\("error", BID_RATE_LIMIT_MESSAGE\)/);
  assert.match(rateLimitClient, /Math\.max\(\s*RATE_LIMIT_COOLDOWN_MS,\s*durationMs \?\? RATE_LIMIT_COOLDOWN_MS,\s*\)/);
});

test("route bid panel disables submission for two to three seconds on 429", async () => {
  const panel = await source(
    "src/components/features/auction/detail/AuctionBidRoutePanel.tsx",
  );

  assert.match(
    panel,
    /useBidRateLimitCooldown[\s\S]*isRateLimitedResponse[\s\S]*BID_RATE_LIMIT_MESSAGE/,
  );
  assert.match(panel, /if \(busy \|\| isCoolingDown\) return;/);
  assert.match(panel, /if \(isRateLimitedResponse\(response\)\) \{/);
  assert.match(panel, /beginCooldown\(retryAfterMs\(response\)\)/);
  assert.match(panel, /disabled=\{busy \|\| loading \|\| !session \|\| isCoolingDown\}/);
  assert.match(panel, /\$\{cooldownSeconds\}초 후 다시 시도/);
});

test("quick bid actions surface 429 notices and lock the buttons during cooldown", async () => {
  const quickBid = await source(
    "src/components/features/auction/ActiveBidProducts.tsx",
  );

  assert.match(quickBid, /if \(isRateLimitedResponse\(response\)\) \{/);
  assert.match(quickBid, /beginCooldown\(retryAfterMs\(response\)\)/);
  assert.match(quickBid, /setNotice\(BID_RATE_LIMIT_MESSAGE\)/);
  assert.match(quickBid, /disabled=\{isCoolingDown\}/);
  assert.match(quickBid, /disabled=\{bidBusy \|\| isCoolingDown\}/);
  assert.match(quickBid, /\$\{cooldownSeconds\}초 후 다시 시도/);
});

test("bid store and sticky panel forward the friendly rate limit message", async () => {
  const [bidStore, stickyPanel] = await Promise.all([
    source("src/store/useBidStore.ts"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
  ]);

  assert.match(bidStore, /isRateLimitedResponse\(response\)/);
  assert.match(bidStore, /throw new Error\(BID_RATE_LIMIT_MESSAGE\)/);
  assert.match(
    stickyPanel,
    /await reserveCartProduct\(item\.id, session\.user\.id\)/,
  );
});
