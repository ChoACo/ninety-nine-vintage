import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const baseUrl = (process.env.LOCAL_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const appUrl = new URL(baseUrl);
assert(
  appUrl.protocol === "http:" &&
    (appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1"),
  "The checkout browser verification may only target a local HTTP server",
);

function readLocalEnv(name) {
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    const line = readFileSync(filename, "utf8")
      .split(/\r?\n/)
      .find((candidate) =>
        candidate.replace(/^\uFEFF/, "").startsWith(`${name}=`),
      );
    if (!line) continue;
    const raw = line.slice(line.indexOf("=") + 1).trim();
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return undefined;
}

const configuredSupabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  readLocalEnv("NEXT_PUBLIC_SUPABASE_URL");
assert(configuredSupabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required");
const supabaseUrl = new URL(configuredSupabaseUrl);
const projectRef = supabaseUrl.hostname.split(".")[0];
assert(projectRef, "Could not derive the Supabase auth storage key");
const authStorageKey = `sb-${projectRef}-auth-token`;
const kakaoFlowId = "a".repeat(64);
const kakaoIdToken = "local-browser-kakao-id-token";
const kakaoNonce = "local-browser-kakao-nonce";
const kakaoFailureFlowId = "b".repeat(64);
const kakaoFailureIdToken = "local-browser-kakao-failure-id-token";
const kakaoRaceFlowId = "c".repeat(64);
const kakaoRaceIdToken = "local-browser-kakao-race-id-token";
const guestCacheSeedMarker = "ninetynine-auth-test-guest-cache-seeded";
const guestPromptSeenMarker = "ninetynine-auth-test-guest-prompt-seen";
const callbackIdentityLeakMarker = "ninetynine-auth-test-callback-identity-leak";

const browserCandidates = [
  process.env.LOCAL_BROWSER_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
assert(browserPath, "Chrome or Edge is required for the checkout browser test");

const buyerId = "11111111-1111-4111-8111-111111111111";
const productId = "fdaba7b1-988d-4ccb-b547-ad723cedd865";
const orderId = "22222222-2222-4222-8222-222222222222";
const paymentId = "Pproduct123456";
const totalAmount = 32_900;
const storeId = "store-localbrowser";
const channelKey = "channel-key-local-browser";

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const nowSeconds = Math.floor(Date.now() / 1000);
const accessToken = [
  encodeJwtPart({ alg: "HS256", typ: "JWT" }),
  encodeJwtPart({
    aud: "authenticated",
    exp: nowSeconds + 7_200,
    iat: nowSeconds,
    role: "authenticated",
    sub: buyerId,
  }),
  "localbrowsersignature",
].join(".");
const nowIso = new Date(nowSeconds * 1000).toISOString();
const fakeSession = {
  access_token: accessToken,
  refresh_token: "local-browser-refresh-token",
  expires_in: 7_200,
  expires_at: nowSeconds + 7_200,
  token_type: "bearer",
  user: {
    id: buyerId,
    aud: "authenticated",
    role: "authenticated",
    email: "browser-test@example.invalid",
    email_confirmed_at: nowIso,
    phone: "",
    confirmed_at: nowIso,
    last_sign_in_at: nowIso,
    app_metadata: { provider: "kakao", providers: ["kakao"] },
    user_metadata: { name: "브라우저 테스트" },
    identities: [],
    created_at: nowIso,
    updated_at: nowIso,
    is_anonymous: false,
  },
};
const secondBuyerId = "33333333-3333-4333-8333-333333333333";
const secondAccessToken = [
  encodeJwtPart({ alg: "HS256", typ: "JWT" }),
  encodeJwtPart({
    aud: "authenticated",
    exp: nowSeconds + 7_200,
    iat: nowSeconds,
    role: "authenticated",
    sub: secondBuyerId,
  }),
  "localbrowsersecondsignature",
].join(".");
const secondFakeSession = {
  ...fakeSession,
  access_token: secondAccessToken,
  refresh_token: "local-browser-second-refresh-token",
  user: {
    ...fakeSession.user,
    id: secondBuyerId,
    email: "browser-test-second@example.invalid",
    user_metadata: { name: "두 번째 브라우저 테스트" },
  },
};

const cartPayload = {
  paymentMode: "portone",
  productIds: [productId],
  staleProductIds: [],
  items: [
    {
      id: productId,
      title: "브라우저 테스트 상품",
      description: "로컬 결제 호출 검증 전용 상품",
      category: "TEST",
      publishAt: "2026-07-20T00:00:00.000Z",
      closesAt: "2099-12-31T23:59:59.000Z",
      startingPrice: totalAmount,
      currentPrice: totalAmount,
      fixedPrice: totalAmount,
      imageUrls: [],
      sizeLabel: "M",
      conditionGrade: "A",
    },
  ],
};

const checkoutPayload = {
  mode: "portone",
  order: { id: orderId, status: "awaiting_payment", total: totalAmount },
  payment: {
    storeId,
    channelKey,
    paymentId,
    orderName: "NINETY-NINE 상품 1점",
    totalAmount,
    currency: "KRW",
    payMethod: "EASY_PAY",
    paymentStatus: "대기중",
    portoneStatus: "READY",
    canRetryPayment: false,
    customer: {
      customerId: buyerId,
      fullName: "브라우저 테스트",
      email: "browser-test@example.invalid",
    },
  },
};

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function poll(check, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(message, lastError ? { cause: lastError } : undefined);
}

class CdpClient {
  #id = 0;
  #pending = new Map();
  #listeners = new Map();
  #socket;

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out connecting to the browser")),
        10_000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolveOpen();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("Could not connect to the browser"));
        },
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result ?? {});
        return;
      }
      for (const listener of this.#listeners.get(message.method) ?? []) {
        listener(message.params ?? {});
      }
    });
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? [];
    listeners.push(listener);
    this.#listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolveCommand, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Browser command timed out: ${method}`));
      }, 10_000);
      this.#pending.set(id, { resolve: resolveCommand, reject, timeout });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket.close();
  }
}

async function createBrowserPage(debugPort) {
  await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    return response.ok;
  }, "Browser debugging endpoint did not start");

  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  assert.equal(response.ok, true, "Could not create a browser tab");
  const target = await response.json();
  assert.equal(typeof target.webSocketDebuggerUrl, "string");
  return CdpClient.connect(target.webSocketDebuggerUrl);
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Browser evaluation failed");
  }
  return response.result?.value;
}

async function waitForExpression(client, expression, message) {
  return poll(() => evaluate(client, expression), message);
}

function responseHeaders(corsOrigin) {
  const headers = [
    { name: "Content-Type", value: "application/json; charset=utf-8" },
    { name: "Cache-Control", value: "no-store" },
  ];
  if (corsOrigin) {
    headers.push(
      { name: "Access-Control-Allow-Origin", value: corsOrigin },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
      {
        name: "Access-Control-Allow-Headers",
        value:
          "apikey, authorization, content-type, x-client-info, x-supabase-api-version",
      },
    );
  }
  return headers;
}

const tempRoot = resolve(tmpdir());
const profile = await mkdtemp(join(tempRoot, "ninety-nine-checkout-browser-"));
const debugPort = await reservePort();
const browser = spawn(
  browserPath,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-allow-origins=*",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

let client;
const browserErrors = [];
const cartRequests = [];
const checkoutRequests = [];
const kakaoProfileRequests = [];
const kakaoSessionRequests = [];
const syncRequests = [];
const supabaseLogoutRequests = [];
const supabaseTokenRequests = [];
const wishlistRequests = [];
const externalRequests = new Set();
const unexpectedApiRequests = new Set();
let successProfileRequestId = null;
let raceProfileRequestId = null;

try {
  client = await createBrowserPage(debugPort);
  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Network.enable"),
    client.send("Network.setBlockedURLs", {
      urls: ["ws://*", "wss://*"],
    }),
    client.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    }),
  ]);

  const initScript = `(() => {
    try {
      if (sessionStorage.getItem(${JSON.stringify(guestCacheSeedMarker)}) !== "1") {
        localStorage.setItem(
          "ninetynine-commerce-cache",
          JSON.stringify({ likedIds: ["legacy-like"], cartIds: ["legacy-cart"] }),
        );
        sessionStorage.setItem(${JSON.stringify(guestCacheSeedMarker)}, "1");
      }
    } catch {}
    const identitySelector =
      '[aria-label="내 정보"], [aria-label="로그아웃"], [aria-label="장바구니"], [aria-label="찜한 상품"]';
    const inspectAuthNode = (node) => {
      const element = node instanceof Element ? node : node.parentElement;
      if (!element) return;
      if (element.textContent?.includes("카카오 로그인 후 장바구니를 이용할 수 있습니다.")) {
        sessionStorage.setItem(${JSON.stringify(guestPromptSeenMarker)}, "1");
      }
      if (
        location.pathname === "/auth/callback" &&
        (element.matches?.(identitySelector) || element.querySelector?.(identitySelector))
      ) {
        sessionStorage.setItem(${JSON.stringify(callbackIdentityLeakMarker)}, "1");
      }
    };
    const startAuthObserver = () => {
      if (!document.documentElement) {
        document.addEventListener("DOMContentLoaded", startAuthObserver, {
          once: true,
        });
        return;
      }
      inspectAuthNode(document.documentElement);
      new MutationObserver((records) => {
        for (const record of records) {
          inspectAuthNode(record.target);
          for (const node of record.addedNodes) inspectAuthNode(node);
        }
      }).observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
    };
    startAuthObserver();
    window.__PORTONE_REQUESTS__ = [];
    window.PortOne = {
      requestPayment: async (request) => {
        window.__PORTONE_REQUESTS__.push(JSON.parse(JSON.stringify(request)));
        return { paymentId: ${JSON.stringify(paymentId)} };
      },
    };
  })();`;
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: initScript,
  });

  client.on("Runtime.exceptionThrown", (event) => {
    browserErrors.push(event.exceptionDetails?.text || "Uncaught browser error");
  });
  client.on("Network.requestWillBeSent", (event) => {
    try {
      const url = new URL(event.request.url);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin !== appUrl.origin &&
        !(
          url.origin === supabaseUrl.origin &&
          ["/auth/v1/token", "/auth/v1/logout"].includes(url.pathname)
        )
      ) {
        externalRequests.add(`${url.origin}${url.pathname}`);
      }
    } catch {
      // Browser-internal URLs are outside this local HTTP verification.
    }
  });
  client.on("Network.webSocketCreated", (event) => {
    try {
      const url = new URL(event.url);
      const isLocalSocket =
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        url.port === appUrl.port;
      if (!isLocalSocket) {
        externalRequests.add(`${url.protocol}//${url.host}${url.pathname}`);
      }
    } catch {
      externalRequests.add(`websocket:${event.url}`);
    }
  });

  const fulfillJson = (requestId, body, options = {}) =>
    client.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: options.responseCode ?? 200,
      responseHeaders: responseHeaders(options.corsOrigin),
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    });

  client.on("Fetch.requestPaused", (event) => {
    const handle = async () => {
      const url = new URL(event.request.url);
      let requestBody = null;
      if (event.request.postData) {
        try {
          requestBody = JSON.parse(event.request.postData);
        } catch {
          requestBody = event.request.postData;
        }
      }
      const record = {
        method: event.request.method,
        headers: event.request.headers,
        body: requestBody,
        search: url.search,
      };

      if (
        url.origin === supabaseUrl.origin &&
        url.pathname === "/auth/v1/token"
      ) {
        if (event.request.method === "OPTIONS") {
          await client.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: 204,
            responseHeaders: responseHeaders(appUrl.origin),
          });
          return;
        }
        supabaseTokenRequests.push(record);
        await fulfillJson(
          event.requestId,
          {
            access_token: fakeSession.access_token,
            refresh_token: fakeSession.refresh_token,
            expires_in: fakeSession.expires_in,
            expires_at: fakeSession.expires_at,
            token_type: fakeSession.token_type,
            user: fakeSession.user,
          },
          { corsOrigin: appUrl.origin },
        );
        return;
      }
      if (
        url.origin === supabaseUrl.origin &&
        url.pathname === "/auth/v1/logout"
      ) {
        if (event.request.method !== "OPTIONS") {
          supabaseLogoutRequests.push(record);
        }
        await client.send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: 204,
          responseHeaders: responseHeaders(appUrl.origin),
        });
        return;
      }

      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin !== appUrl.origin
      ) {
        externalRequests.add(`${url.origin}${url.pathname}`);
        await client.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }

      if (url.pathname === "/api/auth/kakao/session") {
        kakaoSessionRequests.push(record);
        const flow = url.searchParams.get("flow");
        await fulfillJson(event.requestId, {
          idToken:
            flow === kakaoFailureFlowId
              ? kakaoFailureIdToken
              : flow === kakaoRaceFlowId
                ? kakaoRaceIdToken
                : kakaoIdToken,
          nonce: kakaoNonce,
          returnTo: "/cart",
        });
        return;
      }
      if (url.pathname === "/api/auth/kakao/profile") {
        kakaoProfileRequests.push(record);
        const flow = url.searchParams.get("flow");
        if (flow === kakaoFlowId) {
          successProfileRequestId = event.requestId;
          return;
        }
        if (flow === kakaoFailureFlowId) {
          await fulfillJson(
            event.requestId,
            { error: "profile_failed" },
            { responseCode: 500 },
          );
          return;
        }
        if (flow === kakaoRaceFlowId) {
          raceProfileRequestId = event.requestId;
          return;
        }
        await fulfillJson(event.requestId, { ok: true });
        return;
      }

      if (url.pathname === "/api/cart") {
        cartRequests.push(record);
        await fulfillJson(
          event.requestId,
          event.request.method === "GET"
            ? cartPayload
            : { ok: true, productId },
        );
        return;
      }
      if (url.pathname === "/api/orders/checkout") {
        checkoutRequests.push(record);
        await fulfillJson(event.requestId, checkoutPayload);
        return;
      }
      if (url.pathname === "/api/payments/sync") {
        syncRequests.push(record);
        await fulfillJson(event.requestId, {
          paymentStatus: "결제완료",
          portoneStatus: "PAID",
          canRetryPayment: false,
        });
        return;
      }
      if (url.pathname === "/api/wishlist") {
        wishlistRequests.push(record);
        await fulfillJson(event.requestId, { productIds: [], items: [] });
        return;
      }
      if (url.origin === appUrl.origin && url.pathname.startsWith("/api/")) {
        unexpectedApiRequests.add(`${event.request.method} ${url.pathname}`);
        await client.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      await client.send("Fetch.continueRequest", { requestId: event.requestId });
    };
    void handle().catch((error) => browserErrors.push(error.message));
  });

  await client.send("Page.navigate", {
    url: `${baseUrl}/auth/callback?flow=${kakaoFlowId}`,
  });
  await poll(
    () => successProfileRequestId,
    "Kakao profile synchronization was not reached",
  );
  assert.equal(
    await evaluate(
      client,
      `location.pathname === "/auth/callback" &&
        document.querySelector('[aria-label="로그인 상태 확인 중"]') !== null &&
        document.querySelector('[aria-label="내 정보"]') === null &&
        document.querySelector('[aria-label="로그아웃"]') === null &&
        document.querySelector('[aria-label="장바구니"]') === null &&
        document.querySelector('[aria-label="찜한 상품"]') === null`,
    ),
    true,
    "The callback exposed member or commerce controls before profile validation",
  );
  assert.equal(cartRequests.length, 0);
  assert.equal(wishlistRequests.length, 0);
  assert.equal(
    await evaluate(
      client,
      `JSON.parse(localStorage.getItem(${JSON.stringify(authStorageKey)}))?.access_token === ${JSON.stringify(accessToken)}`,
    ),
    true,
    "supabase-js did not persist the callback-owned session before profile validation",
  );
  await fulfillJson(successProfileRequestId, { ok: true });
  successProfileRequestId = null;
  await waitForExpression(
    client,
    `document.readyState === "complete" && location.pathname === "/cart"`,
    "Kakao callback did not retain the member session while redirecting to cart",
  );
  await waitForExpression(
    client,
    `document.body?.innerText.includes("브라우저 테스트 상품") &&
      [...document.querySelectorAll("button")].some(
        (button) => button.innerText.trim() === "결제하기" && !button.disabled,
      )`,
    "Authenticated cart did not render a payable fixed-price product",
  );
  assert.equal(
    await evaluate(
      client,
      `document.querySelector('[data-missing-image="true"]') !== null &&
        [...document.images].every((image) => image.getAttribute("src") !== "")`,
    ),
    true,
    "A product without an image must render a placeholder, never an empty image src",
  );
  assert.equal(
    await evaluate(
      client,
      `JSON.parse(localStorage.getItem(${JSON.stringify(authStorageKey)}))?.user?.id === ${JSON.stringify(buyerId)} &&
        sessionStorage.getItem(${JSON.stringify(guestPromptSeenMarker)}) !== "1" &&
        sessionStorage.getItem(${JSON.stringify(callbackIdentityLeakMarker)}) !== "1"`,
    ),
    true,
    "The verified session was lost, flickered to guest, or exposed identity before profile validation",
  );

  await client.send("Page.reload");
  await waitForExpression(
    client,
    `document.readyState === "complete" &&
      document.body?.innerText.includes("브라우저 테스트 상품") &&
      [...document.querySelectorAll("button")].some(
        (button) => button.innerText.trim() === "결제하기" && !button.disabled,
      )`,
    "The persisted member session or cart was lost after a page reload",
  );

  await waitForExpression(
    client,
    `(() => {
      const select = document.querySelector("#cart-pay-method");
      if (!(select instanceof HTMLSelectElement) || select.disabled) return false;
      select.value = "EASY_PAY";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value === "EASY_PAY";
    })()`,
    "Could not select KakaoPay checkout",
  );

  const clicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((element) => element.innerText.trim() === "결제하기");
      button?.click();
      return Boolean(button);
    })()`,
  );
  assert.equal(clicked, true, "Could not click the cart payment button");

  await waitForExpression(
    client,
    `window.__PORTONE_REQUESTS__?.length === 1`,
    "Cart checkout did not call the PortOne SDK exactly once",
  );
  await waitForExpression(
    client,
    `document.body?.innerText.includes(${JSON.stringify(
      `주문 ${orderId}의 결제가 완료되었습니다.`,
    )})`,
    "Verified PortOne payment did not settle as completed in the cart UI",
  );
  await poll(
    () => cartRequests.some((request) => request.method === "DELETE"),
    "Verified payment did not request removal of the purchased cart item",
  );

  const sdkRequests = await evaluate(client, "window.__PORTONE_REQUESTS__");
  assert.equal(sdkRequests.length, 1);
  const [sdkRequest] = sdkRequests;
  assert.deepEqual(
    {
      storeId: sdkRequest.storeId,
      channelKey: sdkRequest.channelKey,
      paymentId: sdkRequest.paymentId,
      orderName: sdkRequest.orderName,
      totalAmount: sdkRequest.totalAmount,
      currency: sdkRequest.currency,
      payMethod: sdkRequest.payMethod,
      easyPay: sdkRequest.easyPay,
      customer: sdkRequest.customer,
      redirectUrl: sdkRequest.redirectUrl,
    },
    {
      storeId,
      channelKey,
      paymentId,
      orderName: "NINETY-NINE 상품 1점",
      totalAmount,
      currency: "KRW",
      payMethod: "EASY_PAY",
      easyPay: { easyPayProvider: "KAKAOPAY" },
      customer: checkoutPayload.payment.customer,
      redirectUrl: `${baseUrl}/payment/complete?paymentId=${paymentId}`,
    },
  );

  const privateRequestCount = () =>
    cartRequests.length + wishlistRequests.length;
  const privateRequestsAfterCheckout = privateRequestCount();
  await evaluate(
    client,
    `localStorage.removeItem(${JSON.stringify(authStorageKey)}); true`,
  );
  await client.send("Page.navigate", {
    url: `${baseUrl}/auth/callback?flow=${kakaoFailureFlowId}`,
  });
  await waitForExpression(
    client,
    `location.pathname === "/auth/callback" &&
      document.body?.innerText.includes("로그인을 완료하지 못했습니다.")`,
    "A failed profile synchronization did not settle on the callback error UI",
  );
  await poll(
    () => supabaseLogoutRequests.length === 1,
    "A failed profile synchronization did not roll back its Supabase session",
  );
  assert.equal(
    await evaluate(
      client,
      `localStorage.getItem(${JSON.stringify(authStorageKey)}) === null &&
        sessionStorage.getItem(${JSON.stringify(callbackIdentityLeakMarker)}) !== "1"`,
    ),
    true,
    "A failed profile synchronization retained its session or exposed private UI",
  );
  assert.equal(privateRequestCount(), privateRequestsAfterCheckout);

  await evaluate(
    client,
    `localStorage.removeItem(${JSON.stringify(authStorageKey)}); true`,
  );
  const logoutCountBeforeRace = supabaseLogoutRequests.length;
  await client.send("Page.navigate", {
    url: `${baseUrl}/auth/callback?flow=${kakaoRaceFlowId}`,
  });
  await poll(
    () => raceProfileRequestId,
    "The account-switch callback did not reach profile synchronization",
  );
  assert.equal(
    await evaluate(
      client,
      `JSON.parse(localStorage.getItem(${JSON.stringify(authStorageKey)}))?.access_token === ${JSON.stringify(accessToken)}`,
    ),
    true,
    "The callback-owned session was missing before the account switch",
  );
  assert.equal(
    await evaluate(
      client,
      `(() => {
        localStorage.setItem(
          ${JSON.stringify(authStorageKey)},
          ${JSON.stringify(JSON.stringify(secondFakeSession))},
        );
        const channel = new BroadcastChannel(${JSON.stringify(authStorageKey)});
        channel.postMessage({
          event: "SIGNED_IN",
          session: ${JSON.stringify(secondFakeSession)},
        });
        channel.close();
        return true;
      })()`,
    ),
    true,
  );
  await fulfillJson(raceProfileRequestId, { ok: true });
  raceProfileRequestId = null;
  await waitForExpression(
    client,
    `location.pathname === "/auth/callback" &&
      document.body?.innerText.includes("로그인 처리 중 계정이 변경되었습니다.")`,
    "A newer account was not detected after profile synchronization",
  );
  assert.equal(
    await evaluate(
      client,
      `JSON.parse(localStorage.getItem(${JSON.stringify(authStorageKey)}))?.user?.id === ${JSON.stringify(secondBuyerId)} &&
        sessionStorage.getItem(${JSON.stringify(callbackIdentityLeakMarker)}) !== "1"`,
    ),
    true,
    "The callback removed the newer account or exposed private UI",
  );
  assert.equal(supabaseLogoutRequests.length, logoutCountBeforeRace);
  assert.equal(privateRequestCount(), privateRequestsAfterCheckout);

  assert.equal(checkoutRequests.length, 1);
  assert.deepEqual(checkoutRequests[0].body.productIds, [productId]);
  assert.equal(checkoutRequests[0].body.payMethod, "EASY_PAY");
  assert.equal(checkoutRequests[0].body.expectedPaymentMode, "portone");
  assert.match(
    checkoutRequests[0].body.idempotencyKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal("totalAmount" in checkoutRequests[0].body, false);
  assert.equal("paymentId" in checkoutRequests[0].body, false);
  const authorization = (request) =>
    Object.entries(request.headers).find(
      ([name]) => name.toLowerCase() === "authorization",
    )?.[1] ?? "";
  const expectedAuthorization = `Bearer ${accessToken}`;
  const authScenarios = [
    { flow: kakaoFlowId, idToken: kakaoIdToken },
    { flow: kakaoFailureFlowId, idToken: kakaoFailureIdToken },
    { flow: kakaoRaceFlowId, idToken: kakaoRaceIdToken },
  ];
  assert.equal(kakaoSessionRequests.length, authScenarios.length);
  assert.equal(kakaoProfileRequests.length, authScenarios.length);
  assert.equal(supabaseTokenRequests.length, authScenarios.length);
  for (const scenario of authScenarios) {
    const sessionRequests = kakaoSessionRequests.filter(
      (request) => request.search === `?flow=${scenario.flow}`,
    );
    const profileRequests = kakaoProfileRequests.filter(
      (request) => request.search === `?flow=${scenario.flow}`,
    );
    const tokenRequests = supabaseTokenRequests.filter(
      (request) => request.body?.id_token === scenario.idToken,
    );
    assert.equal(sessionRequests.length, 1);
    assert.equal(sessionRequests[0].method, "POST");
    assert.equal(profileRequests.length, 1);
    assert.equal(profileRequests[0].method, "POST");
    assert.equal(authorization(profileRequests[0]), expectedAuthorization);
    assert.equal(tokenRequests.length, 1);
    assert.equal(tokenRequests[0].method, "POST");
    assert.equal(tokenRequests[0].search, "?grant_type=id_token");
    assert.deepEqual(
      {
        provider: tokenRequests[0].body.provider,
        idToken: tokenRequests[0].body.id_token,
        nonce: tokenRequests[0].body.nonce,
      },
      { provider: "kakao", idToken: scenario.idToken, nonce: kakaoNonce },
    );
  }
  assert.equal(supabaseLogoutRequests.length, 1);
  assert.equal(supabaseLogoutRequests[0].method, "POST");
  assert.equal(supabaseLogoutRequests[0].search, "?scope=local");
  assert.equal(authorization(supabaseLogoutRequests[0]), expectedAuthorization);
  assert.equal(checkoutRequests[0].method, "POST");
  assert.equal(syncRequests.length, 1);
  assert.equal(syncRequests[0].method, "POST");
  assert.deepEqual(syncRequests[0].body, { paymentId });
  assert.equal(wishlistRequests.length > 0, true);
  assert.equal(wishlistRequests.every((request) => request.method === "GET"), true);
  const cartGets = cartRequests.filter((request) => request.method === "GET");
  const cartDeletes = cartRequests.filter((request) => request.method === "DELETE");
  assert.equal(cartGets.length > 0, true);
  assert.equal(cartDeletes.length, 1);
  assert.deepEqual(cartDeletes[0].body, { productId });
  for (const request of [
    ...cartRequests,
    ...checkoutRequests,
    ...syncRequests,
    ...wishlistRequests,
  ]) {
    assert.equal(
      authorization(request),
      expectedAuthorization,
      `${request.method} request did not retain the callback-created member session`,
    );
  }
  assert.deepEqual(
    [...externalRequests],
    [],
    `Unexpected external browser requests: ${[...externalRequests].join(", ")}`,
  );
  assert.deepEqual(
    [...unexpectedApiRequests],
    [],
    `Unexpected same-origin API requests: ${[
      ...unexpectedApiRequests,
    ].join(", ")}`,
  );
  assert.deepEqual(browserErrors, [], browserErrors.join("\n"));

  console.log(
    "PASS local auth and checkout boundary (Kakao callback -> retained member cart -> PortOne SDK stub once -> mocked PAID)",
  );
} finally {
  client?.close();
  if (!browser.killed) browser.kill();
  const resolvedProfile = resolve(profile);
  const profileRelative = relative(tempRoot, resolvedProfile);
  if (
    profileRelative &&
    !profileRelative.startsWith("..") &&
    !isAbsolute(profileRelative) &&
    profileRelative.split(/[\\/]/).at(-1)?.startsWith(
      "ninety-nine-checkout-browser-",
    )
  ) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 });
  }
}
