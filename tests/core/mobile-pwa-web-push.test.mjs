import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("the install control is mobile-device gated and the manifest opens the mobile app", async () => {
  const [manifest, provider, controls, client, mobileLayout] = await Promise.all([
    source("src/app/manifest.ts"),
    source("src/components/features/pwa/MobilePwaProvider.tsx"),
    source("src/components/features/pwa/MobilePwaControls.tsx"),
    source("src/lib/webPush/client.ts"),
    source("src/components/mobile/MobileSiteLayout.tsx"),
  ]);

  assert.match(manifest, /start_url:\s*"\/m\/home"/);
  assert.match(manifest, /display:\s*"standalone"/);
  assert.match(manifest, /purpose:\s*"maskable"/);
  assert.match(client, /userAgentData\?\.mobile/);
  assert.match(client, /Android\|iPhone/);
  assert.match(controls, /if \(!state\?\.isMobile\) return null/);
  assert.match(controls, /앱 설치하기/);
  assert.match(provider, /beforeinstallprompt/);
  assert.match(mobileLayout, /MobilePwaProvider/);
});

test("service worker keeps cache consent separate from install and handles push clicks", async () => {
  const [worker, consent] = await Promise.all([
    source("public/sw.js"),
    source("src/components/layout/CacheConsentBanner.tsx"),
  ]);

  assert.match(worker, /ENABLE_PUBLIC_CACHE/);
  assert.match(worker, /CACHE_CONSENT_NAME/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /clients\.openWindow/);
  assert.doesNotMatch(consent, /\.unregister\(\)/);
});

test("push subscription endpoints are authenticated and rebound to the current user", async () => {
  const [route, client, authStatus] = await Promise.all([
    source("src/app/api/push/subscription/route.ts"),
    source("src/lib/webPush/client.ts"),
    source("src/components/layout/AuthStatus.tsx"),
  ]);

  assert.match(route, /authenticateCommerceRequest\(request,\s*true\)/);
  assert.match(route, /\.upsert\(/);
  assert.match(route, /onConflict:\s*"endpoint"/);
  assert.match(route, /\.eq\("user_id",\s*auth\.userId\)/);
  assert.match(client, /disableWebPush/);
  assert.match(client, /subscription\.unsubscribe/);
  assert.match(authStatus, /await disableWebPush\(session\.access_token\)/);
});

test("database events target members, operators, and employees through a retryable outbox", async () => {
  const [migration, coalescingMigration] = await Promise.all([
    source(
      "supabase/migrations/20260724134857_mobile_pwa_web_push_notifications.sql",
    ),
    source(
      "supabase/migrations/20260724141416_coalesce_auction_payment_push_notifications.sql",
    ),
  ]);

  assert.match(migration, /create table public\.web_push_subscriptions/i);
  assert.match(migration, /endpoint text not null unique/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /role_code in \('operator', 'employee'\)/i);
  assert.match(migration, /support_messages_notify_web_push/i);
  assert.match(migration, /products_notify_auction_winner/i);
  assert.match(migration, /inventory_shipments_notify_tracking/i);
  assert.match(migration, /commerce_shipments_notify_tracking/i);
  assert.match(migration, /payment_verification_requested/i);
  assert.match(migration, /shipping_requested/i);
  assert.match(migration, /cron\.schedule/i);
  assert.match(migration, /vault\.decrypted_secrets/i);
  assert.match(migration, /grant execute on function public\.claim_web_push_notifications/i);
  assert.match(
    coalescingMigration,
    /drop trigger if exists manual_transfer_orders_notify_insert/i,
  );
  assert.match(
    coalescingMigration,
    /after update of last_depositor_name on public\.member_accounts/i,
  );
  assert.match(
    coalescingMigration,
    /if new\.payment_context = 'auction_bundle' then/i,
  );
  assert.doesNotMatch(
    migration,
    /grant (select|insert|update|delete|all)[^;]*to (anon|authenticated)/i,
  );
});
