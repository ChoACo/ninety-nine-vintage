import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const paymentIdSource = await readFile(
  new URL("../src/lib/portone/paymentId.ts", import.meta.url),
  "utf8",
);
const paymentIdModule = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(paymentIdSource, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).toString("base64")}`
);

test("creates PortOne-safe and collision-resistant payment IDs", () => {
  const productId = "30be08c2-6259-42c6-af26-4ded6362de12";
  const now = 1_721_234_567_890;
  const first = paymentIdModule.createPortOnePaymentId(
    productId,
    now,
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  );
  const second = paymentIdModule.createPortOnePaymentId(
    productId,
    now,
    "ffffffff-1111-4222-8333-444444444444",
  );

  assert.match(first, /^[A-Za-z0-9]{6,40}$/);
  assert.match(second, /^[A-Za-z0-9]{6,40}$/);
  assert.ok(first.length <= 40);
  assert.ok(second.length <= 40);
  assert.notEqual(first, second);
  assert.match(first, /^P30be08c262/);
});

test("truncates Korean order names at a UTF-8 byte boundary", async () => {
  const serverSource = await readFile(
    new URL("../src/lib/portone/server.ts", import.meta.url),
    "utf8",
  );
  const helperMatch = serverSource.match(
    /export function truncateUtf8Bytes[\s\S]*?\n}\n/,
  );
  assert.ok(helperMatch, "truncateUtf8Bytes helper should exist");

  const helperModule = await import(
    `data:text/javascript;base64,${Buffer.from(
      ts.transpileModule(helperMatch[0], {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    ).toString("base64")}`
  );
  const title = "빈티지 상품 ".repeat(20);
  const truncated = helperModule.truncateUtf8Bytes(title, 100);

  assert.ok(Buffer.byteLength(truncated, "utf8") <= 100);
  assert.ok(Buffer.byteLength(`${truncated}한`, "utf8") > 100);
  assert.ok(title.startsWith(truncated));
});

test("payment backend keeps API secrets server-only and verifies provider data", async () => {
  const [serverSource, webhookSource, migrationSource] = await Promise.all([
    readFile(new URL("../src/lib/portone/server.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/webhook/portone/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260718040000_add_portone_v2_payments.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(serverSource, /PORTONE_API_SECRET/);
  assert.doesNotMatch(serverSource, /VITE_PORTONE_API_SECRET/);
  assert.match(serverSource, /payment\.amount\.total/);
  assert.match(serverSource, /payment\.storeId/);
  assert.match(serverSource, /payment\.currency/);
  assert.match(webhookSource, /request\.text\(\)/);
  assert.match(webhookSource, /PortOne\.Webhook\.verify/);
  assert.match(webhookSource, /PORTONE_WEBHOOK_SECRET|WebhookSecret/);
  assert.match(migrationSource, /enable row level security/i);
  assert.match(migrationSource, /payment_status\s*=\s*'결제완료'/i);
});
