import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseUrl = (process.env.LOCAL_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);

const browserCandidates = [
  process.env.LOCAL_BROWSER_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
assert(browserPath, "Chrome or Edge is required for the local browser smoke test");

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

async function poll(check, message, timeoutMs = 10_000) {
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

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitForExpression(
    client,
    `document.readyState === "complete" && location.href.startsWith(${JSON.stringify(baseUrl)})`,
    `Page did not finish loading: ${url}`,
  );
}

const tempRoot = resolve(tmpdir());
const profile = await mkdtemp(join(tempRoot, "ninety-nine-browser-"));
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
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

let client;
const browserErrors = [];

try {
  client = await createBrowserPage(debugPort);
  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Fetch.enable", {
      patterns: [
        {
          urlPattern: "*://localhost:3000/api/auth/kakao/start*",
          requestStage: "Request",
        },
        {
          urlPattern: "*://127.0.0.1:3000/api/auth/kakao/start*",
          requestStage: "Request",
        },
      ],
    }),
  ]);

  client.on("Runtime.exceptionThrown", (event) => {
    browserErrors.push(event.exceptionDetails?.text || "Uncaught browser error");
  });
  client.on("Fetch.requestPaused", (event) => {
    const isKakaoStart = new URL(event.request.url).pathname === "/api/auth/kakao/start";
    const command = isKakaoStart
      ? client.send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "text/html; charset=utf-8" },
          ],
          body: Buffer.from("<!doctype html><title>Kakao redirect intercepted</title>").toString(
            "base64",
          ),
        })
      : client.send("Fetch.continueRequest", { requestId: event.requestId });
    void command.catch((error) => browserErrors.push(error.message));
  });

  await navigate(client, `${baseUrl}/`);
  await waitForExpression(
    client,
    `location.pathname === "/home" && document.body?.innerText.includes("즉시 구매")`,
    "Root did not immediately render the localized home page",
  );
  const homeText = await evaluate(client, "document.body.innerText");
  assert.doesNotMatch(homeText, /DEVICE CHECKING|SESSION WAITING/);

  const fixedHref = await evaluate(
    client,
    `(() => {
      const link = [...document.querySelectorAll('a[href^="/auction/"]')]
        .find((element) => element.innerText.includes("즉시 구매"));
      return link?.getAttribute("href") ?? null;
    })()`,
  );
  assert.match(fixedHref ?? "", /^\/auction\/[0-9a-f-]+$/i);

  const clickedProduct = await evaluate(
    client,
    `(() => {
      const href = ${JSON.stringify(fixedHref)};
      const link = [...document.querySelectorAll('a[href^="/auction/"]')]
        .find((element) => element.getAttribute("href") === href);
      link?.click();
      return Boolean(link);
    })()`,
  );
  assert.equal(clickedProduct, true, "Could not click a fixed-price product");
  await waitForExpression(
    client,
    `location.pathname === ${JSON.stringify(fixedHref)} && document.body?.innerText.includes("즉시 구매") && Boolean(document.querySelector('[role="dialog"]'))`,
    "Fixed-price intercepted modal did not render after the product click",
  );

  const detailState = await evaluate(
    client,
    `(() => {
      const panel = document.querySelector(".mobile-detail-cta");
      return {
        text: document.body.innerText,
        cartEnabled: [...(panel?.querySelectorAll("button") ?? [])]
          .some((button) => button.innerText.trim() === "장바구니" && !button.disabled),
        buyEnabled: [...(panel?.querySelectorAll("button") ?? [])]
          .some((button) => button.innerText.trim() === "즉시 구매" && !button.disabled),
      };
    })()`,
  );
  assert.equal(detailState.cartEnabled, true);
  assert.equal(detailState.buyEnabled, true);

  const clickedCart = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll(".mobile-detail-cta button")]
        .find((element) => element.innerText.trim() === "장바구니");
      button?.click();
      return Boolean(button);
    })()`,
  );
  assert.equal(clickedCart, true, "Could not click the detail cart action");
  await waitForExpression(
    client,
    `location.pathname === "/account/login" && document.body?.innerText.includes("카카오로 계속하기")`,
    "Anonymous cart action did not open the intercepted login route",
  );

  const storedIntent = await evaluate(
    client,
    `sessionStorage.getItem("ninetynine-fixed-purchase-intent")`,
  );
  const parsedIntent = JSON.parse(storedIntent);
  assert.equal(parsedIntent.productId, fixedHref.split("/").at(-1));
  assert.equal(parsedIntent.intent, "cart");
  assert.equal(Number.isFinite(parsedIntent.createdAt), true);

  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await navigate(client, `${baseUrl}/home`);
  const mobileLayout = await evaluate(
    client,
    `(() => {
      const mobileHome = document.querySelector('[data-home-presentation="mobile"]');
      const desktopHome = document.querySelector('[data-home-presentation="desktop"]');
      const visible = (element) => element && getComputedStyle(element).display !== "none";
      return {
        mobileVisible: visible(mobileHome),
        desktopVisible: visible(desktopHome),
        bottomNavVisible: visible(document.querySelector('nav[aria-label="모바일 하단 메뉴"]')),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`,
  );
  assert.equal(mobileLayout.mobileVisible, true);
  assert.equal(mobileLayout.desktopVisible, false);
  assert.equal(mobileLayout.bottomNavVisible, true);
  assert.ok(mobileLayout.overflow <= 1, `Mobile layout overflows by ${mobileLayout.overflow}px`);

  await navigate(client, `${baseUrl}/cart`);
  await waitForExpression(
    client,
    `document.body?.innerText.includes("카카오 로그인 후 장바구니를 이용할 수 있습니다.")`,
    "Anonymous cart did not settle on the Kakao login prompt",
  );

  assert.deepEqual(browserErrors, [], browserErrors.join("\n"));
  console.log(
    `PASS browser happy path (/home -> ${fixedHref} -> Kakao intent -> /cart)`,
  );
} finally {
  client?.close();
  if (!browser.killed) browser.kill();
  const resolvedProfile = resolve(profile);
  const safePrefix = `${tempRoot}\\`;
  if (
    resolvedProfile.startsWith(safePrefix) &&
    resolvedProfile.split(/[\\/]/).at(-1)?.startsWith("ninety-nine-browser-")
  ) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 });
  }
}
