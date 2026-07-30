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
  assert.match(controls, /state\.installActionLabel/);
  assert.match(provider, /beforeinstallprompt/);
  assert.match(provider, /Chrome에서 열고 설치/);
  assert.match(provider, /buildAndroidChromeIntent\(window\.location\.href\)/);
  assert.match(provider, /buildIosChromeUrl\(window\.location\.href\)/);
  assert.match(controls, /Chrome 설치 페이지 열기/);
  assert.match(provider, /install_required/);
  assert.match(provider, /getWebPushClientMode/);
  assert.match(controls, /Android Chrome에서는 앱을 설치하지 않아도/);
  assert.match(controls, /iPhone·iPad는 Safari 공유 메뉴/);
  assert.match(controls, /알림 받지 않는 중/);
  assert.match(controls, /알림 끄기/);
  assert.match(controls, /알림 켜기/);
  assert.match(controls, /시험 알림 보내기/);
  assert.match(provider, /syncExistingWebPush[\s\S]*enableWebPush/);
  assert.match(controls, /NOTIFICATION_CATEGORY_OPTIONS/);
  assert.match(mobileLayout, /MobilePwaProvider/);
});

test("service worker always shows mobile OS push and handles notification clicks", async () => {
  const [worker, consent, cacheConsent] = await Promise.all([
    source("public/sw.js"),
    source("src/components/layout/CacheConsentBanner.tsx"),
    source("src/lib/cacheConsent.ts"),
  ]);

  assert.match(worker, /ENABLE_PUBLIC_CACHE/);
  assert.match(worker, /CACHE_CONSENT_NAME/);
  assert.match(worker, /MAX_PUBLIC_CACHE_ENTRIES = 160/);
  assert.match(worker, /deletePublicCaches/);
  assert.match(worker, /trimPublicCache/);
  assert.match(cacheConsent, /CACHE_CONSENT_COOKIE/);
  assert.match(cacheConsent, /writeCookieConsent\(value\)/);
  assert.match(consent, /setConsent\("accepted"\)/);
  assert.match(consent, /setConsent\("declined"\)/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /vibrate:\s*\[200,\s*100,\s*200\]/);
  assert.match(worker, /timestamp:\s*Date\.now\(\)/);
  assert.doesNotMatch(worker, /visibilityState === "visible"/);
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
  assert.match(route, /clientMode === "standalone" \|\| body\.clientMode === "browser"/);
  assert.match(route, /delivery_mode:\s*subscription\.clientMode/);
  assert.match(client, /getWebPushClientMode/);
  assert.match(client, /return isIosMobile\(\) \? null : "browser"/);
  assert.match(client, /clientMode,/);
  assert.match(client, /showTestWebPushNotification/);
  assert.match(client, /disableWebPush/);
  assert.match(client, /subscription\.unsubscribe/);
  assert.match(authStatus, /await disableWebPush\(session\.access_token\)/);
});

test("notification consent is stored per user and all categories default enabled", async () => {
  const [migration, deliveryMigration, preferences, route, provider, rootLayout] =
    await Promise.all([
      source(
        "supabase/migrations/20260724231529_notification_delivery_preferences.sql",
      ),
      source(
        "supabase/migrations/20260725125706_member_experience_preferences.sql",
      ),
      source("src/lib/notifications/preferences.ts"),
      source("src/app/api/notifications/preferences/route.ts"),
      source(
        "src/components/features/notifications/NotificationExperienceProvider.tsx",
      ),
      source("src/app/layout.tsx"),
    ]);

  assert.match(migration, /create table public\.notification_preferences/i);
  assert.match(migration, /consent_state text not null default 'pending'/i);
  assert.match(migration, /auction_enabled boolean not null default true/i);
  assert.match(migration, /chat_enabled boolean not null default true/i);
  assert.match(migration, /shipment_enabled boolean not null default true/i);
  assert.match(
    migration,
    /payment_verification_enabled boolean not null default true/i,
  );
  assert.match(
    migration,
    /shipping_request_enabled boolean not null default true/i,
  );
  assert.match(migration, /force row level security/i);
  assert.match(
    deliveryMigration,
    /web_push_subscriptions_active_delivery_user_idx/i,
  );
  assert.match(deliveryMigration, /\(user_id, delivery_mode, updated_at desc\)/i);
  assert.match(
    migration,
    /update public\.web_push_subscriptions[\s\S]*where disabled_at is null/i,
  );
  assert.match(
    migration,
    /update public\.web_push_notification_outbox[\s\S]*notification_preferences_migration/i,
  );
  assert.match(migration, /alter publication supabase_realtime add table public\.notifications/i);
  assert.doesNotMatch(
    migration,
    /grant (select|insert|update|delete|all)[^;]*to anon/i,
  );
  assert.match(preferences, /DEFAULT_NOTIFICATION_PREFERENCES/);
  assert.match(preferences, /auctionEnabled:\s*true/);
  assert.match(preferences, /chatEnabled:\s*true/);
  assert.match(route, /authenticateCommerceRequest\(request,\s*true\)/);
  assert.match(provider, /첫 가입 \/ 알림 설정/);
  assert.match(provider, /Android Chrome은 모바일 상태창 알림/);
  assert.match(provider, /getWebPushClientMode\(\)/);
  assert.match(rootLayout, /NotificationExperienceProvider/);
});

test("database events target members, operators, and employees through a retryable outbox", async () => {
  const [migration, coalescingMigration, vaultMigration] = await Promise.all([
    source(
      "supabase/migrations/20260724134857_mobile_pwa_web_push_notifications.sql",
    ),
    source(
      "supabase/migrations/20260724141416_coalesce_auction_payment_push_notifications.sql",
    ),
    source(
      "supabase/migrations/20260724141701_store_web_push_runtime_secrets_in_vault.sql",
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
  assert.match(vaultMigration, /vault\.decrypted_secrets/i);
  assert.match(vaultMigration, /to service_role/i);
  assert.doesNotMatch(
    vaultMigration,
    /grant execute[^;]*to (anon|authenticated)/i,
  );
  assert.doesNotMatch(
    migration,
    /grant (select|insert|update|delete|all)[^;]*to (anon|authenticated)/i,
  );
});
