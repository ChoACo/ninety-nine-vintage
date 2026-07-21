import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  const raw = match[2].trim();
  try {
    process.env[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'(.*)'$/, "$1");
  } catch {
    process.env[match[1]] = raw;
  }
}

const results = [];
const publicOnly = process.argv.includes("--public-only");

function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

function required(name, alternatives = []) {
  const selected = [name, ...alternatives].find(
    (candidate) => process.env[candidate]?.trim(),
  );
  record(`env:${name}`, Boolean(selected), selected ? "configured" : "missing");
  return selected ? process.env[selected].trim() : "";
}

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL", ["SUPABASE_URL"]);
const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]);
const serviceKey = publicOnly
  ? ""
  : required("SUPABASE_SECRET_KEY", ["SUPABASE_SERVICE_ROLE_KEY"]);
const kakaoClientId = publicOnly ? "" : required("KAKAO_REST_API_KEY");
if (!publicOnly) required("KAKAO_CLIENT_SECRET");
const kakaoRedirectUri = publicOnly ? "" : required("KAKAO_OIDC_REDIRECT_URI");
const portOneSecret = publicOnly ? "" : required("PORTONE_API_SECRET");
if (!publicOnly) required("PORTONE_WEBHOOK_SECRET");
const portOneStoreId = publicOnly
  ? ""
  : required("PORTONE_STORE_ID", ["VITE_PORTONE_STORE_ID"]);
const portOneChannelKey = publicOnly ? "" : required("VITE_PORTONE_CHANNEL_KEY");
const portOneChannelMode = publicOnly ? "" : required("PORTONE_CHANNEL_MODE");
if (!publicOnly) {
  record(
    "portone:public-identifiers",
    portOneStoreId.startsWith("store-") && portOneChannelKey.startsWith("channel-key-"),
    "format checked",
  );
  record(
    "portone:channel-mode",
    portOneChannelMode === "TEST" || portOneChannelMode === "LIVE",
    "must be explicitly TEST or LIVE",
  );
}

async function checkRest(name, path, init = {}) {
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        apikey: serviceKey || publishableKey,
        Authorization: `Bearer ${serviceKey || publishableKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    record(name, response.ok, `HTTP ${response.status}`);
  } catch (error) {
    record(name, false, error instanceof Error ? error.name : "request failed");
  }
}

if (supabaseUrl && (serviceKey || publishableKey)) {
  await checkRest("supabase:products", "/rest/v1/products?select=id&limit=1");
  await checkRest("supabase:stores", "/rest/v1/stores?select=id&limit=1");
  await checkRest(
    "supabase:commerce-orders",
    "/rest/v1/commerce_orders?select=id&limit=1",
  );
  if (!publicOnly) {
    await checkRest(
      "supabase:commerce-payment-schema",
      "/rest/v1/payment_orders?select=id,commerce_order_id&limit=1",
    );
    await checkRest(
      "supabase:commerce-order-items-schema",
      "/rest/v1/commerce_order_items?select=order_id,product_id&limit=1",
    );
    await checkRest("supabase:site-status", "/rest/v1/site_status?select=status&limit=1");
  }
  await checkRest("supabase:auction-clock-rpc", "/rest/v1/rpc/get_auction_server_time", {
    method: "POST",
    body: "{}",
  });
  if (!publicOnly) {
    await checkRest(
      "supabase:payment-mode-rpc",
      "/rest/v1/rpc/get_payment_runtime_mode_for_service",
      { method: "POST", body: "{}" },
    );
    await checkRest(
      "supabase:manual-transfer-account-rpc",
      "/rest/v1/rpc/get_manual_transfer_account_for_service",
      { method: "POST", body: "{}" },
    );
  }
}

if (supabaseUrl && publishableKey) {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const realtimeResult = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, detail: "timeout" }), 12_000);
    const channel = client
      .channel(`integration-health-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "auction_bids" },
        () => {},
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          void client.removeChannel(channel);
          resolve({ ok: true, detail: "subscribed" });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          void client.removeChannel(channel);
          resolve({ ok: false, detail: status.toLowerCase() });
        }
      });
  });
  record("supabase:realtime-auction-bids", realtimeResult.ok, realtimeResult.detail);
  client.realtime.disconnect();
}

if (portOneSecret) {
  try {
    const response = await fetch(
      `https://api.portone.io/payments/integration-health-${Date.now()}`,
      {
        headers: { Authorization: `PortOne ${portOneSecret}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const accepted = response.status !== 401 && response.status !== 403;
    record("portone:api-credential", accepted, `HTTP ${response.status}`);
  } catch (error) {
    record(
      "portone:api-credential",
      false,
      error instanceof Error ? error.name : "request failed",
    );
  }
}

if (kakaoClientId && kakaoRedirectUri) {
  try {
    const authorizeUrl = new URL("https://kauth.kakao.com/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", kakaoClientId);
    authorizeUrl.searchParams.set("redirect_uri", kakaoRedirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("state", crypto.randomUUID());
    authorizeUrl.searchParams.set("nonce", crypto.randomUUID());
    const response = await fetch(authorizeUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    record("kakao:authorize-endpoint", response.status < 400, `HTTP ${response.status}`);
  } catch (error) {
    record(
      "kakao:authorize-endpoint",
      false,
      error instanceof Error ? error.name : "request failed",
    );
  }
}

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name} (${result.detail})`);
}

process.exit(results.some((result) => !result.ok) ? 1 : 0);
