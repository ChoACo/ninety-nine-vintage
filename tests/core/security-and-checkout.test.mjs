import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { parseSupabaseMigrationList } from "../../scripts/migration-list-parser.mjs";

const retiredProviderApi = () => {
  throw new Error("retired provider API is unavailable");
};
const createPortOnePaymentId = retiredProviderApi;
const invokePortOneProductPayment = retiredProviderApi;
const preparedPaymentAction = retiredProviderApi;

import {
  resolveKakaoPostLoginReturnTo,
  safeSameOriginReturnTo,
} from "../../src/lib/kakao/returnTo.ts";
import {
  consumeFixedPurchaseIntent,
  rememberFixedPurchaseIntent,
} from "../../src/lib/commerce/purchaseIntent.ts";
import {
  normalizeCatalogSearch,
  normalizeProductLimit,
} from "../../src/lib/catalog/query.ts";
import {
  getKakaoCookiePath,
  getKakaoFlowCookieName,
  KAKAO_ID_TOKEN_COOKIE,
  KAKAO_RETURN_TO_COOKIE,
  normalizeKakaoFlowId,
  serializeHttpOnlyCookie,
} from "../../src/lib/kakao/oidc.ts";
import { completeForOwnedKakaoSession } from "../../src/lib/kakao/callbackFlow.ts";
import {
  canCommitCommerceSnapshot,
  resolveVisibleCommerceCount,
  shouldPersistCommerceLocally,
} from "../../src/lib/commerce/cacheOwnership.ts";
import {
  paymentModeMatches,
  readCommercePaymentMode,
} from "../../src/lib/commerce/paymentMode.ts";

const origin = "https://ninety-nine.example";
const rootUrl = new URL("../../", import.meta.url);

test("browser auth rejects URL-provided Supabase sessions", async () => {
  const [client, sessionHook, clockHook, feed] = await Promise.all([
    readFile(new URL("src/lib/supabase/client.ts", rootUrl), "utf8"),
    readFile(new URL("src/hooks/useSupabaseSession.ts", rootUrl), "utf8"),
    readFile(new URL("src/hooks/useAuctionPolicyClock.ts", rootUrl), "utf8"),
    readFile(
      new URL("src/components/features/auction/AuctionFeedGrid.tsx", rootUrl),
      "utf8",
    ),
  ]);
  assert.match(client, /detectSessionInUrl:\s*false/);
  assert.doesNotMatch(client, /detectSessionInUrl:\s*true/);
  assert.match(client, /getSupabasePublicBrowserClient/);
  assert.match(client, /persistSession:\s*false/);
  assert.match(sessionHook, /auth\.getUser\(\)/);
  assert.match(sessionHook, /signOut\(\{\s*scope:\s*"local"\s*\}\)/);
  assert.match(sessionHook, /sessionDiscardFlight\?\.accessToken === rejected\.access_token/);
  assert.match(sessionHook, /current\?\.access_token === rejected\.access_token/);
  assert.match(sessionHook, /window\.setTimeout\(\(\) =>/);
  assert.match(clockHook, /getSupabasePublicBrowserClient\(\)\.rpc\("get_auction_server_time"\)/);
  assert.doesNotMatch(feed, /crypto\.randomUUID\(\)/);
  assert.match(feed, /const feedSeed = useMemo/);
});

test("the isolated browser fixture seeds both auction and fixed purchase flows", async () => {
  const [localTest, happyPath] = await Promise.all([
    readFile(new URL("scripts/local-test-supabase.mjs", rootUrl), "utf8"),
    readFile(new URL("scripts/verify-local-happy-path.mjs", rootUrl), "utf8"),
  ]);
  assert.match(localTest, /'로컬 브라우저 검증 경매'/);
  assert.match(localTest, /'로컬 브라우저 검증 즉시구매'/);
  assert.match(localTest, /12000,\s*12000,\s*12000,[\s\S]*?'fixed'/);
  assert.match(happyPath, /retired external payment sync must stay absent/);
  assert.match(happyPath, /retiredPaymentSync\.response\.status === 404/);
});

test("migration parity accepts current Supabase CLI table output", () => {
  const migrations = parseSupabaseMigrationList(`
   Local            | Remote           | Time (UTC)
  ------------------|------------------|-----------------------
   \`20260720170000\` | \`20260720170000\` | \`2026-07-20 17:00:00\`
   \`20260720180000\` | \` \`              | \`2026-07-20 18:00:00\`
  `);
  assert.deepEqual(migrations, [
    { local: "20260720170000", remote: "20260720170000" },
    { local: "20260720180000", remote: "" },
  ]);
  assert.deepEqual(
    parseSupabaseMigrationList(
      '{"migrations":[{"local":"20260720180000","remote":""}]}\nConnecting to remote database...',
    ),
    [{ local: "20260720180000", remote: "" }],
  );
});

test("the former entry gate is absent while live auctions keep their authoritative security boundary", async () => {
  const [
    flags,
    entryPage,
    shopLayout,
    middleware,
    storePage,
    storeService,
    auctionGrid,
    auctionRoute,
    auctionService,
    bidRepository,
    pauseMigration,
    resumeMigration,
    header,
    mobileNavigation,
  ] = await Promise.all([
    readFile(new URL("src/lib/featureFlags.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/layout.tsx", rootUrl), "utf8"),
    readFile(new URL("src/proxy.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/stores/[slug]/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/services/stores.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/features/auction/AuctionFeedGrid.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/api/auction/bids/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/services/auction.ts", rootUrl), "utf8"),
    readFile(new URL("src/lib/supabase/bids.ts", rootUrl), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/20260720183000_pause_live_auction_bidding.sql",
        rootUrl,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "supabase/migrations/20260721010000_resume_live_auction_bidding.sql",
        rootUrl,
      ),
      "utf8",
    ),
    readFile(new URL("src/components/layout/PcHeader.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/layout/MobileBottomNav.tsx", rootUrl), "utf8"),
  ]);

  await Promise.all([
    assert.rejects(access(new URL("src/app/api/entry/complete/route.ts", rootUrl))),
    assert.rejects(access(new URL("src/components/layout/EntryGate.tsx", rootUrl))),
    assert.rejects(access(new URL("src/lib/entryGateCookie.ts", rootUrl))),
  ]);
  assert.doesNotMatch(flags, /ENTRY_GATE_ENABLED/);
  assert.match(flags, /LIVE_AUCTION_ENABLED\s*=\s*true/);
  assert.match(entryPage, /redirect\("\/home"\)/);
  assert.doesNotMatch(shopLayout, /EntryGate|entry\/complete/);
  assert.doesNotMatch(middleware, /ENTRY_GATE_ENABLED|EntryGate|entry\/complete/);
  assert.match(storePage, /fetchStoreProducts\(store\.id,\s*"fixed",\s*selectedDate\)/);
  assert.match(storePage, /resolveStoreCatalogDate\(query\.date,\s*dates\)/);
  assert.match(storeService, /query\s*=\s*query\.eq\("sale_type",\s*saleType\)/);
  assert.match(auctionGrid, /props\.saleType\s*===\s*"auction"\s*&&\s*!LIVE_AUCTION_ENABLED/);
  for (const source of [auctionRoute, auctionService, bidRepository]) {
    assert.doesNotMatch(source, /auction_disabled/);
    assert.doesNotMatch(source, /if\s*\(!LIVE_AUCTION_ENABLED\)/);
  }
  assert.match(auctionRoute, /hasTrustedRequestOrigin\(request\)/);
  assert.match(auctionRoute, /startsWith\("Bearer "\)/);
  assert.match(auctionService, /\.rpc\("place_bid"/);
  assert.match(bidRepository, /\.rpc\("place_bid"/);
  assert.match(
    pauseMigration,
    /revoke all on function public\.place_bid\(uuid, bigint\)[\s\S]*authenticated/i,
  );
  assert.match(
    resumeMigration,
    /revoke all on function public\.place_bid\(uuid, bigint\)[\s\S]*from public, anon/i,
  );
  assert.match(
    resumeMigration,
    /grant execute on function public\.place_bid\(uuid, bigint\)[\s\S]*to authenticated/i,
  );
  for (const source of [header, mobileNavigation]) {
    assert.match(source, /"\/(?:m\/)?live"/);
  }
  assert.match(mobileNavigation, /"\/admin\/operator\/fulfillment"/);
  assert.match(mobileNavigation, /"\/admin\/employee"/);
});

test("trusted mutation origin keeps deployed hosts exact while accepting same-port local loopback aliases", async () => {
  const oidc = await readFile(new URL("src/lib/kakao/oidc.ts", rootUrl), "utf8");
  assert.match(oidc, /if \(origin === requestUrl\.origin\) return true/);
  assert.match(oidc, /new Set\(\["localhost", "127\.0\.0\.1", "\[::1\]"\]\)/);
  assert.match(oidc, /requestUrl\.protocol === "http:"[\s\S]*suppliedOrigin\.protocol === "http:"/);
  assert.match(oidc, /requestUrl\.port === suppliedOrigin\.port/);
  assert.match(oidc, /fetchSite === "cross-site"/);
});

test("Kakao returnTo accepts only same-origin application paths", () => {
  assert.equal(safeSameOriginReturnTo("/cart?from=login#checkout", origin), "/cart?from=login#checkout");
  assert.equal(safeSameOriginReturnTo("/account/login?next=%2Fhome", origin), "/account");
  assert.equal(safeSameOriginReturnTo("/auth/callback?flow=stale", origin), "/account");
  assert.equal(safeSameOriginReturnTo("/m/account/login?next=%2Fm%2Fhome", origin, "/m/account"), "/m/account");
  assert.equal(safeSameOriginReturnTo("//evil.example", origin), "/account");
  assert.equal(safeSameOriginReturnTo("/\\evil.example", origin), "/account");
  assert.equal(safeSameOriginReturnTo("/%5C%5Cevil.example", origin), "/account");
  assert.equal(safeSameOriginReturnTo("https://evil.example", origin), "/account");
  assert.equal(safeSameOriginReturnTo("/cart\nnext", origin), "/account");
  assert.equal(safeSameOriginReturnTo("/" + "a".repeat(201), origin), "/account");
  assert.equal(safeSameOriginReturnTo("/cart", "javascript:alert(1)"), "/account");
});

test("Kakao login restores the requested page and only rejects authentication routes", () => {
  assert.equal(resolveKakaoPostLoginReturnTo("/home"), "/home");
  assert.equal(resolveKakaoPostLoginReturnTo("/m/home"), "/m/home");
  assert.equal(resolveKakaoPostLoginReturnTo("/feed"), "/feed");
  assert.equal(resolveKakaoPostLoginReturnTo("/feed?category=vintage&page=2"), "/feed?category=vintage&page=2");
  assert.equal(resolveKakaoPostLoginReturnTo("/m/shop?q=%EB%B0%94%EC%8B%9C"), "/m/shop?q=%EB%B0%94%EC%8B%9C");
  assert.equal(resolveKakaoPostLoginReturnTo("/cart?from=login"), "/home");
  assert.equal(resolveKakaoPostLoginReturnTo("/account/login?next=%2Fhome"), "/home");
  assert.equal(resolveKakaoPostLoginReturnTo("/m/account"), "/m/home");
});

test("Kakao concurrent login flows use isolated scoped cookies", () => {
  const firstFlow = "a".repeat(64);
  const secondFlow = "b".repeat(64);
  assert.equal(normalizeKakaoFlowId(firstFlow.toUpperCase()), firstFlow);
  assert.equal(normalizeKakaoFlowId("../invalid"), null);

  const firstReturnCookie = getKakaoFlowCookieName(
    KAKAO_RETURN_TO_COOKIE,
    firstFlow,
  );
  const secondReturnCookie = getKakaoFlowCookieName(
    KAKAO_RETURN_TO_COOKIE,
    secondFlow,
  );
  assert.notEqual(firstReturnCookie, secondReturnCookie);
  assert.equal(getKakaoCookiePath(firstReturnCookie), "/api/auth/kakao");

  const idTokenCookie = getKakaoFlowCookieName(
    KAKAO_ID_TOKEN_COOKIE,
    firstFlow,
  );
  assert.equal(getKakaoCookiePath(idTokenCookie), "/api/auth/kakao/session");
  const serialized = serializeHttpOnlyCookie(
    "https://ninety-nine.example/api/auth/kakao/oidc",
    idTokenCookie,
    "secret-token",
    120,
  );
  assert.match(serialized, /HttpOnly/);
  assert.match(serialized, /SameSite=Lax/);
  assert.match(serialized, /Secure/);
  assert.match(serialized, /Path=\/api\/auth\/kakao\/session/);
});

test("Kakao profile failures roll back only the session created by that callback", async () => {
  const sessionA = { access_token: "token-a", user: { id: "user-a" } };
  const sessionB = { access_token: "token-b", user: { id: "user-b" } };
  let currentSession = sessionA;
  let signOutCount = 0;

  await assert.rejects(
    completeForOwnedKakaoSession({
      session: sessionA,
      complete: async () => {
        throw new Error("profile failed");
      },
      getCurrentSession: async () => currentSession,
      signOutCurrentSession: async () => {
        signOutCount += 1;
        currentSession = null;
      },
    }),
    /profile failed/,
  );
  assert.equal(signOutCount, 1);

  currentSession = sessionB;
  await assert.rejects(
    completeForOwnedKakaoSession({
      session: sessionA,
      complete: async () => "ok",
      getCurrentSession: async () => currentSession,
      signOutCurrentSession: async () => {
        signOutCount += 1;
      },
    }),
    /계정이 변경되었습니다/,
  );
  assert.equal(signOutCount, 1, "a newer account must never be signed out");

  currentSession = sessionA;
  const completed = await completeForOwnedKakaoSession({
    session: sessionA,
    complete: async (token) => token,
    getCurrentSession: async () => currentSession,
    signOutCurrentSession: async () => {
      signOutCount += 1;
    },
  });
  assert.equal(completed, "token-a");
  assert.equal(signOutCount, 1);
});

test("Kakao callback hides identity and commerce surfaces until profile validation finishes", async () => {
  const [headerSource, callbackSource] = await Promise.all([
    readFile(new URL("src/components/layout/PcHeader.tsx", rootUrl), "utf8"),
    readFile(
      new URL("src/app/(shop)/auth/callback/page.tsx", rootUrl),
      "utf8",
    ),
  ]);
  assert.match(headerSource, /pathname\s*===\s*"\/auth\/callback"/);
  assert.match(
    headerSource,
    /authenticating\s*\?\s*<span[\s\S]*?로그인 상태 확인 중[\s\S]*?:\s*session\s*\?\s*<CommerceToolbar/,
  );
  assert.doesNotMatch(callbackSource, /getMyNicknameState\(\)/);
  assert.match(callbackSource, /resolveKakaoPostLoginReturnTo/);
});

test("public shop surfaces expose shopper controls while admin links remain session-role gated", async () => {
  const [
    authStatus,
    header,
    mobileHeader,
    mobileNavigation,
    accessHook,
    adminSession,
    accountPage,
    policyPage,
    homePage,
    storePage,
storeService,
    adminLayout,
    storeExperience,
    storeTabs,
    logoutHelper,
  ] = await Promise.all([
    readFile(new URL("src/components/layout/AuthStatus.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/layout/PcHeader.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/layout/MobileHeader.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/layout/MobileBottomNav.tsx", rootUrl), "utf8"),
    readFile(new URL("src/hooks/useAdminNavigationAccess.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/session/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/account/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/layout/PolicyPage.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/home/page.tsx", rootUrl), "utf8"),
    readFile(
      new URL("src/app/(shop)/stores/[slug]/page.tsx", rootUrl),
      "utf8",
    ),
    readFile(new URL("src/services/stores.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/(admin)/admin/layout.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/catalog/StoreMallExperience.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/catalog/StoreMallTabs.tsx", rootUrl), "utf8"),
    readFile(new URL("src/lib/auth/logout.ts", rootUrl), "utf8"),
  ]);

  assert.match(authStatus, /useSupabaseSession\(\)/);
  assert.match(authStatus, /UserMenuDropdown/);
  assert.match(
    authStatus,
    /href: "\/admin\/operator", label: "업무"/,
  );
  assert.match(authStatus, /href: "\/admin\/employee", label: "업무"/);
  assert.doesNotMatch(authStatus, /aria-label="로그아웃"/);
  assert.match(logoutHelper, /window\.location\.assign\(`\$\{basePath\}\/home`\)/);
  assert.match(logoutHelper, /disableWebPush\(accessToken\)/);
  assert.match(logoutHelper, /\/api\/auth\/kakao\/logout/);
  for (const source of [authStatus, accountPage]) {
    assert.doesNotMatch(source, /\/api\/account\/session/);
  }
  for (const source of [authStatus, header, accountPage]) {
    assert.doesNotMatch(source, /href="\/(?:owner|operator)"/);
    assert.doesNotMatch(source, /AccountSessionPanel/);
  }
  assert.match(mobileHeader, /access\.roleCode === "operator"[\s\S]*?href="\/admin\/operator\/fulfillment"/);
  assert.match(mobileHeader, /access\.roleCode === "employee"[\s\S]*?href="\/admin\/employee"/);
  assert.match(mobileHeader, /access\.canAccessOwner[\s\S]*?href="\/admin\/owner"/);
  assert.match(mobileNavigation, /access\.roleCode === "operator"/);
  assert.match(mobileNavigation, /access\.roleCode === "employee"/);
  assert.match(accessHook, /useSupabaseSession\(\)/);
  assert.match(accessHook, /fetch\("\/api\/admin\/session"/);
  assert.match(accessHook, /snapshot\.userId === userId[\s\S]*snapshot\.revision === revision/);
  assert.match(adminSession, /const canAccessOperator = isOwner \|\| roleCode === "operator"/);
  assert.match(adminSession, /const canAccessEmployee = isOwner \|\| roleCode === "employee"/);
  assert.match(adminSession, /canAccessOwner: isOwner/);
  assert.match(adminLayout, /<AdminAccessBoundary>\{children\}<\/AdminAccessBoundary>/);
  assert.doesNotMatch(policyPage, /PcLayout/);
  for (const source of [homePage, storePage, storeService]) {
    assert.doesNotMatch(source, /operatorId|operator_id/);
  }
  assert.doesNotMatch(homePage, /String\(index \+ 1\)\.padStart\(2, "0"\)/);
  assert.doesNotMatch(homePage, /엄선된 숍|전체 숍 보기/);
  assert.match(storeExperience, /공식 판매 센터몰/);
  assert.match(storeTabs, /구매 후기[\s\S]*문의하기/);
});

test.skip("retired provider payment ID behavior", () => {
  const paymentId = createPortOnePaymentId(
    "fdaba7b1-988d-4ccb-b547-ad723cedd865",
    1_725_000_000_000,
    "12345678-1234-1234-1234-123456789abc",
  );

  assert.equal(paymentId, "Pfdaba7b198m0gcgmio1234567812341234");
  assert.match(paymentId, /^[A-Za-z0-9]+$/);
  assert.ok(paymentId.length <= 40);
});

test.skip("retired provider payment ID entropy", () => {
  const paymentId = createPortOnePaymentId(
    "상품-하나",
    0,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );

  assert.equal(paymentId, "Pproduct0aaaaaaaabbbbcccc");
  assert.match(paymentId, /^[A-Za-z0-9]+$/);
});

test.skip("retired provider SDK invocation", async () => {
  const requests = [];
  const prepared = {
    storeId: "store-test123",
    channelKey: "channel-key-test-123",
    paymentId: "Pproduct123456",
    orderName: "NINETY-NINE 상품 1점",
    totalAmount: 32_900,
    currency: "KRW",
    customer: { customerId: "member-1", fullName: "테스트 회원" },
  };

  const result = await invokePortOneProductPayment(
    {
      prepared,
      payMethod: "EASY_PAY",
      origin: "https://ninety-nine.example",
      webhookUrl: "https://ninety-nine.example/api/webhook/portone",
    },
    async (request) => {
      requests.push(request);
      return { paymentId: request.paymentId };
    },
  );

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    ...prepared,
    payMethod: "EASY_PAY",
    noticeUrls: ["https://ninety-nine.example/api/webhook/portone"],
    redirectUrl:
      "https://ninety-nine.example/payment/complete?paymentId=Pproduct123456",
    easyPay: { easyPayProvider: "KAKAOPAY" },
  });
  assert.deepEqual(result, { paymentId: prepared.paymentId });
});

test.skip("retired provider state policy", () => {
  assert.equal(
    preparedPaymentAction({
      paymentStatus: "대기중",
      portoneStatus: "PAY_PENDING",
      canRetryPayment: false,
    }),
    "sync_pending",
  );
  assert.equal(
    preparedPaymentAction({
      paymentStatus: "대기중",
      portoneStatus: "FAILED",
      canRetryPayment: true,
    }),
    "open",
  );
  assert.equal(
    preparedPaymentAction({
      paymentStatus: "결제완료",
      portoneStatus: "PAID",
      canRetryPayment: false,
    }),
    "sync_terminal",
  );
  assert.equal(
    preparedPaymentAction({
      paymentStatus: "가상계좌발급",
      portoneStatus: "VIRTUAL_ACCOUNT_ISSUED",
      canRetryPayment: false,
    }),
    "sync_terminal",
  );
  assert.equal(
    preparedPaymentAction({
      paymentStatus: "대기중",
      portoneStatus: "CANCELLED",
      canRetryPayment: true,
    }),
    "open",
  );
});

test.skip("retired provider completion page", async () => {
  const source = await readFile(
    new URL("src/app/(shop)/payment/complete/page.tsx", rootUrl),
    "utf8",
  );
  const sessionCapture = source.indexOf(
    "const startingSession = await readPaymentSessionIdentity()",
  );
  const paymentSync = source.indexOf("await syncProductPayment(paymentId)");
  const postSyncFence = source.indexOf(
    "await requireSamePaymentSession(startingSession)",
    paymentSync,
  );
  const cartMutation = source.indexOf(
    "removePurchasedFromCart(purchasedProductIds)",
  );

  assert.ok(sessionCapture >= 0 && sessionCapture < paymentSync);
  assert.ok(paymentSync < postSyncFence && postSyncFence < cartMutation);
  assert.match(source, /stored\.buyerId\s*!==\s*buyerId/);
  assert.match(
    source,
    /readPurchasedProductIds\(\s*paymentId,\s*postSyncSession\.userId,\s*\)/,
  );
  assert.ok(
    source.match(/await requireSamePaymentSession\(startingSession\)/g)
      ?.length >= 4,
  );
});

test("fixed purchase intent is same-tab, short-lived, and single-use", () => {
  const values = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  try {
    assert.equal(rememberFixedPurchaseIntent("product-1", "buy", 1_000), true);
    assert.equal(consumeFixedPurchaseIntent("product-1", "buy", 2_000), true);
    assert.equal(consumeFixedPurchaseIntent("product-1", "buy", 2_000), false);

    rememberFixedPurchaseIntent("product-1", "cart", 1_000);
    assert.equal(consumeFixedPurchaseIntent("product-2", "cart", 2_000), false);

    rememberFixedPurchaseIntent("product-1", "cart", 1_000);
    assert.equal(
      consumeFixedPurchaseIntent("product-1", "cart", 1_000 + 10 * 60 * 1_000 + 1),
      false,
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("member commerce snapshots never persist into the guest browser cache", async () => {
  assert.equal(shouldPersistCommerceLocally("guest"), true);
  assert.equal(shouldPersistCommerceLocally("unknown"), false);
  assert.equal(shouldPersistCommerceLocally("member-loading"), false);
  assert.equal(shouldPersistCommerceLocally("member-ready"), false);

  const storeSource = await readFile(
    new URL("src/store/useCommerceStore.ts", rootUrl),
    "utf8",
  );
  assert.doesNotMatch(storeSource, /persistLocally\s*=\s*!get\(\)\.serverInitialized/);
  assert.match(storeSource, /ownerMode:\s*"member-loading"/);
  assert.match(storeSource, /ownerMode:\s*"member-ready"/);
  assert.match(
    storeSource,
    /if\s*\(get\(\)\.ownerMode\s*===\s*"guest"\)[\s\S]*?const local = readLocal\(\)/,
  );
  assert.match(storeSource, /set\(\{ hydrated: true, likedIds: \[\], cartIds: \[\] \}\)/);
  const responseBodyRead = storeSource.indexOf(
    "const [cartPayload, wishlistPayload]",
  );
  const commitSessionRead = storeSource.indexOf(
    "const commitSession =",
    responseBodyRead,
  );
  const memberSnapshotCommit = storeSource.indexOf(
    'ownerMode: "member-ready"',
    commitSessionRead,
  );
  assert.ok(
    responseBodyRead >= 0 &&
      responseBodyRead < commitSessionRead &&
      commitSessionRead < memberSnapshotCommit,
  );

  const session = { access_token: "token-a", user: { id: "user-a" } };
  assert.equal(
    canCommitCommerceSnapshot({
      generation: 2,
      currentGeneration: 2,
      expectedUserId: "user-a",
      expectedAccessToken: "token-a",
      currentSession: session,
    }),
    true,
  );
  for (const mismatch of [
    { currentGeneration: 3 },
    { currentSession: { ...session, user: { id: "user-b" } } },
    { currentSession: { ...session, access_token: "token-b" } },
    { currentSession: null },
  ]) {
    assert.equal(
      canCommitCommerceSnapshot({
        generation: 2,
        currentGeneration: 2,
        expectedUserId: "user-a",
        expectedAccessToken: "token-a",
        currentSession: session,
        ...mismatch,
      }),
      false,
    );
  }
});

test("commerce toolbar counts appear only for the resolved current owner", async () => {
  const memberA = {
    count: 7,
    sessionLoading: false,
    sessionUserId: "user-a",
    ownerMode: "member-ready",
    ownerUserId: "user-a",
  };

  assert.equal(
    resolveVisibleCommerceCount({
      ...memberA,
      count: 0,
      sessionLoading: true,
    }),
    null,
    "a placeholder zero must stay hidden while the session is loading",
  );
  assert.equal(
    resolveVisibleCommerceCount({
      ...memberA,
      sessionUserId: "user-b",
    }),
    null,
    "the previous member's count must stay hidden during an account switch",
  );
  assert.equal(
    resolveVisibleCommerceCount({
      ...memberA,
      ownerMode: "member-loading",
    }),
    null,
    "a member count must stay hidden until its server snapshot is ready",
  );
  assert.equal(resolveVisibleCommerceCount(memberA), 7);
  assert.equal(
    resolveVisibleCommerceCount({ ...memberA, count: 0 }),
    0,
    "a verified current member may deliberately show a real zero",
  );
  assert.equal(
    resolveVisibleCommerceCount({
      count: 3,
      sessionLoading: false,
      sessionUserId: null,
      ownerMode: "guest",
      ownerUserId: null,
    }),
    3,
    "a confirmed guest may see the guest-owned local cache",
  );
  assert.equal(
    resolveVisibleCommerceCount({
      count: 3,
      sessionLoading: false,
      sessionUserId: null,
      ownerMode: "member-ready",
      ownerUserId: "user-a",
    }),
    null,
    "logging out must hide the previous member before guest ownership settles",
  );

  const [toolbarSource, storeSource] = await Promise.all([
    readFile(
      new URL(
        "src/components/features/commerce/CommerceToolbar.tsx",
        rootUrl,
      ),
      "utf8",
    ),
    readFile(new URL("src/store/useCommerceStore.ts", rootUrl), "utf8"),
  ]);
  assert.match(toolbarSource, /useSupabaseSession\(\)/);
  assert.match(toolbarSource, /resolveVisibleCommerceCount\(\{/);
  assert.match(toolbarSource, /visibleLikedCount\s*!==\s*null/);
  assert.match(toolbarSource, /visibleCartCount\s*!==\s*null/);
  assert.match(storeSource, /ownerUserId:\s*string\s*\|\s*null/);
  assert.match(
    storeSource,
    /ownerMode:\s*"member-ready",\s*ownerUserId:\s*authenticatedUserId/,
  );
});

test.skip("superseded archived-provider contract", async () => {
  const [
    ownerRoute,
    cartRoute,
    checkoutRoute,
    cartView,
    runtimeMode,
    paymentSyncRoute,
    webhookRoute,
    commerceClient,
    policyMigration,
  ] =
    await Promise.all([
      readFile(
        new URL("src/app/api/admin/owner/payment-mode/route.ts", rootUrl),
        "utf8",
      ),
      readFile(new URL("src/app/api/cart/route.ts", rootUrl), "utf8"),
      readFile(
        new URL("src/app/api/orders/checkout/route.ts", rootUrl),
        "utf8",
      ),
      readFile(
        new URL("src/components/features/commerce/CartView.tsx", rootUrl),
        "utf8",
      ),
      readFile(new URL("src/lib/portone/runtimeMode.ts", rootUrl), "utf8"),
      readFile(new URL("src/app/api/payments/sync/route.ts", rootUrl), "utf8"),
      readFile(new URL("src/app/api/webhook/portone/route.ts", rootUrl), "utf8"),
      readFile(new URL("src/lib/commerce/client.ts", rootUrl), "utf8"),
      readFile(
        new URL(
          "supabase/migrations/20260721120000_lock_manual_transfer_payment_mode.sql",
          rootUrl,
        ),
        "utf8",
      ),
    ]);

  assert.match(ownerRoute, /getManualTransferAccount\(admin\)/);
  assert.match(ownerRoute, /mode\s*===\s*"portone"[\s\S]*?"portone_archived"/);
  assert.doesNotMatch(ownerRoute, /set_payment_runtime_mode/);
  assert.match(cartRoute, /const\s*\{\s*admin\s*\}\s*=\s*createSupabaseServerClients\(\)/);
  assert.match(cartRoute, /getManualTransferAccount\(admin\)/);
  assert.match(cartRoute, /ACTIVE_COMMERCE_PAYMENT_MODE/);
  assert.doesNotMatch(cartRoute, /get_commerce_payment_status/);
  assert.match(cartView, /주문하고 입금계좌 확인/);
  assert.doesNotMatch(cartView, /id="cart-pay-method"/);
  assert.match(cartView, /expectedPaymentMode/);
  assert.match(cartView, /checkout\.mode\s*!==\s*expectedPaymentMode/);
  assert.match(
    checkoutRoute,
    /expectedPaymentMode\s*!==\s*ACTIVE_COMMERCE_PAYMENT_MODE[\s\S]*?"portone_archived"/,
  );
  assert.match(
    checkoutRoute,
    /if\s*\(PORTONE_COMMERCE_ENABLED\)[\s\S]*?checkoutWithPortOne/,
  );
  assert.match(runtimeMode, /if\s*\(!PORTONE_COMMERCE_ENABLED\)/);
  assert.match(runtimeMode, /"portone_archived"/);
  assert.match(paymentSyncRoute, /requirePortOneRuntimeMode\(authentication\.admin\)/);
  assert.match(
    webhookRoute,
    /if\s*\(!PORTONE_COMMERCE_ENABLED\)[\s\S]*?reason:\s*"portone_archived"/,
  );
  assert.match(policyMigration, /set active_mode = 'manual_transfer'/);
  assert.match(
    policyMigration,
    /p_active_mode = 'portone'[\s\S]*?별도 재활성화 마이그레이션/,
  );
  assert.doesNotMatch(policyMigration, /drop table|drop function/i);
  assert.match(
    commerceClient,
    /latest\?\.user\.id\s*===\s*expectedUserId\s*&&\s*latest\.access_token\s*===\s*token/,
  );
});

test("checkout payment-mode handshake accepts only an exact current mode", () => {
  assert.equal(readCommercePaymentMode("manual_transfer"), "manual_transfer");
  assert.equal(readCommercePaymentMode("portone"), null);
  assert.equal(readCommercePaymentMode("PORTONE"), null);
  assert.equal(readCommercePaymentMode(undefined), null);
  assert.equal(paymentModeMatches("manual_transfer", "manual_transfer"), true);
});

test("catalog inputs are bounded before entering PostgREST filter syntax", () => {
  assert.equal(normalizeProductLimit(Number.NaN), 24);
  assert.equal(normalizeProductLimit(Number.POSITIVE_INFINITY), 24);
  assert.equal(normalizeProductLimit(-4), 1);
  assert.equal(normalizeProductLimit(1_000), 100);
  assert.equal(normalizeProductLimit(12.9), 12);
  assert.equal(
    normalizeCatalogSearch('  A.P.C.),description.ilike.%" OR %  '),
    "A P C description ilike OR",
  );
  assert.equal(normalizeCatalogSearch("가죽   재킷"), "가죽 재킷");
  assert.ok(normalizeCatalogSearch("가".repeat(200)).length <= 80);
});

test("advisor remediation preserves public reads while tightening grants and RLS", async () => {
  const migration = await readFile(
    new URL(
      "supabase/migrations/20260725103000_resolve_advisor_security_and_rls_warnings.sql",
      rootUrl,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /alter function public\.get_public_sold_feed_products[\s\S]*set schema app_private/i,
  );
  assert.match(
    migration,
    /create function public\.get_public_sold_feed_products[\s\S]*security invoker/i,
  );
  assert.match(
    migration,
    /alter function public\.get_auction_server_time\(\) security invoker/i,
  );
  assert.match(
    migration,
    /where namespaces\.nspname = 'public'[\s\S]*procedures\.prosecdef[\s\S]*revoke all on function %s from public, anon/i,
  );
  assert.match(
    migration,
    /alter default privileges for role postgres in schema public[\s\S]*revoke execute on functions from public/i,
  );
  assert.match(
    migration,
    /drop policy if exists "Public reads product images" on storage\.objects/i,
  );
  assert.match(
    migration,
    /create policy "Members read their commerce orders"[\s\S]*member_id = \(select auth\.uid\(\)\)/i,
  );
  assert.match(
    migration,
    /create policy "Members manage their wishlist"[\s\S]*with check \(member_id = \(select auth\.uid\(\)\)\)/i,
  );
  assert.match(
    migration,
    /create policy "Authenticated users read authorized products"/i,
  );
  assert.match(
    migration,
    /create policy "Members and staff read authorized shipping requests"/i,
  );
  assert.match(
    migration,
    /create policy "Members and staff read authorized shipping items"/i,
  );
});
