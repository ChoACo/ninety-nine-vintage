const baseUrl = (process.env.LOCAL_APP_URL || "http://localhost:3000").replace(/\/$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
  });
  return { response, text: await response.text() };
}

const entry = await read("/", { redirect: "manual" });
assert([307, 308].includes(entry.response.status), "root must redirect immediately");
assert(entry.response.headers.get("location") === "/home", "root must redirect to /home");

const home = await read("/home");
assert(home.response.ok, "/home must render");
assert(home.text.includes("BUY NOW"), "/home must expose BUY NOW");
assert(!/DEVICE CHECKING|SESSION WAITING/.test(home.text), "entry gate must stay bypassed");
assert(!/LIVE DROP COUNTDOWN|20:56|남음/.test(home.text), "live countdown must stay disabled");

const disabledEntryCompletion = await read("/api/entry/complete", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({ nextPath: "/shop?from=entry", deviceType: "desktop" }),
});
assert(disabledEntryCompletion.response.ok, "disabled entry completion must bypass its DB and cookie checks");
const disabledEntryPayload = JSON.parse(disabledEntryCompletion.text);
assert(disabledEntryPayload.disabled === true, "entry completion must report the disabled state");
assert(disabledEntryPayload.target === "/shop?from=entry", "entry completion must preserve a safe local target");

const catalog = await read("/api/products?saleType=fixed&limit=1");
assert(catalog.response.ok, "fixed-product API must be available");
const payload = JSON.parse(catalog.text);
assert(Array.isArray(payload.products) && payload.products.length > 0, "at least one fixed product is required");
const product = payload.products[0];
assert(typeof product.id === "string" && product.id, "fixed product must have an id");

const shop = await read("/shop");
assert(shop.response.ok, "/shop must render");
assert(shop.text.includes(product.title), "/shop must server-render the initial catalog");
assert(!/LIVE DROP COUNTDOWN|20:56|남음/.test(shop.text), "/shop must not render a live countdown");

const storeHref = home.text.match(/href="(\/stores\/[^"?#]+)"/)?.[1];
if (storeHref) {
  const store = await read(storeHref);
  assert(store.response.ok, "home store links must render");
  assert(!/LIVE BID|간편 입찰|STORE \/ LIVE DATABASE/.test(store.text), "store pages must not expose live-auction controls while auctions are paused");
}

const detail = await read(`/auction/${encodeURIComponent(product.id)}`);
assert(detail.response.ok, "fixed-product detail must render");
assert(detail.text.includes("장바구니") && detail.text.includes("바로 구매"), "detail must expose cart and buy-now actions");
assert(!/LIVE DROP COUNTDOWN|20:56|남음/.test(detail.text), "detail must not render a live countdown");

const cart = await read("/cart");
assert(cart.response.ok && cart.text.includes("장바구니"), "cart entry must render");

const anonymousCart = await read("/api/cart");
assert(anonymousCart.response.status === 401, "cart data must reject an anonymous request");

const anonymousCheckout = await read("/api/orders/checkout", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: "{}",
});
assert(anonymousCheckout.response.status === 401, "checkout must reject an anonymous request");

const anonymousPaymentSync = await read("/api/payments/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: "{}",
});
assert(anonymousPaymentSync.response.status === 401, "payment sync must reject an anonymous request");

const disabledAuctionBid = await read("/api/auction/bids", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({ productId: product.id, amount: 1 }),
});
assert(disabledAuctionBid.response.status === 503, "disabled auction bids must fail closed");
assert(JSON.parse(disabledAuctionBid.text).error === "auction_disabled", "disabled auction bids must return a stable error code");

const feed = await read("/feed");
assert(feed.response.ok && feed.text.includes("점검 중"), "live feed must render its maintenance state");

console.log(`PASS local happy path (${product.id})`);
