import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root=new URL("../../",import.meta.url); const source=(path)=>readFile(new URL(path,root),"utf8");
const migrationPath="supabase/migrations/20260803173529_multi_operator_store_platform.sql";

test("store plans reserve KST AI usage atomically and reject bulk imports before partial writes",async()=>{
  const [migration,enhance,bulk]=await Promise.all([source(migrationPath),source("src/app/api/admin/operator/products/enhance/route.ts"),source("src/app/api/admin/operator/products/bulk/route.ts")]);
  assert.match(migration,/usage_date\s*=\s*timezone\('Asia\/Seoul'/i);
  assert.match(migration,/when subscriptions\.plan_code = 'pro' then 30[\s\S]*when subscriptions\.plan_code = 'standard' then 20/i);
  assert.match(migration,/when subscriptions\.plan_code = 'pro' then 60[\s\S]*when subscriptions\.plan_code = 'standard' then 40/i);
  assert.match(migration,/products_enforce_store_daily_quota/);
  assert.match(enhance,/reserve_store_ai_quota/);
  assert.match(bulk,/bulkImportEnabled/);
});

test("operator buyers can purchase other stores but every owned store is blocked in bid cart and checkout",async()=>{
  const migration=await source(migrationPath);
  assert.match(migration,/create table public\.commerce_buyer_accounts/);
  assert.match(migration,/can_purchase_product[\s\S]*not exists[\s\S]*store_memberships/i);
  assert.match(migration,/auction_bids_reject_own_store/);
  assert.match(migration,/cart_items_reject_own_store/);
  assert.match(migration,/commerce_order_items_reject_own_store/);
  assert.match(migration,/app_private\.create_commerce_order[\s\S]*can_purchase_product/i);
});

test("payment confirmation is owner-only and confirmed sales retain their origin store",async()=>{
  const [migration,payments,ledger]=await Promise.all([source(migrationPath),source("src/app/api/admin/operator/payments/route.ts"),source("src/app/api/admin/operator/transfers/[id]/ledger/route.ts")]);
  assert.match(migration,/can_confirm_shared_payment[\s\S]*public\.is_owner\(\)/i);
  assert.match(migration,/items\.origin_store_id,'item_sale'/);
  assert.match(payments,/auth\.roleCode !== "owner"/);
  assert.match(ledger,/auth\.roleCode !== "owner"/);
});

test("fulfillment groups share only shipment permissions and snapshot per-store or per-group shipping",async()=>{
  const migration=await source(migrationPath);
  assert.match(migration,/coalesce\(p_permission,''\)\)\) in \('prepare_orders','receive_at_center','create_shipments'\)/);
  assert.match(migration,/shipping_charge_mode text[\s\S]*per_store[\s\S]*per_group/);
  assert.match(migration,/commerce_order_shipping_fee_charge_key_idx/);
  assert.match(migration,/policy_snapshot/);
  assert.match(migration,/audit_group_fulfillment_proxy/);
});

test("settlements apply ceil five-percent commission, subscription deductions and reversal entries",async()=>{
  const [migration,payoutRoute]=await Promise.all([
    source(migrationPath),
    source("src/app/api/admin/owner/settlements/route.ts"),
  ]);
  assert.match(migration,/ceil\(inventory\.paid_amount\*0\.05\)/i);
  assert.match(migration,/extract\(isodow from p_settlement_date\) not in \(1,4\)/i);
  assert.match(migration,/entries\.eligible_at<=v_cutoff/);
  assert.match(migration,/subscription_deduction/);
  assert.match(migration,/project_store_refund_settlement/);
  assert.match(migration,/complete_owner_settlement_batch/);
  assert.match(payoutRoute,/auth\.user as unknown as RpcClient/);
  assert.doesNotMatch(payoutRoute,/auth\.admin as unknown as RpcClient/);
});

test("payout accounts are encrypted before RPC submission and monthly fees accrue by a protected daily cron",async()=>{
  const [crypto,route,migration]=await Promise.all([source("src/lib/settlement/payoutAccount.server.ts"),source("src/app/api/admin/operator/platform/route.ts"),source(migrationPath)]);
  assert.match(crypto,/aes-256-gcm/); assert.match(crypto,/PAYOUT_ACCOUNT_ENCRYPTION_KEY/);
  assert.match(crypto,/createDecipheriv/); assert.match(migration,/store_payout_account_access_events/);
  assert.match(route,/encryptAccountNumber/); assert.doesNotMatch(route,/p_account_number_ciphertext:account/);
  assert.match(migration,/accrue_store_subscription_fees/); assert.match(migration,/interval '7 days'/);
});

test("same-day feeds and public store filters use a hydration-stable seed",async()=>{
  const [feed,filters,service]=await Promise.all([source("src/components/features/auction/AuctionFeedGrid.tsx"),source("src/components/features/auction/AuctionFilterSidebar.tsx"),source("src/services/products.ts")]);
  assert.doesNotMatch(feed,/crypto\.randomUUID\(\)/); assert.match(feed,/const feedSeed = useMemo/); assert.match(feed,/Math\.imul\(hash/);
  assert.match(filters,/storeOptions/); assert.match(service,/storeName/); assert.match(service,/storeSlug/);
});
