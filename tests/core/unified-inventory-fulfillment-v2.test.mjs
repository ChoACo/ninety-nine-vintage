import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");
const migrationPath =
  "supabase/migrations/20260722084550_add_unified_inventory_fulfillment_v2.sql";
const advancedLedgerMigrationPath =
  "supabase/migrations/20260722120747_add_v2_shipping_fee_advanced_ledger.sql";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sqlFunction(sql, name, schema = "public") {
  const startPattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escapeRegExp(schema)}\\.${escapeRegExp(name)}\\s*\\(`,
    "i",
  );
  const match = startPattern.exec(sql);
  assert.ok(match, `${schema}.${name} must be declared`);
  const end = sql.indexOf("$$;", match.index);
  assert.notEqual(end, -1, `${schema}.${name} must have a closed dollar body`);
  return sql.slice(match.index, end + 3);
}

function tableDefinition(sql, table) {
  const startPattern = new RegExp(
    `create\\s+table\\s+public\\.${escapeRegExp(table)}\\s*\\(`,
    "i",
  );
  const match = startPattern.exec(sql);
  assert.ok(match, `public.${table} must be declared`);
  const end = sql.indexOf("\n);", match.index);
  assert.notEqual(end, -1, `public.${table} must have a closed definition`);
  return sql.slice(match.index, end + 3);
}

test("v2 aggregate tables are RPC-only and force RLS without service-role DML", async () => {
  const migration = await source(migrationPath);
  const requiredTables = [
    "store_fulfillment_routes",
    "store_fulfillment_route_events",
    "fulfillment_center_staff_assignments",
    "inventory_fulfillment_rollout_settings",
    "inventory_command_receipts",
    "customer_inventory_items",
    "inventory_item_fulfillments",
    "inventory_item_fulfillment_events",
    "inventory_shipments",
    "inventory_shipment_items",
    "inventory_shipment_store_works",
    "inventory_shipment_events",
    "inventory_exception_cases",
    "inventory_exception_events",
    "manual_refunds",
    "manual_refund_accounts",
    "manual_refund_events",
    "manual_refund_disbursements",
    "shipping_fee_refunds",
    "shipping_fee_refund_disbursements",
    "shipping_fee_refund_accounts",
    "shipping_fee_refund_events",
    "shipping_fee_waiver_entitlements",
    "store_financial_entries",
  ];
  const tables = [
    ...migration.matchAll(/create\s+table\s+public\.([a-z0-9_]+)\s*\(/gi),
  ].map((match) => match[1]);
  for (const table of requiredTables) {
    assert.ok(tables.includes(table), `public.${table} must be declared`);
  }

  const tableRevoke = [
    ...migration.matchAll(
      /revoke\s+all\s+on\s+(?!function\b)([\s\S]*?)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*;/gi,
    ),
  ].map((match) => match[1]).join("\n");
  assert.ok(tableRevoke, "v2 tables must have a direct-privilege revoke");

  for (const table of tables) {
    assert.match(
      migration,
      new RegExp(`create\\s+table\\s+public\\.${escapeRegExp(table)}\\b`, "i"),
    );
    assert.match(
      migration,
      new RegExp(
        `alter\\s+table\\s+public\\.${escapeRegExp(table)}\\s+enable\\s+row\\s+level\\s+security`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `alter\\s+table\\s+public\\.${escapeRegExp(table)}\\s+force\\s+row\\s+level\\s+security`,
        "i",
      ),
    );
    assert.match(
      tableRevoke,
      new RegExp(`public\\.${escapeRegExp(table)}\\b`, "i"),
      `${table} must be inaccessible through direct API DML`,
    );
  }

  const serviceRoleSelect = [
    ...migration.matchAll(
      /grant\s+select\s+on\s+([\s\S]*?)\s+to\s+service_role\s*;/gi,
    ),
  ].map((match) => match[1]).join("\n");
  assert.match(serviceRoleSelect, /public\.manual_refund_accounts/i);
  assert.match(serviceRoleSelect, /public\.shipping_fee_refund_accounts/i);
  assert.doesNotMatch(
    migration,
    /grant\s+(?:insert|update|delete|all)[^;]*(?:manual_refund_accounts|shipping_fee_refund_accounts)[^;]*service_role/i,
  );
});

test("paid inventory ownership is exactly-once, source-bound, immutable, and store-attributed", async () => {
  const migration = await source(migrationPath);
  const inventory = tableDefinition(migration, "customer_inventory_items");
  const projector = sqlFunction(
    migration,
    "create_customer_inventory_entitlement",
    "app_private",
  );
  const triggerProjector = sqlFunction(
    migration,
    "project_inventory_entitlement",
    "app_private",
  );

  assert.match(
    inventory,
    /num_nonnulls\(commerce_order_item_id,\s*manual_transfer_order_id,\s*legacy_payment_order_id\)\s*=\s*1/i,
  );
  assert.match(inventory, /source_kind\s+in\s*\('commerce',\s*'auction',\s*'legacy_portone'\)/i);
  for (const [index, column] of [
    ["customer_inventory_items_commerce_source_idx", "commerce_order_item_id"],
    ["customer_inventory_items_auction_source_idx", "manual_transfer_order_id"],
    ["customer_inventory_items_legacy_source_idx", "legacy_payment_order_id"],
  ]) {
    assert.match(
      migration,
      new RegExp(
        `create\\s+unique\\s+index\\s+${index}[\\s\\S]{0,180}\\(${column}\\)[\\s\\S]{0,100}where\\s+${column}\\s+is\\s+not\\s+null`,
        "i",
      ),
    );
  }
  assert.match(
    migration,
    /create\s+unique\s+index\s+customer_inventory_items_active_product_idx[\s\S]{0,180}\(product_id\)[\s\S]{0,100}where\s+ownership_status\s+in\s*\('active',\s*'refund_pending'\)/i,
  );
  assert.match(projector, /if\s+p_source_kind\s*=\s*'commerce'/i);
  assert.match(projector, /elsif\s+p_source_kind\s*=\s*'auction'/i);
  assert.match(projector, /elsif\s+p_source_kind\s*=\s*'legacy_portone'/i);
  assert.match(projector, /from\s+public\.store_fulfillment_routes/i);
  assert.match(
    projector,
    /inventory_fulfillment_rollout_settings[\s\S]{0,200}entitlement_projection_enabled/i,
  );
  assert.match(projector, /on\s+conflict\s+do\s+nothing/i);
  assert.match(projector, /'reconciliation_required'/i);
  assert.match(projector, /else\s+'entitled'\s+end/i);
  assert.match(
    projector,
    /greatest\(v_closes_at,\s*coalesce\(v_paid_at,\s*clock_timestamp\(\)\)\)\s+at\s+time\s+zone\s+'Asia\/Seoul'[\s\S]{0,80}::date\s*\+\s*1/i,
  );
  assert.match(
    projector,
    /insert\s+into\s+public\.store_financial_entries[\s\S]*?'item_payment'/i,
  );
  assert.match(
    migration,
    /create\s+trigger\s+customer_inventory_items_guard_snapshot[\s\S]{0,160}app_private\.guard_inventory_item_snapshot/i,
  );
  for (const trigger of [
    "commerce_order_items_project_inventory",
    "manual_transfer_orders_project_inventory",
    "payment_orders_project_inventory",
  ]) {
    assert.match(migration, new RegExp(`create\\s+trigger\\s+${trigger}`, "i"));
  }
  assert.match(
    triggerProjector,
    /if\s+tg_table_name\s*=\s*'commerce_order_items'\s+then[\s\S]{0,220}new\.payment_status/i,
  );
  assert.match(
    triggerProjector,
    /elsif\s+tg_table_name\s*=\s*'manual_transfer_orders'\s+then[\s\S]{0,220}new\.status/i,
  );
  assert.match(
    triggerProjector,
    /elsif\s+tg_table_name\s*=\s*'payment_orders'\s+then[\s\S]{0,220}new\.portone_status/i,
  );
  assert.match(
    migration,
    /reject_inventory_paid_source_reversal[\s\S]*수동 환불 절차를 사용해 주세요/i,
  );
});

test("rollout flags default closed, require explicit Owner CAS, and expose operational health", async () => {
  const migration = await source(migrationPath);
  const settings = tableDefinition(
    migration,
    "inventory_fulfillment_rollout_settings",
  );
  const configure = sqlFunction(
    migration,
    "configure_inventory_fulfillment_rollout",
  );
  const health = sqlFunction(migration, "get_inventory_operational_health");
  const overview = sqlFunction(migration, "get_my_inventory_overview");
  const request = sqlFunction(migration, "request_inventory_shipment");

  assert.match(settings, /entitlement_projection_enabled\s+boolean\s+not\s+null\s+default\s+false/i);
  assert.match(settings, /unified_inventory_reads_enabled\s+boolean\s+not\s+null\s+default\s+false/i);
  assert.match(settings, /item_selected_shipments_enabled\s+boolean\s+not\s+null\s+default\s+false/i);
  assert.match(settings, /shipping_fee_amount\s+bigint\s+not\s+null/i);
  assert.match(configure, /not\s+public\.is_owner\(\)/i);
  assert.match(configure, /v_s\.version\s*<>\s*p_expected_version/i);
  assert.match(configure, /p_item_selected_shipments_enabled[\s\S]{0,400}store_fulfillment_routes/i);
  assert.match(configure, /p_entitlement_projection_enabled[\s\S]*create_customer_inventory_entitlement/i);
  assert.match(overview, /'rolloutEnabled',\s*coalesce\(bool_or\(rs\.unified_inventory_reads_enabled\)/i);
  assert.match(overview, /'itemSelectedShipmentsEnabled',\s*rs\.item_selected_shipments_enabled/i);
  assert.match(overview, /where\s+i\.member_id\s*=\s*auth\.uid\(\)\s+and\s+rs\.unified_inventory_reads_enabled/i);
  assert.match(request, /item_selected_shipments_enabled/i);
  for (const metric of [
    "reconciliationRequired",
    "blockedItems",
    "overdueItems",
    "openExceptions",
    "pendingRefunds",
    "pendingShippingFees",
  ]) {
    assert.match(health, new RegExp(`'${metric}'`, "i"));
  }
});

test("shipment reservations are item-level, unique while active, and preserve immutable store manifests", async () => {
  const migration = await source(migrationPath);
  const request = sqlFunction(migration, "request_inventory_shipment");
  const overview = sqlFunction(migration, "get_my_inventory_overview");

  assert.match(
    migration,
    /create\s+unique\s+index\s+inventory_shipment_items_one_active_idx[\s\S]{0,180}\(inventory_item_id\)[\s\S]{0,120}where\s+line_status\s+in\s*\('requested',\s*'held',\s*'ready',\s*'packed'\)/i,
  );
  assert.match(
    request,
    /coalesce\(cardinality\(p_inventory_item_ids\),\s*0\)\s+not\s+between\s+1\s+and\s+100/i,
  );
  assert.match(
    request,
    /cardinality\(p_inventory_item_ids\)\s*<>\s*cardinality\(array\(select\s+distinct/i,
  );
  assert.match(
    request,
    /perform\s+1\s+from\s+public\.customer_inventory_items[\s\S]{0,120}order\s+by\s+id\s+for\s+update/i,
  );
  assert.match(request, /member_id\s*<>\s*v_actor/i);
  assert.match(request, /business_id\s*<>\s*v_business/i);
  assert.match(request, /fulfillment_center_id\s+is\s+distinct\s+from\s+v_center/i);
  assert.match(request, /ownership_status\s*<>\s*'active'/i);
  assert.match(request, /current_stage\s+not\s+in\s*\('entitled',\s*'preparing',\s*'center_received',\s*'center_stored'\)/i);
  assert.match(overview, /current_stage\s+in\s*\('entitled',\s*'preparing',\s*'center_received',\s*'center_stored'\)/i);
  assert.match(request, /insert\s+into\s+public\.inventory_shipments/i);
  assert.match(request, /insert\s+into\s+public\.inventory_shipment_items/i);
  assert.match(
    request,
    /insert\s+into\s+public\.inventory_shipment_store_works[\s\S]{0,700}group\s+by[\s\S]{0,180}origin_store_id/i,
  );
  assert.doesNotMatch(request, /request_commerce_order_shipment|commerce_shipment_orders/);
});

test("A transfer and co-located store work both require explicit release and center storage", async () => {
  const migration = await source(migrationPath);
  const configure = sqlFunction(migration, "configure_store_fulfillment_route");
  const configureCenterStaff = sqlFunction(
    migration,
    "configure_fulfillment_center_staff_assignment",
  );
  const centerPermission = sqlFunction(
    migration,
    "has_center_permission",
    "app_private",
  );
  const paidQueue = sqlFunction(migration, "get_paid_inventory_store_queue");
  const releasePaid = sqlFunction(migration, "release_paid_inventory_items");
  const release = sqlFunction(migration, "release_inventory_shipment_items");
  const center = sqlFunction(migration, "record_inventory_center_items");

  assert.match(migration, /route_mode\s+text\s+not\s+null\s+check\s*\(route_mode\s+in\s*\('transfer',\s*'co_located'\)\)/i);
  assert.match(configure, /not\s+public\.is_owner\(\)/i);
  assert.match(configure, /p_route_mode\s+not\s+in\s*\('transfer',\s*'co_located'\)/i);
  assert.match(configure, /v_route\.version\s+is\s+distinct\s+from\s+p_expected_version/i);
  assert.match(configureCenterStaff, /not\s+public\.is_owner\(\)/i);
  assert.match(configureCenterStaff, /p_receive_at_center/i);
  assert.match(configureCenterStaff, /p_create_shipments/i);
  assert.match(configureCenterStaff, /p_expected_version/i);
  assert.match(centerPermission, /a\.user_id\s*=\s*auth\.uid\(\)/i);
  assert.match(centerPermission, /a\.fulfillment_center_id\s*=\s*p_fulfillment_center_id/i);
  assert.match(centerPermission, /public\.has_business_permission\(a\.business_id,\s*'receive_at_center'\)/i);
  assert.match(centerPermission, /public\.has_business_permission\(a\.business_id,\s*'create_shipments'\)/i);
  assert.match(paidQueue, /current_stage[\s\S]{0,80}'entitled'/i);
  assert.match(paidQueue, /work_due_date/i);
  assert.match(releasePaid, /'entitled'/i);
  assert.match(releasePaid, /order\s+by\s+inventory_item_id\s+for\s+update/i);
  assert.match(releasePaid, /public\.has_store_permission\(i\.origin_store_id,\s*'prepare_orders'\)/i);
  assert.match(releasePaid, /route_mode\s*=\s*'transfer'\s+then\s+'in_transit_to_center'/i);
  assert.match(releasePaid, /else\s+'center_received'/i);
  assert.match(release, /public\.has_store_permission\(v_work\.origin_store_id,\s*'prepare_orders'\)/i);
  assert.match(
    release,
    /route_mode\s*=\s*'transfer'\s+then\s+'in_transit_to_center'/i,
  );
  assert.match(release, /then\s+'center_received'/i);
  assert.match(release, /outbound_released\s*=\s*true/i);
  assert.match(release, /not\s+f\.outbound_released/i);
  assert.match(release, /'outbound_complete'/i);
  assert.match(center, /p_action\s+not\s+in\s*\('receive',\s*'store'\)/i);
  assert.match(center, /app_private\.has_center_permission\(v_center,\s*'receive_at_center'\)/i);
  assert.match(center, /f\.version\s*<>\s*z\.ver/i);
  assert.match(center, /case\s+when\s+p_action\s*=\s*'receive'\s+then\s+'center_received'\s+else\s+'center_stored'/i);
  assert.match(
    center,
    /storage_started_at\s*=\s*coalesce\(storage_started_at,\s*v_now\)/i,
  );
  assert.match(
    center,
    /storage_expires_at\s*=\s*coalesce\(storage_expires_at,\s*v_now\s*\+\s*make_interval\(days\s*=>\s*storage_duration_days\)\)/i,
  );
  assert.doesNotMatch(migration, /['"](?:A|B)\s*매장['"]/i);
});

test("packing and dispatch enforce settlement, release, storage, exception, and tracking gates", async () => {
  const migration = await source(migrationPath);
  const refresh = sqlFunction(
    migration,
    "refresh_inventory_shipment_status",
    "app_private",
  );
  const pack = sqlFunction(migration, "pack_inventory_shipment");
  const ship = sqlFunction(migration, "ship_inventory_shipment");
  const shippingFeeRefund = sqlFunction(
    migration,
    "review_shipping_fee_refund",
  );

  assert.match(pack, /v_sh\.status\s*<>\s*'ready_to_pack'/i);
  assert.match(pack, /shipping_fee_payments[\s\S]*status\s*=\s*'confirmed'/i);
  assert.match(pack, /x\.line_status\s+not\s+in\s*\('excluded',\s*'cancelled'\)/i);
  assert.match(pack, /x\.line_status\s*<>\s*'ready'/i);
  assert.match(pack, /f\.current_stage\s*<>\s*'center_stored'/i);
  assert.match(pack, /f\.is_blocked/i);
  assert.match(
    pack,
    /not\s+exists[\s\S]{0,180}line_status\s+not\s+in\s*\('excluded',\s*'cancelled'\)/i,
  );
  assert.match(pack, /message\s*=\s*'미 출고된 상품이 존재합니다'/i);
  assert.match(ship, /v_sh\.status\s*<>\s*'packed'/i);
  assert.match(ship, /p_expected_version/i);
  assert.match(ship, /p_courier/i);
  assert.match(ship, /p_tracking_number/i);
  assert.match(
    migration,
    /create\s+unique\s+index\s+inventory_shipments_tracking_idx[\s\S]{0,180}lower\(btrim\(courier\)\)[\s\S]{0,100}btrim\(tracking_number\)[\s\S]{0,100}where\s+status\s*=\s*'shipped'/i,
  );

  assert.match(refresh, /if\s+v_active\s*=\s*0\s+then/i);
  assert.match(refresh, /shipping_credit_count\s*=\s*shipping_credit_count\s*\+\s*1/i);
  assert.match(refresh, /shipping_fee_waiver_entitlements\s+set\s+status\s*=\s*'available'/i);
  assert.match(refresh, /insert\s+into\s+public\.shipping_fee_refunds/i);
  assert.match(refresh, /cancellation_reason\s*=\s*'all_lines_excluded'/i);
  assert.match(shippingFeeRefund, /not\s+public\.is_owner\(\)/i);
  assert.match(shippingFeeRefund, /p_action\s*<>\s*'complete'/i);
  assert.doesNotMatch(shippingFeeRefund, /shipping_fee_refunds\s+set\s+status\s*=\s*'cancelled'/i);
  assert.match(shippingFeeRefund, /insert\s+into\s+public\.shipping_fee_refund_disbursements/i);
  assert.match(shippingFeeRefund, /entry_type,\s*amount[\s\S]{0,180}'reversal',\s*v_ref\.amount/i);
  assert.match(shippingFeeRefund, /'shipping_fee_refund',\s*-v_ref\.amount/i);
});

test("buyer shipment history unions v2 and canonical transition records without inventing locations", async () => {
  const migration = await source(migrationPath);
  const history = sqlFunction(migration, "get_my_inventory_shipments");

  assert.match(history, /with\s+v2\s+as\s*\(/i);
  assert.match(history, /legacy\s+as\s*\(/i);
  assert.match(history, /from\s+public\.inventory_shipments/i);
  assert.match(history, /from\s+public\.commerce_shipments/i);
  assert.match(history, /'sourceKind',\s*'inventory_v2'/i);
  assert.match(history, /'sourceKind',\s*'canonical_commerce'/i);
  assert.match(history, /'trackingUrl'/i);
  assert.match(history, /union\s+all/i);
  assert.match(history, /sh\.member_id\s*=\s*auth\.uid\(\)/i);
  assert.match(history, /'legacy_in_progress'/i);
});

test("shared payment confirmation covers commerce, auction, and shipping fees with versioned full-balance CAS", async () => {
  const migration = await source(migrationPath);
  const queue = sqlFunction(migration, "get_unified_manual_payment_queue");
  const confirm = sqlFunction(migration, "confirm_unified_manual_payment");

  assert.match(queue, /'commerce'::text\s+"paymentKind"/i);
  assert.match(queue, /union\s+all[\s\S]*?'auction'/i);
  assert.match(queue, /union\s+all[\s\S]*?'shipping_fee'/i);
  assert.match(queue, /"expectedAmount"/i);
  assert.match(queue, /"receivedAmount"/i);
  assert.match(queue, /"remainingAmount"/i);
  assert.match(queue, /"ledgerEntryCount"/i);
  assert.match(queue, /\b[tmf]\.version\b/i);
  assert.match(queue, /app_private\.can_confirm_shared_payment\(/i);
  assert.match(
    migration,
    /create or replace function app_private\.can_confirm_shared_payment[\s\S]*public\.has_business_permission\(p_business_id,\s*'confirm_payments'\)[\s\S]*fulfillment_center_staff_assignments/i,
  );
  assert.doesNotMatch(queue, /fulfillment_center_id\s*=/i);

  assert.match(confirm, /p_payment_kind\s+not\s+in\s*\('commerce',\s*'auction',\s*'shipping_fee'\)/i);
  assert.match(confirm, /p_expected_version/i);
  assert.match(confirm, /p_observed_received_amount/i);
  assert.match(confirm, /p_observed_ledger_entry_count/i);
  assert.match(confirm, /for\s+update/i);
  assert.match(confirm, /v_expected\s*-\s*v_received/i);
  assert.match(confirm, /insert\s+into\s+public\.manual_transfer_payment_ledger/i);
  assert.doesNotMatch(confirm, /public\.record_manual_transfer_payment\(/i);
  assert.match(confirm, /public\.confirm_commerce_order_transfer\(v_order\)/i);
  assert.match(confirm, /update\s+public\.manual_transfer_orders[\s\S]{0,180}status\s*=\s*'confirmed'/i);
  assert.match(confirm, /insert\s+into\s+public\.store_financial_entries[\s\S]*?'shipping_fee'/i);
  assert.match(confirm, /'confirm_payment'/i);
});

test("exceptions defer one-use waivers until a partial shipment actually dispatches", async () => {
  const migration = await source(migrationPath);
  const open = sqlFunction(migration, "open_inventory_exception");
  const appendEvidence = sqlFunction(
    migration,
    "append_inventory_exception_evidence",
  );
  const resolve = sqlFunction(migration, "resolve_inventory_exception");
  const ship = sqlFunction(migration, "ship_inventory_shipment");

  assert.match(
    migration,
    /kind\s+text\s+not\s+null\s+check\s*\(kind\s+in\s*\('inspection_required',\s*'missing',\s*'offline_sold',\s*'additional_wait',\s*'refund_required'\)\)/i,
  );
  assert.match(
    migration,
    /resolution\s+text\s+check\s*\(resolution\s+in\s*\('resume',\s*'exclude_for_later',\s*'refund'\)\)/i,
  );
  assert.match(open, /is_blocked\s*=\s*true/i);
  assert.match(open, /line_status\s*=\s*'held'/i);
  assert.match(open, /review_due_at/i);
  assert.match(resolve, /p_resolution\s*=\s*'resume'/i);
  assert.match(resolve, /p_resolution\s*=\s*'exclude_for_later'/i);
  assert.match(resolve, /v_case\.kind\s+in\s*\('offline_sold',\s*'refund_required'\)\s+and\s+p_resolution\s*<>\s*'refund'/i);
  assert.match(resolve, /ownership_status\s*=\s*'refund_pending'/i);
  assert.match(resolve, /insert\s+into\s+public\.manual_refunds/i);
  assert.doesNotMatch(resolve, /insert\s+into\s+public\.shipping_fee_waiver_entitlements/i);
  assert.match(ship, /insert\s+into\s+public\.shipping_fee_waiver_entitlements/i);
  assert.match(ship, /e\.resolution\s*=\s*'exclude_for_later'/i);
  assert.match(resolve, /perform\s+app_private\.refresh_inventory_shipment_status/i);
  assert.match(
    migration,
    /exception_case_id\s+uuid\s+not\s+null\s+unique[\s\S]{0,220}status\s+text\s+not\s+null\s+default\s+'available'/i,
  );

  assert.match(appendEvidence, /v_case\.status\s*<>\s*'open'/i);
  assert.match(appendEvidence, /inventory-exception-evidence/i);
  assert.match(appendEvidence, /v_case\.business_id::text/i);
  assert.match(appendEvidence, /v_case\.id::text/i);
  assert.match(appendEvidence, /evidence_paths\s*=\s*array_append/i);
});

test("manual refunds are Owner-approved, use a separate outbound ledger, and erase account secrets", async () => {
  const migration = await source(migrationPath);
  const accounts = tableDefinition(migration, "manual_refund_accounts");
  const submit = sqlFunction(migration, "submit_manual_refund_account");
  const auditAccess = sqlFunction(
    migration,
    "record_manual_refund_account_access",
  );
  const review = sqlFunction(migration, "review_manual_refund");

  for (const column of [
    "account_ciphertext",
    "account_initialization_vector",
    "account_authentication_tag",
    "account_key_version",
    "account_fingerprint",
    "masked_account_number",
    "account_expires_at",
    "cleared_at",
  ]) {
    assert.match(accounts, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.doesNotMatch(accounts, /\bbank_name\b|\baccount_holder\b|\baccount_number\b/i);
  assert.match(submit, /v_ref\.member_id\s*<>\s*v_actor/i);
  assert.match(submit, /v_ref\.status\s*<>\s*'requested'/i);
  assert.match(submit, /v_now\s*\+\s*interval\s+'30 days'/i);
  assert.match(auditAccess, /not\s+public\.is_owner\(\)/i);
  assert.match(auditAccess, /'account_accessed'/i);
  assert.match(review, /not\s+public\.is_owner\(\)/i);
  assert.match(review, /p_action\s+not\s+in\s*\('approve',\s*'complete',\s*'cancel'\)/i);
  assert.match(review, /insert\s+into\s+public\.manual_refund_disbursements/i);
  assert.match(review, /delete\s+from\s+public\.manual_refund_accounts\s+where\s+refund_id\s*=\s*v_ref\.id/i);
  assert.match(review, /entry_kind,\s*amount[\s\S]{0,220}'item_refund',\s*-v_ref\.amount/i);
  assert.match(review, /'partially_refunded'\s+else\s+'refunded'/i);
  assert.match(review, /'refund_id',\s*v_ref\.id/i);
});

test("shipping-fee refunds require an encrypted buyer account and audited Owner disbursement", async () => {
  const migration = await source(migrationPath);
  const accounts = tableDefinition(migration, "shipping_fee_refund_accounts");
  const submit = sqlFunction(migration, "submit_shipping_fee_refund_account");
  const auditAccess = sqlFunction(
    migration,
    "record_shipping_fee_refund_account_access",
  );
  const review = sqlFunction(migration, "review_shipping_fee_refund");
  const expire = sqlFunction(
    migration,
    "clear_expired_manual_refund_accounts",
    "app_private",
  );

  for (const column of [
    "account_ciphertext",
    "account_initialization_vector",
    "account_authentication_tag",
    "account_key_version",
    "account_fingerprint",
    "masked_account_number",
    "account_expires_at",
  ]) {
    assert.match(accounts, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.doesNotMatch(accounts, /\bbank_name\b|\baccount_holder\b|\baccount_number\b/i);
  assert.match(submit, /v_ref\.member_id\s*<>\s*v_actor/i);
  assert.match(submit, /v_ref\.status\s*<>\s*'requested'/i);
  assert.match(submit, /v_now\s*\+\s*interval\s+'30 days'/i);
  assert.match(auditAccess, /not\s+public\.is_owner\(\)/i);
  assert.match(auditAccess, /'account_accessed'/i);
  assert.match(review, /not\s+public\.is_owner\(\)/i);
  assert.match(
    review,
    /exists\s*\(select\s+1\s+from\s+public\.shipping_fee_refund_accounts[\s\S]{0,220}account_expires_at\s*>\s*(?:v_now|clock_timestamp\(\))/i,
  );
  assert.match(review, /insert\s+into\s+public\.shipping_fee_refund_disbursements/i);
  assert.match(review, /delete\s+from\s+public\.shipping_fee_refund_accounts\s+where\s+shipping_fee_refund_id\s*=\s*v_ref\.id/i);
  assert.match(expire, /delete\s+from\s+public\.manual_refund_accounts/i);
  assert.match(expire, /delete\s+from\s+public\.shipping_fee_refund_accounts/i);
});

test("all public v2 RPCs pin search_path and receive explicit authenticated grants", async () => {
  const migration = await source(migrationPath);
  const requiredRpcNames = [
    "configure_store_fulfillment_route",
    "configure_fulfillment_center_staff_assignment",
    "configure_inventory_fulfillment_rollout",
    "get_inventory_operational_health",
    "reconcile_inventory_item_route",
    "get_paid_inventory_store_queue",
    "release_paid_inventory_items",
    "get_unified_manual_payment_queue",
    "confirm_unified_manual_payment",
    "get_my_inventory_overview",
    "request_inventory_shipment",
    "get_inventory_store_work_queue",
    "release_inventory_shipment_items",
    "get_inventory_center_queue",
    "record_inventory_center_items",
    "get_inventory_shipment_queue",
    "pack_inventory_shipment",
    "ship_inventory_shipment",
    "get_my_inventory_shipments",
    "get_inventory_exception_candidates",
    "get_inventory_exception_queue",
    "open_inventory_exception",
    "append_inventory_exception_evidence",
    "resolve_inventory_exception",
    "submit_manual_refund_account",
    "get_my_manual_refunds",
    "get_manual_refund_queue",
    "submit_shipping_fee_refund_account",
    "record_shipping_fee_refund_account_access",
    "record_manual_refund_account_access",
    "review_manual_refund",
    "get_store_financial_report",
    "get_shipping_fee_refund_queue",
    "review_shipping_fee_refund",
  ];
  const rpcNames = [
    ...migration.matchAll(
      /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi,
    ),
  ].map((match) => match[1]);
  for (const name of requiredRpcNames) {
    assert.ok(rpcNames.includes(name), `public.${name} must be declared`);
  }

  for (const name of rpcNames) {
    const declaration = sqlFunction(migration, name);
    assert.match(declaration, /security\s+definer/i, `${name} must be security definer`);
    assert.match(
      declaration,
      /set\s+search_path\s*=\s*''/i,
      `${name} must pin an empty search_path`,
    );
  }

  const functionRevoke = [
    ...migration.matchAll(
      /revoke\s+all\s+on\s+function\s+([\s\S]*?)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*;/gi,
    ),
  ].map((match) => match[1]).join("\n");
  const functionGrant = [
    ...migration.matchAll(
      /grant\s+execute\s+on\s+function\s+([\s\S]*?)\s+to\s+authenticated\s*;/gi,
    ),
  ].map((match) => match[1]).join("\n");
  assert.ok(functionRevoke, "v2 RPC execute privileges must first be revoked");
  assert.ok(functionGrant, "v2 RPCs must be explicitly granted to authenticated");

  const privateSecurityDefiners = [
    ...migration.matchAll(
      /create\s+or\s+replace\s+function\s+app_private\.([a-z0-9_]+)\s*\(/gi,
    ),
  ].map((match) => match[1]).filter((name) =>
    /security\s+definer/i.test(sqlFunction(migration, name, "app_private")),
  );
  for (const name of privateSecurityDefiners) {
    const declaration = sqlFunction(migration, name, "app_private");
    assert.match(
      declaration,
      /set\s+search_path\s*=\s*''/i,
      `app_private.${name} must pin an empty search_path`,
    );
    assert.match(
      functionRevoke,
      new RegExp(`app_private\\.${escapeRegExp(name)}\\s*\\(`, "i"),
      `app_private.${name} must be revoked from API roles`,
    );
  }

  for (const name of rpcNames) {
    assert.match(
      functionRevoke,
      new RegExp(`public\\.${escapeRegExp(name)}\\s*\\(`, "i"),
      `${name} must be revoked from default roles`,
    );
    assert.match(
      functionGrant,
      new RegExp(`public\\.${escapeRegExp(name)}\\s*\\(`, "i"),
      `${name} must be granted explicitly`,
    );
  }

  for (const signature of [
    "get_unified_manual_payment_queue(boolean,integer,integer)",
    "confirm_unified_manual_payment(text,uuid,bigint,text,bigint,integer,uuid)",
    "request_inventory_shipment(uuid[],uuid,text,bigint,text,text,uuid)",
  ]) {
    const escaped = escapeRegExp(signature).replaceAll("\\ ", "\\s*");
    assert.match(
      migration,
      new RegExp(`revoke[\\s\\S]*?public\\.${escaped}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, "i"),
    );
    assert.match(
      migration,
      new RegExp(`grant\\s+execute[\\s\\S]*?public\\.${escaped}[\\s\\S]*?to\\s+authenticated`, "i"),
    );
  }
});

test("operator payment API is shared, nested, strict, and confirms only the observed full balance", async () => {
  await access(new URL("src/app/(admin)/admin/operator/payments/page.tsx", rootUrl));
  const [queueRoute, confirmRoute, consoleSource, layout] = await Promise.all([
    source("src/app/api/admin/operator/payments/route.ts"),
    source("src/app/api/admin/operator/payments/[kind]/[id]/confirm/route.ts"),
    source("src/components/admin/operator/OperatorPaymentsConsole.tsx"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
  ]);

  assert.match(queueRoute, /"get_unified_manual_payment_queue"/);
  assert.match(queueRoute, /auth\.user as unknown as RpcClient/);
  assert.doesNotMatch(queueRoute, /export\s+async\s+function\s+POST/);
  assert.match(confirmRoute, /authenticateStaffRequest\(request,\s*true\)/);
  assert.match(confirmRoute, /"confirm_unified_manual_payment_v2"/);
  assert.match(confirmRoute, /p_payment_kind:\s*kind/);
  assert.match(confirmRoute, /p_payment_id:\s*id/);
  assert.match(confirmRoute, /p_observed_received_amount:\s*body\.observedReceivedAmount/);
  assert.match(confirmRoute, /p_observed_ledger_entry_count:\s*body\.observedLedgerEntryCount/);
  assert.match(confirmRoute, /p_expected_version:\s*body\.expectedVersion/);
  assert.match(confirmRoute, /p_idempotency_key:\s*body\.idempotencyKey/);
  assert.doesNotMatch(confirmRoute, /\bamount\b\s*:\s*body\./i);

  assert.match(consoleSource, /type\s+PaymentKind\s*=\s*"commerce"\s*\|\s*"auction"\s*\|\s*"shipping_fee"/);
  assert.match(consoleSource, /observedReceivedAmount:\s*payment\.receivedAmount/);
  assert.match(consoleSource, /observedLedgerEntryCount:\s*payment\.ledgerEntryCount/);
  assert.match(consoleSource, /expectedVersion:\s*payment\.version/);
  assert.match(consoleSource, /sessionStorage\.getItem\(key\)\s*\?\?\s*crypto\.randomUUID\(\)/);
  assert.match(consoleSource, /잔액 전액 입금 확인 완료/);
  assert.match(consoleSource, /원장 금액 결제 확정/);
  assert.match(consoleSource, /모든 센터가 같은 대기열/);
  assert.match(consoleSource, /response\.status\s*===\s*409/);
  assert.match(layout, /href:\s*"\/admin\/operator\/payments"/);
});

test("advanced V2 shipping-fee receipts remain unconfirmed until the shared CAS finalisation", async () => {
  const migration = await source(advancedLedgerMigrationPath);
  const receipt = sqlFunction(
    migration,
    "record_inventory_shipping_fee_receipt",
    "app_private",
  );
  const finalize = sqlFunction(migration, "finalize_inventory_shipping_fee_payment");
  const confirm = sqlFunction(migration, "confirm_unified_manual_payment_v2");

  assert.match(receipt, /app_private\.can_confirm_shared_payment\(v_payment\.business_id\)/);
  assert.match(receipt, /v_received\s*\+\s*p_amount\s*>\s*v_payment\.expected_amount/);
  assert.match(receipt, /set\s+status\s*=\s*'partially_paid'/i);
  assert.doesNotMatch(receipt, /set\s+status\s*=\s*'confirmed'/i);
  assert.match(finalize, /v_received\s*<>\s*v_payment\.expected_amount/);
  assert.match(finalize, /set\s+status\s*=\s*'confirmed'/i);
  assert.match(finalize, /insert\s+into\s+public\.store_financial_entries/i);
  assert.match(confirm, /public\.finalize_inventory_shipping_fee_payment/i);
  assert.match(migration, /revoke\s+all\s+on\s+function[\s\S]*?public\.confirm_unified_manual_payment_v2/i);
  assert.match(migration, /grant\s+execute\s+on\s+function[\s\S]*?public\.confirm_unified_manual_payment_v2/i);
});

test("buyer purchase surfaces use manual transfer and keep PortOne as legacy history only", async () => {
  const [cart, settlement, history] = await Promise.all([
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/features/auction/detail/SettlementActions.tsx"),
    source("src/components/features/account/OrderHistory.tsx"),
  ]);

  assert.match(cart, /paymentMode\s*!==\s*"manual_transfer"/);
  assert.match(cart, /주문하고 입금계좌 확인/);
  assert.match(cart, /입금 대기 중/);
  assert.match(cart, /bank_name_snapshot/);
  assert.match(cart, /account_number_snapshot/);
  assert.match(settlement, /\/api\/payments\/manual-transfer/);
  assert.match(settlement, /transfer\.bankName[\s\S]{0,80}transfer\.accountNumber/);
  assert.match(settlement, /입금 대기 중/);
  assert.doesNotMatch(settlement, /PG 카드 결제는[\s\S]{0,80}운영자가 활성화한 이후 제공됩니다/);
  assert.match(history, /과거 PortOne 테스트 기록/);
  assert.match(history, /결제 재개는 중단/);
});

test("buyer inventory, shipment, and refund interfaces expose only scoped public state", async () => {
  const [
    storageRoute,
    shipmentRoute,
    shippingRoute,
    refundRoute,
    accountRoute,
    dashboard,
    encryption,
  ] = await Promise.all([
    source("src/app/api/account/storage/route.ts"),
    source("src/app/api/account/shipments/route.ts"),
    source("src/app/api/shipping/requests/route.ts"),
    source("src/app/api/account/refunds/route.ts"),
    source("src/app/api/account/refunds/[id]/account/route.ts"),
    source("src/components/features/account/AccountDashboard.tsx"),
    source("src/lib/refunds/encryption.ts"),
  ]);

  assert.match(storageRoute, /"get_my_inventory_overview"/);
  assert.match(storageRoute, /hasExactKeys/);
  assert.match(storageRoute, /itemSelectedShipmentsEnabled/);
  assert.match(storageRoute, /"get_my_won_products"/);
  assert.match(storageRoute, /legacyAuctionWins/);
  assert.doesNotMatch(storageRoute, /internalNote|evidencePaths|account_ciphertext/);
  assert.match(shipmentRoute, /"get_my_inventory_shipments"/);
  assert.match(shipmentRoute, /"sourceKind"/);
  assert.match(shipmentRoute, /"sourceId"/);
  assert.match(shipmentRoute, /"trackingUrl"/);
  assert.match(shipmentRoute, /trackingNumber/);
  assert.match(shippingRoute, /inventoryItemIds\.length\s*>\s*100/);
  assert.match(shippingRoute, /new Set\(inventoryItemIds\)\.size\s*!==\s*inventoryItemIds\.length/);
  assert.match(shippingRoute, /p_inventory_item_ids:\s*\[\.\.\.inventoryItemIds\]\.sort\(\)/);
  assert.match(shippingRoute, /hasExactKeys\(body,\s*LEGACY_BODY_KEYS\)/);
  assert.match(shippingRoute, /hasExactKeys\(body,\s*V2_BODY_KEYS\)/);
  assert.match(shippingRoute, /"get_legacy_commerce_shipment_quote"/);
  assert.match(shippingRoute, /"request_commerce_order_shipment"/);
  assert.match(refundRoute, /"get_my_manual_refunds"/);
  assert.match(refundRoute, /shippingFeeRefunds/);
  assert.doesNotMatch(refundRoute, /internalNote|evidencePaths|account_ciphertext|account_fingerprint/);
  assert.match(accountRoute, /encryptRefundBankAccount\([\s\S]{0,300},\s*id,\s*body\.refundKind/);
  assert.match(accountRoute, /"submit_manual_refund_account"/);
  assert.match(accountRoute, /"submit_shipping_fee_refund_account"/);
  assert.doesNotMatch(accountRoute, /console\.(?:log|info|warn|error)/);

  assert.match(encryption, /createCipheriv\(\s*"aes-256-gcm"/);
  assert.match(encryption, /createDecipheriv\(\s*"aes-256-gcm"/);
  assert.match(encryption, /`manual-refund:\$\{refundId\}`/);
  assert.match(encryption, /`shipping-fee-refund:\$\{refundId\}`/);
  assert.match(encryption, /cipher\.setAAD\(refundAccountAdditionalData\(refundId,\s*refundKind\)\)/);
  assert.match(encryption, /decipher\.setAAD\(refundAccountAdditionalData\(refundId,\s*refundKind\)\)/);
  assert.match(encryption, /createHmac\(\s*"sha256"/);
  assert.match(encryption, /randomBytes\(12\)/);
  assert.match(encryption, /REFUND_ACCOUNT_ENCRYPTION_KEYS/);
  assert.match(encryption, /REFUND_ACCOUNT_ACTIVE_KEY_VERSION/);
  assert.match(encryption, /REFUND_ACCOUNT_FINGERPRINT_KEY/);

  assert.match(dashboard, /배송 가능 상품 전체 선택/);
  assert.match(dashboard, /requestBlockReason/);
  assert.match(dashboard, /itemSelectedCommerceOrderItemIds/);
  assert.match(dashboard, /v2Storage/);
  assert.match(dashboard, /legacyAuctionWins/);
  assert.match(dashboard, /fetch\("\/api\/orders"/);
  assert.match(dashboard, /orderId:\s*selectedLegacyOrder\?\.id/);
  assert.match(dashboard, /exceptionPublicReason/);
  assert.match(dashboard, /환불 진행 상황/);
  assert.match(dashboard, /환불 계좌 등록/);
  assert.match(dashboard, /shipping_fee/);
  assert.match(dashboard, /shipment\.trackingNumber\s*&&\s*shipment\.courier/);
  assert.match(dashboard, /shipment\.trackingUrl/);
});

test("operator exceptions use private signed evidence while Owner alone reveals and completes refunds", async () => {
  const [
    exceptionRoute,
    evidenceRoute,
    exceptionConsole,
    ownerRoute,
    ownerConsole,
    ownerLayout,
  ] = await Promise.all([
    source("src/app/api/admin/operator/exceptions/route.ts"),
    source("src/app/api/admin/operator/exceptions/[id]/evidence/route.ts"),
    source("src/components/admin/operator/OperatorExceptionsConsole.tsx"),
    source("src/app/api/admin/owner/refunds/route.ts"),
    source("src/components/admin/owner/OwnerRefundConsole.tsx"),
    source("src/app/(admin)/admin/owner/layout.tsx"),
  ]);

  assert.match(exceptionRoute, /"get_inventory_exception_candidates"/);
  assert.match(exceptionRoute, /"get_inventory_exception_queue"/);
  assert.match(exceptionRoute, /"open_inventory_exception"/);
  assert.match(exceptionRoute, /"resolve_inventory_exception"/);
  assert.match(exceptionRoute, /p_expected_version:\s*body\.expectedVersion/);
  assert.match(exceptionConsole, /"inspection_required"\s*\|\s*"missing"\s*\|\s*"offline_sold"\s*\|\s*"additional_wait"\s*\|\s*"refund_required"/);
  assert.match(exceptionConsole, /"resume"\s*\|\s*"exclude_for_later"\s*\|\s*"refund"/);
  assert.match(exceptionConsole, /response\.status\s*===\s*409/);

  assert.match(evidenceRoute, /BUCKET\s*=\s*"inventory-exception-evidence"/);
  assert.match(evidenceRoute, /public:\s*false/);
  assert.match(evidenceRoute, /MAX_FILE_SIZE\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(evidenceRoute, /authenticateStaffRequest\(request,\s*true\)/);
  assert.match(evidenceRoute, /get_inventory_exception_queue/);
  assert.match(evidenceRoute, /append_inventory_exception_evidence/);
  assert.match(evidenceRoute, /upsert:\s*false/);
  assert.match(evidenceRoute, /createSignedUrl\([^,]+,\s*300\)/);

  assert.match(ownerRoute, /authenticateOwnerAccessRequest\(request\)/);
  assert.match(ownerRoute, /"get_manual_refund_queue"/);
  assert.match(ownerRoute, /"get_shipping_fee_refund_queue"/);
  assert.match(ownerRoute, /"record_manual_refund_account_access"/);
  assert.match(ownerRoute, /"record_shipping_fee_refund_account_access"/);
  assert.match(ownerRoute, /"review_manual_refund"/);
  assert.match(ownerRoute, /"review_shipping_fee_refund"/);
  assert.match(ownerRoute, /refundKind === "shipping_fee" && \(action === "approve" \|\| action === "cancel"\)/);
  assert.match(ownerRoute, /access\.admin[\s\S]*?\.from\("manual_refund_accounts"\)/);
  assert.match(ownerRoute, /access\.admin[\s\S]*?\.from\("shipping_fee_refund_accounts"\)/);
  assert.match(
    ownerRoute,
    /decryptRefundBankAccount\([\s\S]{0,300},\s*body\.refundId,\s*refundKind\)/,
  );
  assert.doesNotMatch(ownerRoute, /console\.(?:log|info|warn|error)/);
  assert.match(ownerConsole, /계좌 열람 사유/);
  assert.match(ownerConsole, /환불 승인/);
  assert.match(ownerConsole, /송금 완료/);
  assert.match(ownerConsole, /외부 송금 참조번호/);
  assert.match(ownerConsole, /refund\.refundKind === "item" && \(refund\.status === "requested" \|\| refund\.status === "approved"\)/);
  assert.match(ownerLayout, /href:\s*"\/admin\/owner\/refunds"/);
});

test("v2 operations return stable Korean problem contracts with CAS and business states separated", async () => {
  const [commerceServer, ownerServer, payments, confirm, fulfillment, shipping, exceptions, evidence, refunds, refundAccount] = await Promise.all([
    source("src/lib/commerce/server.ts"),
    source("src/lib/ownerAccess/server.ts"),
    source("src/app/api/admin/operator/payments/route.ts"),
    source("src/app/api/admin/operator/payments/[kind]/[id]/confirm/route.ts"),
    source("src/app/api/admin/operator/fulfillment/route.ts"),
    source("src/app/api/admin/operator/shipping/route.ts"),
    source("src/app/api/admin/operator/exceptions/route.ts"),
    source("src/app/api/admin/operator/exceptions/[id]/evidence/route.ts"),
    source("src/app/api/admin/owner/refunds/route.ts"),
    source("src/app/api/account/refunds/[id]/account/route.ts"),
  ]);

  assert.match(commerceServer, /typeof problem\.error === "string" && typeof problem\.code !== "string"/);
  assert.match(commerceServer, /message: "로그인이 필요합니다\."/);
  assert.match(ownerServer, /typeof body\.error === "string" && typeof body\.code !== "string"/);
  assert.match(ownerServer, /\? "로그인이 필요합니다\."/);

  for (const route of [payments, confirm, fulfillment, shipping, exceptions, evidence, refunds, refundAccount]) {
    assert.match(route, /\["PT409", "23505", "40001"\]/);
    assert.match(route, /error\.code === "55000"[\s\S]{0,500}\b422\b/);
  }
  assert.match(shipping, /code:\s*"UNRELEASED_ITEMS"/);
  assert.match(shipping, /blockedItemIds/);
  assert.doesNotMatch(shipping, /invalid_shipment_request[\s\S]{0,160},\s*400\)/);
  assert.doesNotMatch(exceptions, /invalid_exception_request[\s\S]{0,160},\s*400\)/);
});

test("store revenue stays attributed to origin stores and central shipping fees remain separate", async () => {
  const migration = await source(migrationPath);
  const report = sqlFunction(migration, "get_store_financial_report");
  const [route, consoleSource] = await Promise.all([
    source("src/app/api/admin/operator/revenue/route.ts"),
    source("src/components/admin/operator/OperatorRevenueConsole.tsx"),
  ]);

  assert.match(
    migration,
    /entry_kind\s+text\s+not\s+null\s+check\s*\(entry_kind\s+in\s*\('item_payment',\s*'payment_reversal',\s*'item_refund',\s*'shipping_fee',\s*'shipping_fee_refund'\)\)/i,
  );
  assert.match(migration, /entry_kind\s*=\s*'item_payment'[\s\S]{0,140}origin_store_id\s+is\s+not\s+null/i);
  assert.match(migration, /entry_kind\s*=\s*'payment_reversal'[\s\S]{0,140}origin_store_id\s+is\s+not\s+null/i);
  assert.match(migration, /entry_kind\s*=\s*'item_refund'[\s\S]{0,140}origin_store_id\s+is\s+not\s+null/i);
  assert.match(migration, /entry_kind\s*=\s*'shipping_fee'[\s\S]{0,140}origin_store_id\s+is\s+null/i);
  assert.match(report, /grossSales/i);
  assert.match(report, /refunds/i);
  assert.match(report, /netSales/i);
  assert.match(report, /centralShippingFees/i);
  assert.match(report, /public\.has_store_permission\(s\.id,\s*'view_reports'\)/i);
  assert.match(route, /"get_store_financial_report"/);
  assert.match(route, /auth\.user as unknown as RpcClient/);
  assert.match(consoleSource, /store\.storeName/);
  assert.match(consoleSource, /centralShippingFees/);
});

test("v2 event and financial histories are append-only", async () => {
  const migration = await source(migrationPath);
  const appendOnly = [
    "store_fulfillment_route_events",
    "inventory_item_fulfillment_events",
    "inventory_shipment_events",
    "inventory_exception_events",
    "manual_refund_events",
    "store_financial_entries",
  ];

  for (const table of appendOnly) {
    assert.match(
      migration,
      new RegExp(
        `create\\s+trigger\\s+${escapeRegExp(table)}_append_only\\s+before\\s+update\\s+or\\s+delete\\s+or\\s+truncate\\s+on\\s+public\\.${escapeRegExp(table)}[\\s\\S]{0,180}app_private\\.reject_inventory_v2_append_only_mutation`,
        "i",
      ),
    );
  }
});
