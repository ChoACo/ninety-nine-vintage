import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("mobile shopping navigation stays buyer-first and exposes work mode separately", async () => {
  const [navigation, bottomNav, header, chatLink, account, settings] =
    await Promise.all([
      source("src/lib/admin/mobileNavigation.ts"),
      source("src/components/mobile/MobileSiteBottomNav.tsx"),
      source("src/components/mobile/MobileSiteHeader.tsx"),
      source("src/components/features/chat/ChatNotificationProvider.tsx"),
      source("src/app/(mobile)/m/account/page.tsx"),
      source("src/components/settings/SiteSettingsPage.tsx"),
    ]);

  assert.match(
    navigation,
    /roleCode === "operator"[\s\S]*centerHref: "\/admin\/operator"[\s\S]*chatHref: "\/admin\/operator\/chat"/,
  );
  assert.match(
    navigation,
    /roleCode === "employee"[\s\S]*centerHref: "\/admin\/employee"[\s\S]*chatHref: "\/admin\/employee\/inquiries"/,
  );
  assert.doesNotMatch(bottomNav, /roleNavigation|access\.roleCode/);
  for (const destination of ["/m/home", "/m/live", "/m/shop", "/m/account/storage", "/m/account"]) {
    assert.match(bottomNav, new RegExp(destination.replaceAll("/", "\\/")));
  }
  assert.match(header, /fallbackHref="\/m\/chat"/);
  assert.match(header, /allowedHrefPrefix="\/m\/chat"/);
  assert.match(header, /\[\["업무", roleNavigation\.centerHref\]/);
  assert.match(header, /\["설정", "\/m\/settings"\]/);
  assert.match(chatLink, /allowedHrefPrefix/);
  assert.doesNotMatch(account, /\["설정"/);
  assert.match(settings, /사이트 설정/);
  assert.match(settings, /MobilePwaControls detailed/);
});

test("successful bids close the mobile quick-bid sheet and immediately refresh active-bid navigation", async () => {
  const [events, panel, mobileSheet, summary, quickBid] = await Promise.all([
    source("src/lib/auction/bidEvents.ts"),
    source(
      "src/components/features/auction/detail/AuctionBidRoutePanel.tsx",
    ),
    source("src/components/mobile/MobileBidSheet.tsx"),
    source("src/components/features/auction/AuctionBidSummary.tsx"),
    source("src/components/features/auction/ActiveBidProducts.tsx"),
  ]);

  assert.match(events, /ninety-nine:auction-bid-succeeded/);
  assert.match(panel, /announceAuctionBidSucceeded\(productId\)/);
  assert.match(
    mobileSheet,
    /AUCTION_BID_SUCCEEDED_EVENT[\s\S]*detail\?\.productId === productId[\s\S]*close\(\)/,
  );
  assert.match(
    summary,
    /addEventListener\(AUCTION_BID_SUCCEEDED_EVENT, refresh\)/,
  );
  assert.match(
    quickBid,
    /announceAuctionBidSucceeded\(confirmItem\.productId\)/,
  );
});

test("owner nickname overrides are validated, audited, and cancel pending approval requests", async () => {
  const migration = await source(
    "supabase/migrations/20260725083806_owner_direct_nickname_override.sql",
  );
  const [route, consoleSource, databaseTypes] = await Promise.all([
    source("src/app/api/admin/owner/members/route.ts"),
    source("src/components/admin/owner/OwnerMembersConsole.tsx"),
    source("src/lib/supabase/database.types.ts"),
  ]);

  assert.match(
    migration,
    /function public\.owner_set_account_nickname[\s\S]*security definer[\s\S]*set search_path = ''/i,
  );
  assert.match(migration, /not public\.is_owner\(\)/i);
  assert.match(migration, /public\.assert_valid_member_nickname/);
  assert.match(
    migration,
    /v_role not in \('operator', 'employee', 'band_member', 'member'\)/,
  );
  assert.match(
    migration,
    /update public\.nickname_change_requests[\s\S]*status = 'cancelled'/,
  );
  assert.match(migration, /nickname\.owner_override/);
  assert.match(
    migration,
    /revoke all on function public\.owner_set_account_nickname[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(route, /action === "nickname"/);
  assert.match(route, /"owner_set_account_nickname"/);
  assert.match(consoleSource, /승인 없이 닉네임 변경/);
  assert.match(consoleSource, /kind: "nickname"/);
  assert.match(databaseTypes, /owner_set_account_nickname/);
});
