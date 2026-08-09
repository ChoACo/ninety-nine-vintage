# 01. Current State Audit

Stage-0 read-only audit. No source changes, no migrations executed, no production writes.

- **BASE COMMIT**: `c36a2db5f6a9a808fe0768a2c19927524c67ee89`
- **CURRENT HEAD**: `c36a2db5f6a9a808fe0768a2c19927524c67ee89`
- **WORKTREE STATUS**: clean (`## main...origin/main`, no diff, no untracked changes)
- **VERIFIED**:
  - Git baseline identical between BASE and CURRENT HEAD; `main` and `origin/main` point to the same commit (merge-base = HEAD).
  - Production Supabase linked project `bkwesxsznqupoqnwzzmn` is reachable and operational (`/api/site/status` → `{"status":"operational","dbConnected":true}`, checked 2026-08-08).
  - Shipping route (`src/app/api/shipping/requests/route.ts`) supports BOTH v2 (`inventoryItemIds` → `request_inventory_shipment`, authenticated user client) and legacy (`orderId` → `request_commerce_order_shipment`, admin/service-role client) request bodies, gated by exact-key matching.
  - Production cron is `/api/cron/storage-lifecycle` (`vercel.json`, schedule `0 3 * * *`, region `icn1`) and it performs a DIRECT Supabase `multi_provider_records` delete via service-role client. It does NOT call `BatchCleanupScheduler`.
- **UNVERIFIED**:
  - `20260807000000_cart_reservation_abuse_limits.sql` is LOCAL-ONLY. `npm run verify:migrations` fails with `FAIL migration parity (pending remote: 20260807000000)`. The migration (cap cart holds at three, rate limiting) has NOT been applied to the linked production database.
  - Production env values (R2 credentials, `OPENROUTER_API_KEY`, `CRON_SECRET`, capacity env vars, `GEMINI_*`) are not readable from this workspace. `process.env` runtime state in Vercel is not observable.
  - Actual production object-storage byte usage vs. `multi_provider_records` metadata rows cannot be confirmed from here.
  - BatchCleanupScheduler / MultiProviderRouter / ProductService have NO runtime call sites in `src/` (only definitions + tests), so their "active in production" status is unconfirmed by definition; they are dead code today.

## Per-Item Findings

### 1. Production DB vs. local migration parity — MISMATCH
`scripts/verify-migration-parity.mjs` (`npm run verify:migrations`) fails: `20260807000000_cart_reservation_abuse_limits.sql` is pending remote. `supabase migration list --linked` confirms the remote column is empty for `20260807000000`. This is the newest local migration (part of HEAD commit `c36a2db`), so production DB is one migration behind local. The migration's effect: cap cart holds at three per user, rate-limiting, and a 1-minute pg_cron cleanup job for expired cart_items (`20260807000000_cart_reservation_abuse_limits.sql` lines 157–165).

### 2. shipping_requests / commerce_shipments / inventory_shipments writers & readers — CODE_ONLY (verified in code; production behavior unverified)
- Writers:
  - `request_inventory_shipment`, `pack_inventory_shipment`, `ship_inventory_shipment` defined in `20260724063531_simplify_direct_store_fulfillment.sql` (lines 531, 872, 983), granted to `authenticated` (lines 1247–1257). This is the current v2 direct-store standard.
  - Canonical `request_commerce_order_shipment` defined in `20260722070000_activate_canonical_commerce_shipments.sql` (line 356), JWT service_role-only.
  - `shipping_requests` service_role `UPDATE` was revoked in `20260722070000` (~lines 2118–2138) along with legacy `request_product_shipping` / `mark_shipping_request_shipped` / `upsert_shipping_tracking_batch` / `get_shipping_work`.
- Readers:
  - `src/app/api/account/shipments/route.ts` unions a v2 CTE (`inventory_shipments` where business has `unified_inventory_reads_enabled`) with a legacy CTE (`commerce_shipments`). Dual-read confirmed in code.
  - `src/app/api/admin/operator/shipping/route.ts` (operator work list) and `src/app/api/admin/owner/shipping/[id]/route.ts` (tracking correction) exist.

### 3. Canonical shipment candidate — CODE_ONLY
Per `docs/next-work-sequence-report-20260805.md`, `commerce_shipments` is the canonical/compat model (`request_commerce_order_shipment` is canonical, service_role-only) while `inventory_shipments` is the current v2 standard used by members. Both are still written today: the UI (`AccountDashboard.tsx` requestShipping, ~line 692) still has a legacy `orderId` branch (lines 729–734) alongside the v2 branch (lines 722–728). No single canonical table is the only live writer.

### 4. Legacy writer & dual-write possibility — CODE_ONLY
Legacy `shipping_requests` write path is closed in code: service_role `UPDATE` revoked, legacy request functions revoked. But a dual-WRITE path still exists at the API layer: the member client sends either v2 or legacy body; the legacy body writes to `commerce_shipments` (not `shipping_requests`) via `request_commerce_order_shipment`. So today's dual-write is `inventory_shipments` (v2) vs `commerce_shipments` (legacy UI branch), not `shipping_requests`.

### 5. Mutation gate — CODE_ONLY
`20260805010000_enforce_inventory_shipment_mutation_gate.sql` adds trigger `inventory_shipments_mutation_gate` (before update on `inventory_shipments`) → `app_private.assert_inventory_shipment_mutation_gate()` requiring `is_owner()`, `has_business_permission('create_shipments')`, or `has_center_permission(fulfillment_center_id, 'create_shipments')` for packed/shipped/courier/tracking mutations. Migration is present locally and (per parity list) applied to production as of `20260805010000`; the trigger itself is code-verified.

### 6. Active multicloud provider — CODE_ONLY (verdict: Supabase only today)
`src/lib/multicloud/factory.ts` registers `supabase` unconditionally and `r2` ONLY if `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` are present. `GCS`/`S3` adapter classes exist in `adapters.ts` but are never registered. Local `.env.local` has no R2 credential keys, so locally the pool is Supabase-only. Production R2 presence cannot be verified from here.

### 7. Storage usage / capacity calculation — CODE_ONLY, with MISMATCH sub-note
- `src/lib/multicloud/storageUsage.ts` computes usage from `multi_provider_records` metadata (`sum(pg_column_size(payload))`, `record_count`) via `multi_provider_records_exec`, NOT real object bytes.
- Capacity defaults: Supabase `107374182400` (100GB), R2 `0` (`storageUsage.ts` lines 24–26). `src/lib/multicloud/r2.ts` default R2 capacity is `10737418240` (10GB) — mismatched defaults between files.
- `.env.example` declares SUPABASE `1073741824` (1GB) and R2 `10737418240` (10GB); `.env.local` masks show `MULTICLOUD_SUPABASE_CAPACITY_BYTES=107374***` and `MULTICLOUD_R2_CAPACITY_BYTES=107374***`. Effective capacity is therefore a code/env mix and cannot be pinned down without real env values. `factory.ts` `supabaseUsageProbe` reports `capacityBytes: Number.POSITIVE_INFINITY` and object-list count (limit 1) as used bytes — this diverges from `storageUsage.ts`'s metadata-based numbers, so the admin gauge and the router's usage probe disagree by construction.

### 8. Rollover runtime path — CODE_ONLY (no live caller)
`MultiProviderRouter` (`src/lib/multicloud/MultiProviderRouter.ts`) implements round-robin storage selection with a 0.9 capacity threshold and per-provider circuit breaker (3 failures / 30s cooldown). `ProductService.ts` is documented as an example service. Real product-image uploads go direct to Supabase storage (`src/lib/supabase/products.ts`), not through the router. `getMultiCloudPool` has no callers in `src/app` or `src/lib` outside the multicloud module itself.

### 9. BatchCleanupScheduler invocation — MISMATCH (documented vs actual)
`src/lib/multicloud/BatchCleanupScheduler.ts` defines the scheduler but has NO runtime caller (only referenced in tests and by `ProductService` type). The ACTUAL production cleanup cron is `src/app/api/cron/storage-lifecycle/route.ts`, which directly deletes expired `multi_provider_records` with a service-role Supabase client and is authenticated by `Bearer CRON_SECRET`. `resetMultiCloudPool()` (factory.ts line 98) is likewise never called.

### 10. AI provider/model call path — CODE_ONLY (provider is OpenRouter, not Google)
`src/lib/ai/aiModelRouter.ts` calls `https://openrouter.ai/api/v1/chat/completions` with models `google/gemini-3.5-flash` (primary), `nvidia/nemotron-nano-12b-v2-vl:free`, `qwen/qwen3-vl-8b-instruct`. `GeminiProductEnhancer.server.ts` delegates to `routeCompletion` — so the runtime AI path is OpenRouter regardless of the "Gemini" naming. `GEMINI_API_KEY`/`GEMINI_MODEL` env keys exist in `.env.example`/`.env.local` but are NOT read by any runtime code path (no `process.env.GEMINI` references in `src/lib/ai`). Requires `OPENROUTER_API_KEY`.

### 11. AI fallback & usage logging — CODE_ONLY
- Fallback: `routeCompletion` iterates `MODELS` in order, retrying/falling through on retryable status codes (401, 402, 408, 429, 500, 502, 503, 504); non-retryable statuses throw immediately; final failure throws after all models. `GeminiProductEnhancer.enhance` wraps this with up to 3 attempts + exponential backoff, returning `normalizeResponse({}, source)` (empty-enhancement fallback) on total failure.
- Logging: `tokenTracker.ts` `logTokenUsage` inserts into `ai_token_usage_logs` (provider default `openrouter`, model, endpoint, prompt/completion/total tokens). No success/fallback/failure status column exists; `getMonthlyTokenUsage` (owner route `/api/admin/owner/token-usage`) infers `primaryCalls` vs `fallbackCalls` by string-equality of `model` to `google/gemini-3.5-flash`, and hardcodes the same primary model string. `MONTHLY_TOKEN_LIMIT = 1_000_000`.

### 12. Not verifiable from production
- Real env secrets: `OPENROUTER_API_KEY`, `CRON_SECRET`, R2 credentials, GEMINI keys, multicloud capacity env vars in Vercel.
- Whether `20260807000000` has since been applied (it has not, as of this audit's parity check).
- Real per-provider object byte usage vs. metadata-derived usage.
- RLS behavior of `ai_token_usage_logs` INSERT from the publishable-key client (`logTokenUsage` uses `createSupabasePublicClient`; the migration grants `SELECT` to `authenticated` via `owners_can_read_usage_logs`, so INSERT privilege/behavior in production is unverified).
- pg_cron job list on the production DB (e.g. `cart-expired-holds` cleanup from the pending migration, `inventory-delivery-retention` at `15 * * * *`, `clear-expired-manual-refund-accounts` at `17 * * * *`, `security-retention-cleanup`, `auction-drop-maintenance`, `process-auction-purchase-offers`).

## Recommended Next Steps
1. Apply `20260807000000_cart_reservation_abuse_limits.sql` to production (currently the only parity gap) and re-run `npm run verify:migrations` until green.
2. Decide whether the multicloud library (`MultiProviderRouter`/`ProductService`/`BatchCleanupScheduler`) is intended to be live. Today it is dead code; the storage-lifecycle cron duplicates a subset of its intent with direct DB deletes.
3. Reconcile capacity defaults (`storageUsage.ts` vs `r2.ts` vs `.env.example`) and the two different "usage" measurements (metadata-based vs. object-list-based).
4. Confirm production AI path uses OpenRouter and that `GEMINI_API_KEY`/`GEMINI_MODEL` are unused; align naming or wire real Gemini if intended.
5. Verify `ai_token_usage_logs` INSERT works under RLS for the publishable client, or switch `logTokenUsage` to an authenticated/admin path.
