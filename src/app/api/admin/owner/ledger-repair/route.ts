import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/lib/ownerAccess/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "cancel_bid",
  "cancel_auction_payment",
  "cancel_commerce_order",
  "cancel_legacy_payment",
  "update_auction_due_at",
  "cancel_inventory_item",
  "restore_inventory_item",
  "update_storage_duration",
  "cancel_shipment",
  "correct_shipment_tracking",
  "force_request_shipment",
  "force_complete_delivery",
  "restore_audit_event",
]);
const FORCE_ACTIONS = new Set([
  "cancel_bid",
  "cancel_auction_payment",
  "cancel_commerce_order",
  "cancel_legacy_payment",
  "cancel_inventory_item",
  "cancel_shipment",
]);
const FORCE_PROGRESSION_ACTIONS = new Set([
  "force_request_shipment",
  "force_complete_delivery",
]);

interface RpcClient {
  rpc(
    functionName: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

type Row = Record<string, unknown>;

type QueryError = { code?: string; message?: string; details?: string; hint?: string } | null;

function logLedgerReadFailure(stage: string, failures: Array<{ query: string; error: QueryError }>) {
  for (const failure of failures) {
    if (!failure.error) continue;
    console.error(JSON.stringify({
      level: "error",
      message: "owner_ledger_read_failed",
      stage,
      query: failure.query,
      code: failure.error.code ?? "unknown",
      databaseMessage: failure.error.message ?? "unknown",
    }));
  }
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function uniqueIds(values: unknown[]) {
  return [...new Set(values.filter(isUuid))];
}

function repairFailure(error: { code?: string; message?: string }) {
  const code = error.code ?? "";
  const status = code === "42501" ? 403
    : code === "P0002" ? 404
    : ["PT409", "23505", "40001"].includes(code) ? 409
    : ["22023", "22003", "22P02", "23514", "55000"].includes(code) ? 422
    : 503;
  return ownerAccessJsonResponse({
    error: "ledger_repair_failed",
    message: error.message ?? "원장 복구 작업을 처리하지 못했습니다.",
  }, status);
}

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const params = new URL(request.url).searchParams;
    const allowedKeys = new Set(["q", "memberId"]);
    if ([...params.keys()].some((key) => !allowedKeys.has(key))) {
      return ownerAccessJsonResponse({ error: "invalid_ledger_query" }, 422);
    }
    const query = (params.get("q") ?? "").trim().slice(0, 80);
    const memberId = params.get("memberId");
    if (memberId && !isUuid(memberId)) {
      return ownerAccessJsonResponse({ error: "invalid_member_id" }, 422);
    }

    if (!memberId) {
      if (query.length < 2 && !UUID_PATTERN.test(query)) {
        return ownerAccessJsonResponse({ members: [] });
      }
      const phoneQuery = query.replace(/[^0-9]/g, "");
      const [profilesResult, accountsResult] = await Promise.all([
        UUID_PATTERN.test(query)
          ? access.admin.from("profiles").select("id,display_name,created_at,deleted_at").eq("id", query).limit(20)
          : access.admin.from("profiles").select("id,display_name,created_at,deleted_at").ilike("display_name", `%${query.replace(/[%_]/g, "\\$&")}%`).limit(20),
        phoneQuery.length >= 2
          ? access.admin.from("member_accounts").select("member_id,phone,account_status,shipping_credit_count,last_depositor_name").ilike("phone", `%${phoneQuery}%`).limit(20)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (profilesResult.error || accountsResult.error) {
        return ownerAccessJsonResponse({ error: "member_search_unavailable" }, 503);
      }
      const profileRows = rows(profilesResult.data);
      const phoneMemberIds = uniqueIds(rows(accountsResult.data).map((row) => row.member_id));
      if (phoneMemberIds.length > 0) {
        const phoneProfiles = await access.admin.from("profiles").select("id,display_name,created_at,deleted_at").in("id", phoneMemberIds);
        if (phoneProfiles.error) return ownerAccessJsonResponse({ error: "member_search_unavailable" }, 503);
        profileRows.push(...rows(phoneProfiles.data));
      }
      const accountByMember = new Map(rows(accountsResult.data).map((row) => [row.member_id, row]));
      const members = [...new Map(profileRows.map((profile) => [profile.id, profile])).values()].map((profile) => ({
        id: profile.id,
        displayName: profile.display_name,
        createdAt: profile.created_at,
        deletedAt: profile.deleted_at,
        phone: accountByMember.get(profile.id)?.phone ?? null,
        accountStatus: accountByMember.get(profile.id)?.account_status ?? null,
        shippingCreditCount: accountByMember.get(profile.id)?.shipping_credit_count ?? 0,
        lastDepositorName: accountByMember.get(profile.id)?.last_depositor_name ?? null,
      }));
      return ownerAccessJsonResponse({ members });
    }

    const [profileResult, accountResult, bidsResult, cancelledBidsResult, auctionPaymentsResult, legacyPaymentsResult, ordersResult, inventoryResult, shipmentsResult, auditsResult, addressesResult] = await Promise.all([
      access.admin.from("profiles").select("id,display_name,created_at,deleted_at").eq("id", memberId).maybeSingle(),
      access.admin.from("member_accounts").select("member_id,phone,account_status,shipping_credit_count,last_depositor_name").eq("member_id", memberId).maybeSingle(),
      access.admin.from("auction_bids").select("id,product_id,amount,is_final,created_at,bidder_display_name").eq("bidder_id", memberId).order("created_at", { ascending: false }).limit(300),
      access.admin.from("cancelled_auction_bids").select("original_bid_id,product_id,amount,was_final,original_created_at,cancelled_at,cancellation_reason,bidder_display_name").eq("bidder_id", memberId).order("cancelled_at", { ascending: false }).limit(200),
      access.admin.from("manual_transfer_orders").select("id,product_id,purchase_offer_id,order_name,expected_amount,status,requested_at,confirmed_at,due_at,display_due_at,cancelled_at,cancellation_reason,version").eq("buyer_id", memberId).order("requested_at", { ascending: false }).limit(200),
      access.admin.from("payment_orders").select("id,product_id,commerce_order_id,order_name,expected_amount,payment_status,portone_status,paid_at,created_at").eq("buyer_id", memberId).order("created_at", { ascending: false }).limit(200),
      access.admin.from("commerce_orders").select("id,status,subtotal,shipping_fee,total,payment_due_at,direct_ship,created_at,updated_at").eq("member_id", memberId).order("created_at", { ascending: false }).limit(200),
      access.admin.from("customer_inventory_items").select("id,product_id,source_kind,paid_amount,paid_at,ownership_status,storage_duration_days,storage_started_at,storage_expires_at,version,created_at,updated_at").eq("member_id", memberId).order("paid_at", { ascending: false }).limit(300),
      access.admin.from("inventory_shipments").select("id,status,settlement_method,courier,tracking_number,delivery_status,delivery_status_text,packed_at,shipped_at,delivered_at,cancelled_at,cancellation_reason,version,created_at,updated_at").eq("member_id", memberId).order("created_at", { ascending: false }).limit(200),
      access.admin.from("owner_ledger_repair_events").select("id,action,entity_type,entity_id,product_id,reason,occurred_at,result").eq("member_id", memberId).order("occurred_at", { ascending: false }).limit(100),
      access.admin.from("shipping_addresses").select("id,label,recipient_name,phone,postal_code,address,is_default").eq("member_id", memberId).order("is_default", { ascending: false }).order("created_at", { ascending: false }).limit(20),
    ]);
    const baseResults = [
      { query: "profiles", error: profileResult.error },
      { query: "member_accounts", error: accountResult.error },
      { query: "auction_bids", error: bidsResult.error },
      { query: "cancelled_auction_bids", error: cancelledBidsResult.error },
      { query: "manual_transfer_orders", error: auctionPaymentsResult.error },
      { query: "payment_orders", error: legacyPaymentsResult.error },
      { query: "commerce_orders", error: ordersResult.error },
      { query: "customer_inventory_items", error: inventoryResult.error },
      { query: "inventory_shipments", error: shipmentsResult.error },
      { query: "owner_ledger_repair_events", error: auditsResult.error },
      { query: "shipping_addresses", error: addressesResult.error },
    ];
    if (baseResults.some((result) => result.error)) {
      logLedgerReadFailure("base", baseResults);
      return ownerAccessJsonResponse({ error: "member_ledger_unavailable" }, 503);
    }
    if (!profileResult.data) return ownerAccessJsonResponse({ error: "member_not_found" }, 404);

    const bids = rows(bidsResult.data);
    const cancelledBids = rows(cancelledBidsResult.data);
    const auctionPayments = rows(auctionPaymentsResult.data);
    const legacyPayments = rows(legacyPaymentsResult.data);
    const orders = rows(ordersResult.data);
    const inventory = rows(inventoryResult.data);
    const shipments = rows(shipmentsResult.data);
    const orderIds = uniqueIds(orders.map((row) => row.id));
    const inventoryIds = uniqueIds(inventory.map((row) => row.id));
    const shipmentIds = uniqueIds(shipments.map((row) => row.id));

    const [orderItemsResult, transfersResult, shipmentItemsResult, fulfillmentsResult] = await Promise.all([
      orderIds.length ? access.admin.from("commerce_order_items").select("id,order_id,product_id,store_id,unit_price,payment_status,paid_at,storage_expires_at,created_at").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
      orderIds.length ? access.admin.from("commerce_order_transfers").select("id,order_id,expected_amount,status,payment_due_at,requested_at,confirmed_at,version").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
      shipmentIds.length ? access.admin.from("inventory_shipment_items").select("shipment_id,inventory_item_id,product_id,line_status,excluded_reason,updated_at").in("shipment_id", shipmentIds) : Promise.resolve({ data: [], error: null }),
      inventoryIds.length ? access.admin.from("inventory_item_fulfillments").select("inventory_item_id,current_stage,location_kind,is_blocked,block_reason,outbound_released,version,updated_at").in("inventory_item_id", inventoryIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const relationResults = [
      { query: "commerce_order_items", error: orderItemsResult.error },
      { query: "commerce_order_transfers", error: transfersResult.error },
      { query: "inventory_shipment_items", error: shipmentItemsResult.error },
      { query: "inventory_item_fulfillments", error: fulfillmentsResult.error },
    ];
    if (relationResults.some((result) => result.error)) {
      logLedgerReadFailure("relations", relationResults);
      return ownerAccessJsonResponse({ error: "member_ledger_unavailable" }, 503);
    }
    const orderItems = rows(orderItemsResult.data);
    const transfers = rows(transfersResult.data);
    const shipmentItems = rows(shipmentItemsResult.data);
    const fulfillments = rows(fulfillmentsResult.data);
    const auctionPaymentIds = uniqueIds(auctionPayments.map((row) => row.id));
    const transferIds = uniqueIds(transfers.map((row) => row.id));
    const [auctionLedgerResult, commerceLedgerResult] = await Promise.all([
      auctionPaymentIds.length ? access.admin.from("manual_transfer_payment_ledger").select("id,manual_transfer_order_id,entry_type,amount,created_at").in("manual_transfer_order_id", auctionPaymentIds) : Promise.resolve({ data: [], error: null }),
      transferIds.length ? access.admin.from("manual_transfer_payment_ledger").select("id,commerce_order_transfer_id,entry_type,amount,created_at").in("commerce_order_transfer_id", transferIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const paymentLedgerResults = [
      { query: "manual_transfer_payment_ledger:auction", error: auctionLedgerResult.error },
      { query: "manual_transfer_payment_ledger:commerce", error: commerceLedgerResult.error },
    ];
    if (paymentLedgerResults.some((result) => result.error)) {
      logLedgerReadFailure("payment_ledger", paymentLedgerResults);
      return ownerAccessJsonResponse({ error: "member_ledger_unavailable" }, 503);
    }
    const auctionLedger = rows(auctionLedgerResult.data);
    const commerceLedger = rows(commerceLedgerResult.data);

    const productIds = uniqueIds([
      ...bids.map((row) => row.product_id), ...cancelledBids.map((row) => row.product_id),
      ...auctionPayments.map((row) => row.product_id), ...legacyPayments.map((row) => row.product_id),
      ...orderItems.map((row) => row.product_id), ...inventory.map((row) => row.product_id),
      ...shipmentItems.map((row) => row.product_id),
    ]);
    const productsResult = productIds.length
      ? await access.admin.from("products").select("id,title,sale_type,status,store_id,starting_price,current_price,final_bid_id,final_bid_amount,publish_at,closes_at,image_urls").in("id", productIds)
      : { data: [], error: null };
    if (productsResult.error) {
      logLedgerReadFailure("products", [{ query: "products", error: productsResult.error }]);
      return ownerAccessJsonResponse({ error: "member_ledger_unavailable" }, 503);
    }
    const productById = new Map(rows(productsResult.data).map((product) => [product.id, product]));
    const fulfillmentByItem = new Map(fulfillments.map((row) => [row.inventory_item_id, row]));
    const shipmentLinesByShipment = new Map<string, Row[]>();
    for (const line of shipmentItems) {
      const key = String(line.shipment_id);
      shipmentLinesByShipment.set(key, [...(shipmentLinesByShipment.get(key) ?? []), { ...line, product: productById.get(line.product_id) ?? null }]);
    }
    const sumLedger = (ledgerRows: Row[], foreignKey: string, id: unknown) => {
      const entries = ledgerRows.filter((row) => row[foreignKey] === id);
      return {
        receivedAmount: entries.reduce((sum, row) => sum + (row.entry_type === "receipt" ? Number(row.amount) : -Number(row.amount)), 0),
        ledgerEntryCount: entries.length,
      };
    };

    return ownerAccessJsonResponse({
      member: {
        id: profileResult.data.id,
        displayName: profileResult.data.display_name,
        createdAt: profileResult.data.created_at,
        deletedAt: profileResult.data.deleted_at,
        phone: accountResult.data?.phone ?? null,
        accountStatus: accountResult.data?.account_status ?? null,
        shippingCreditCount: accountResult.data?.shipping_credit_count ?? 0,
        lastDepositorName: accountResult.data?.last_depositor_name ?? null,
      },
      bids: bids.map((bid) => ({ ...bid, product: productById.get(bid.product_id) ?? null })),
      cancelledBids: cancelledBids.map((bid) => ({ ...bid, product: productById.get(bid.product_id) ?? null })),
      auctionPayments: auctionPayments.map((payment) => ({ ...payment, ...sumLedger(auctionLedger, "manual_transfer_order_id", payment.id), product: productById.get(payment.product_id) ?? null })),
      legacyPayments: legacyPayments.map((payment) => ({ ...payment, product: productById.get(payment.product_id) ?? null })),
      commerceOrders: orders.map((order) => {
        const transfer = transfers.find((item) => item.order_id === order.id) ?? null;
        return {
          ...order,
          items: orderItems.filter((item) => item.order_id === order.id).map((item) => ({ ...item, product: productById.get(item.product_id) ?? null })),
          transfer: transfer ? { ...transfer, ...sumLedger(commerceLedger, "commerce_order_transfer_id", transfer.id) } : null,
        };
      }),
      inventory: inventory.map((item) => ({ ...item, product: productById.get(item.product_id) ?? null, fulfillment: fulfillmentByItem.get(item.id) ?? null, activeShipmentId: shipmentItems.find((line) => line.inventory_item_id === item.id && !["cancelled", "excluded", "shipped"].includes(String(line.line_status)))?.shipment_id ?? null })),
      shipments: shipments.map((shipment) => ({ ...shipment, items: shipmentLinesByShipment.get(String(shipment.id)) ?? [] })),
      addresses: rows(addressesResult.data).map((address) => ({
        id: address.id,
        label: address.label,
        recipientName: address.recipient_name,
        phone: address.phone,
        postalCode: address.postal_code,
        address: address.address,
        isDefault: address.is_default,
      })),
      audits: (() => {
        const audits = rows(auditsResult.data);
        const restoredIds = new Set(audits
          .filter((audit) => audit.action === "restore_audit_event")
          .map((audit) => {
            const result = audit.result;
            return result && typeof result === "object" && !Array.isArray(result)
              ? String((result as Row).sourceEventId ?? "")
              : "";
          })
          .filter(Boolean));
        return audits.map((audit) => ({
          ...audit,
          restorable: FORCE_ACTIONS.has(String(audit.action)) && !restoredIds.has(String(audit.id)),
        }));
      })(),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request, 12_288);
    const allowedKeys = new Set(["action", "entityId", "memberId", "expectedVersion", "payload", "reason", "idempotencyKey", "confirmation", "expectedReceivedAmount", "expectedLedgerEntryCount"]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return ownerAccessJsonResponse({ error: "invalid_ledger_repair" }, 422);
    }
    const action = typeof body.action === "string" ? body.action : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const requiredConfirmation = FORCE_ACTIONS.has(action)
      ? "강제철회"
      : FORCE_PROGRESSION_ACTIONS.has(action)
        ? "강제진행"
        : "원장복구";
    if (!ACTIONS.has(action) || !isUuid(body.entityId) || !isUuid(body.idempotencyKey) || body.confirmation !== requiredConfirmation || reason.length < 3 || reason.length > 500) {
      return ownerAccessJsonResponse({ error: "invalid_ledger_repair", message: "복구 작업, 사유, 확인 문구를 확인해 주세요." }, 422);
    }
    const userRpc = access.userClient as unknown as RpcClient;
    const adminRpc = access.admin as unknown as RpcClient;
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload as Record<string, unknown>
      : {};
    if (action === "force_request_shipment") {
      const inventoryItemIds = Array.isArray(payload.inventoryItemIds)
        ? payload.inventoryItemIds.filter(isUuid)
        : [];
      if (
        !isUuid(body.memberId)
        || !isUuid(payload.addressId)
        || inventoryItemIds.length < 1
        || inventoryItemIds.length > 100
        || inventoryItemIds.length !== (Array.isArray(payload.inventoryItemIds) ? payload.inventoryItemIds.length : 0)
      ) {
        return ownerAccessJsonResponse({ error: "invalid_force_shipment_request" }, 422);
      }
      const { data, error } = await adminRpc.rpc("owner_force_request_inventory_shipment_service", {
        p_actor_owner_id: access.userId,
        p_member_id: body.memberId,
        p_inventory_item_ids: inventoryItemIds,
        p_address_id: payload.addressId,
        p_reason: reason,
        p_idempotency_key: body.idempotencyKey,
      });
      if (error) return repairFailure(error);
      return ownerAccessJsonResponse({ result: data });
    }
    if (action === "force_complete_delivery") {
      if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
        return ownerAccessJsonResponse({ error: "invalid_force_delivery" }, 422);
      }
      const { data, error } = await adminRpc.rpc("owner_force_complete_inventory_delivery_service", {
        p_actor_owner_id: access.userId,
        p_shipment_id: body.entityId,
        p_expected_version: body.expectedVersion,
        p_reason: reason,
        p_idempotency_key: body.idempotencyKey,
      });
      if (error) return repairFailure(error);
      return ownerAccessJsonResponse({ result: data });
    }
    if (action === "restore_audit_event") {
      const { data, error } = await adminRpc.rpc("owner_restore_ledger_repair_event_service", {
        p_actor_owner_id: access.userId,
        p_event_id: body.entityId,
        p_reason: reason,
        p_idempotency_key: body.idempotencyKey,
      });
      if (error) return repairFailure(error);
      return ownerAccessJsonResponse({ result: data });
    }
    if (body.expectedVersion !== null && body.expectedVersion !== undefined && (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0)) {
      return ownerAccessJsonResponse({ error: "invalid_ledger_repair" }, 422);
    }
    if (FORCE_ACTIONS.has(action)) {
      const { data, error } = await adminRpc.rpc("owner_force_ledger_rollback_service", {
        p_actor_owner_id: access.userId,
        p_action: action,
        p_entity_id: body.entityId,
        p_expected_version: body.expectedVersion ?? null,
        p_reason: reason,
        p_idempotency_key: body.idempotencyKey,
      });
      if (error) return repairFailure(error);
      return ownerAccessJsonResponse({ result: data });
    }
    const { data, error } = await userRpc.rpc("owner_repair_global_ledger", {
      p_action: action,
      p_entity_id: body.entityId,
      p_expected_version: body.expectedVersion ?? null,
      p_payload: payload,
      p_reason: reason,
      p_idempotency_key: body.idempotencyKey,
    });
    if (error) return repairFailure(error);
    return ownerAccessJsonResponse({ result: data });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
