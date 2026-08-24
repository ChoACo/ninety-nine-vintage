import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("owner payment reconciliation filters depositor buyer and amount locally", async () => {
  const payments = await source(
    "src/components/admin/operator/OperatorPaymentsConsole.tsx",
  );

  assert.match(payments, /function matchesPaymentSearch/);
  assert.match(payments, /payment\.lastDepositorName \?\? ""/);
  assert.match(payments, /payment\.buyerName/);
  assert.match(payments, /payment\.expectedAmount/);
  assert.match(payments, /payment\.receivedAmount/);
  assert.match(payments, /payment\.remainingAmount/);
  assert.match(payments, /useDeferredValue\(searchQuery\)/);
  assert.match(payments, /placeholder="입금자명 \/ 주문자명 \/ 입금액"/);
  assert.match(payments, /\{ownerSurface && \(/);
  assert.match(payments, /검색 조건과 일치하는 입금 요청이 없습니다/);
});

test("bank transfer CSV exports only audited approved payout accounts", async () => {
  const [route, button, desk] = await Promise.all([
    source("src/app/api/admin/owner/settlements/route.ts"),
    source("src/components/admin/owner/OwnerBankTransferExportButton.tsx"),
    source("src/components/admin/owner/OwnerPayoutDesk.tsx"),
  ]);

  assert.match(route, /if \(auth\.roleCode !== "owner"\)/);
  assert.match(route, /candidate\.status !== "draft"/);
  assert.match(route, /rpc\.rpc\("get_owner_payout_desk"\)/);
  assert.match(route, /rpc\.rpc\("reveal_owner_store_payout_account"/);
  assert.match(route, /p_reason: "은행 대량 이체 CSV 다운로드"/);
  assert.match(route, /decryptAccountNumber\(account\.ciphertext\)/);
  assert.match(route, /settlement_export_account_changed/);
  assert.match(route, /batch\.accountNumberMasked !== account\.accountNumberMasked/);
  assert.match(route, /if \(body\.action === "export"\)/);
  assert.match(button, /은행명/);
  assert.match(button, /계좌번호/);
  assert.match(button, /예금주/);
  assert.match(button, /이체금액/);
  assert.match(button, /\/\^\[=\+\\-@\]\//);
  assert.match(button, /`\\uFEFF\$\{createCsv\(rows\)\}`/);
  assert.match(button, /action: "export"/);
  assert.match(desk, /<OwnerBankTransferExportButton disabled=\{pending\.length === 0\}/);
});

test("emergency auction badges refresh current pause state and active impact count", async () => {
  const [route, control, migration] = await Promise.all([
    source("src/app/api/admin/owner/auctions/emergency/route.ts"),
    source("src/components/admin/owner/OwnerEmergencyAuctionControl.tsx"),
    source("supabase/migrations/20260822090253_add_owner_emergency_auction_control.sql"),
  ]);

  assert.match(route, /Promise\.all\(\[/);
  assert.match(route, /\.eq\("sale_type", "auction"\)/);
  assert.match(route, /\.eq\("status", "active"\)/);
  assert.match(route, /activeAuctionCount: activeAuctionResult\.count \?\? 0/);
  assert.match(control, /영향받는 진행 경매 \{activeAuctionCount\}건/);
  assert.match(control, /10초 자동 갱신/);
  assert.match(control, /10_000/);
  assert.match(control, /await loadState\(token\)/);
  assert.match(migration, /if not public\.is_owner\(\)/i);
  assert.match(migration, /owner_control_all_auctions/);
});
