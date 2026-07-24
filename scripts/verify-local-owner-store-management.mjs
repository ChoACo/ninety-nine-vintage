import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseUrl = (process.env.LOCAL_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const browserPath = [
  process.env.LOCAL_BROWSER_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));
assert(browserPath, "Chrome or Edge is required for the Owner browser test");

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      server.close((error) =>
        error ? reject(error) : resolvePort(address.port),
      );
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
  assert.equal(response.ok, true);
  const target = await response.json();
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

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await poll(
    () =>
      evaluate(
        client,
        `document.readyState === "complete" && location.href.startsWith(${JSON.stringify(baseUrl)})`,
      ),
    `Page did not finish loading: ${url}`,
  );
}

const tempRoot = resolve(tmpdir());
const profile = await mkdtemp(join(tempRoot, "ninety-nine-owner-browser-"));
const screenshotPath = join(tempRoot, "ninety-nine-owner-store-management.png");
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
    "--window-size=1440,1200",
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
    client.send("Console.enable"),
  ]);
  client.on("Runtime.exceptionThrown", (event) => {
    browserErrors.push(
      event.exceptionDetails?.exception?.description ||
        event.exceptionDetails?.text ||
        "Uncaught browser error",
    );
  });
  client.on("Runtime.consoleAPICalled", (event) => {
    if (event.type !== "error") return;
    browserErrors.push(
      event.args
        .map((argument) => argument.value ?? argument.description ?? "")
        .join(" "),
    );
  });

  await navigate(
    client,
    `${baseUrl}/account/login?next=${encodeURIComponent("/admin/owner/stores")}`,
  );
  await poll(
    () =>
      evaluate(
        client,
        `document.body?.innerText.includes("테스트 관리자로 접속")`,
      ),
    "Local Owner login button did not render",
  );
  const clicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((element) => element.innerText.trim() === "테스트 관리자로 접속");
      button?.click();
      return Boolean(button);
    })()`,
  );
  assert.equal(clicked, true);

  await poll(
    () =>
      evaluate(
        client,
        `location.pathname === "/admin/owner/stores"
          && document.body?.innerText.includes("센터(매장) 관리")
          && document.body?.innerText.includes("센터(매장) 추가")
          && document.body?.innerText.includes("직원 배치")
          && document.body?.innerText.includes("수정 저장")`,
      ),
    "Owner center(store) management page did not settle",
  );

  const pageState = await evaluate(
    client,
    `({
      overlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")),
      textLength: document.body?.innerText.trim().length ?? 0,
      articleCount: document.querySelectorAll("article").length,
      inputCount: document.querySelectorAll("input, select, textarea").length,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth
    })`,
  );
  assert.equal(pageState.overlay, false, "Next.js error overlay is visible");
  assert.ok(pageState.textLength > 100, "Owner page is blank");
  assert.ok(pageState.articleCount >= 1, "Existing stores did not render");
  assert.ok(pageState.inputCount >= 5, "Store management controls did not render");
  assert.ok(
    pageState.horizontalOverflow <= 1,
    `Owner page overflows by ${pageState.horizontalOverflow}px`,
  );

  const screenshot = await client.send("Page.captureScreenshot", {
    captureBeyondViewport: false,
    format: "png",
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await navigate(client, `${baseUrl}/admin/owner`);
  await poll(
    () =>
      evaluate(
        client,
        `document.body?.innerText.includes("관리자 센터")
          && document.body?.innerText.includes("센터(매장)·인력 배치")`,
      ),
    "Owner dashboard did not render the center(store) link",
  );
  const dashboardText = await evaluate(client, "document.body.innerText");
  assert.doesNotMatch(dashboardText, /숍별 운영 현황|숍 운영자/);
  assert.deepEqual(browserErrors, [], browserErrors.join("\n"));

  console.log(
    `PASS Owner center(store) browser flow; screenshot=${screenshotPath}`,
  );
} finally {
  client?.close();
  if (!browser.killed) browser.kill();
  const resolvedProfile = resolve(profile);
  if (
    resolvedProfile.startsWith(`${tempRoot}\\`) &&
    resolvedProfile
      .split(/[\\/]/)
      .at(-1)
      ?.startsWith("ninety-nine-owner-browser-")
  ) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3 });
  }
}
