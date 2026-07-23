import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/lib/ownerAccess/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_MODES = new Set(["transfer", "co_located"]);

interface RpcError {
  code?: string;
}

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStore(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ["id", "business_id", "name", "slug", "description", "is_active", "updated_at"]) &&
    isUuid(value.id) &&
    isUuid(value.business_id) &&
    typeof value.name === "string" &&
    typeof value.slug === "string" &&
    isNullableText(value.description) &&
    typeof value.is_active === "boolean" &&
    typeof value.updated_at === "string";
}

function isCenter(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ["id", "business_id", "code", "name", "status", "is_default", "postal_code", "address_line1", "address_line2", "contact_name", "contact_phone", "version", "updated_at"]) &&
    isUuid(value.id) &&
    isUuid(value.business_id) &&
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    typeof value.status === "string" &&
    typeof value.is_default === "boolean" &&
    isNullableText(value.postal_code) &&
    isNullableText(value.address_line1) &&
    isNullableText(value.address_line2) &&
    isNullableText(value.contact_name) &&
    isNullableText(value.contact_phone) &&
    nonNegativeInteger(value.version) &&
    typeof value.updated_at === "string";
}

function isRoute(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ["id", "business_id", "store_id", "fulfillment_center_id", "route_mode", "status", "version", "updated_at"]) &&
    isUuid(value.id) &&
    isUuid(value.business_id) &&
    isUuid(value.store_id) &&
    isUuid(value.fulfillment_center_id) &&
    typeof value.route_mode === "string" &&
    ROUTE_MODES.has(value.route_mode) &&
    typeof value.status === "string" &&
    nonNegativeInteger(value.version) &&
    typeof value.updated_at === "string";
}

function isStaff(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ["id", "display_name", "email", "role_code", "last_seen_at"]) &&
    isUuid(value.id) &&
    typeof value.display_name === "string" &&
    isNullableText(value.email) &&
    ["operator", "employee"].includes(String(value.role_code)) &&
    isNullableText(value.last_seen_at);
}

function isCenterAssignment(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, [
    "id", "business_id", "fulfillment_center_id", "user_id", "status",
    "receive_at_center", "create_shipments", "version", "updated_at",
  ]) &&
    isUuid(value.id) &&
    isUuid(value.business_id) &&
    isUuid(value.fulfillment_center_id) &&
    isUuid(value.user_id) &&
    ["active", "inactive"].includes(String(value.status)) &&
    typeof value.receive_at_center === "boolean" &&
    typeof value.create_shipments === "boolean" &&
    nonNegativeInteger(value.version) &&
    typeof value.updated_at === "string";
}

function isRolloutSetting(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, [
    "business_id", "entitlement_projection_enabled", "unified_inventory_reads_enabled",
    "item_selected_shipments_enabled", "shipping_fee_amount", "version", "updated_at",
  ]) && isUuid(value.business_id) &&
    typeof value.entitlement_projection_enabled === "boolean" &&
    typeof value.unified_inventory_reads_enabled === "boolean" &&
    typeof value.item_selected_shipments_enabled === "boolean" &&
    Number.isSafeInteger(value.shipping_fee_amount) && Number(value.shipping_fee_amount) > 0 &&
    nonNegativeInteger(value.version) && typeof value.updated_at === "string";
}

function isOperationalHealth(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, ["businesses", "serverTime"]) ||
    !Array.isArray(value.businesses) || typeof value.serverTime !== "string") return false;
  return value.businesses.every((business) => isRecord(business) &&
    hasExactKeys(business, [
      "businessId", "businessName", "reconciliationRequired", "blockedItems", "overdueItems",
      "openExceptions", "pendingRefunds", "pendingShippingFees", "rollout",
    ]) && isUuid(business.businessId) && typeof business.businessName === "string" &&
    nonNegativeInteger(business.reconciliationRequired) && nonNegativeInteger(business.blockedItems) &&
    nonNegativeInteger(business.overdueItems) && nonNegativeInteger(business.openExceptions) &&
    nonNegativeInteger(business.pendingRefunds) && nonNegativeInteger(business.pendingShippingFees) &&
    isRecord(business.rollout) && hasExactKeys(business.rollout, ["projection", "reads", "shipments"]) &&
    typeof business.rollout.projection === "boolean" && typeof business.rollout.reads === "boolean" &&
    typeof business.rollout.shipments === "boolean");
}

function isReconciliationItem(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, [
    "inventoryItemId", "productId", "title", "imageUrl", "businessId",
    "originStoreId", "originStoreName", "paidAt", "paidAmount",
    "fulfillmentVersion", "targetCenterId", "targetCenterName",
    "targetRouteMode", "targetRouteVersion",
  ]) && isUuid(value.inventoryItemId) && isUuid(value.productId) &&
    typeof value.title === "string" && typeof value.imageUrl === "string" &&
    isUuid(value.businessId) && isUuid(value.originStoreId) &&
    typeof value.originStoreName === "string" && typeof value.paidAt === "string" &&
    Number.isSafeInteger(value.paidAmount) && Number(value.paidAmount) > 0 &&
    nonNegativeInteger(value.fulfillmentVersion) &&
    (value.targetCenterId === null || isUuid(value.targetCenterId)) &&
    isNullableText(value.targetCenterName) &&
    (value.targetRouteMode === null || ROUTE_MODES.has(String(value.targetRouteMode))) &&
    (value.targetRouteVersion === null || nonNegativeInteger(value.targetRouteVersion));
}

function isReconciliationQueue(value: unknown): value is { items: Record<string, unknown>[] } {
  return isRecord(value) && hasExactKeys(value, ["items"]) &&
    Array.isArray(value.items) && value.items.every(isReconciliationItem);
}

function isReconciledItem(value: unknown) {
  return isRecord(value) && hasExactKeys(value, ["id", "version", "status", "idempotent_replay"]) &&
    isUuid(value.id) && nonNegativeInteger(value.version) && value.status === "preparing" &&
    typeof value.idempotent_replay === "boolean";
}

function isConfiguredRoute(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ["id", "storeId", "centerId", "routeMode", "status", "version", "idempotent_replay"]) &&
    isUuid(value.id) &&
    isUuid(value.storeId) &&
    isUuid(value.centerId) &&
    typeof value.routeMode === "string" &&
    ROUTE_MODES.has(value.routeMode) &&
    typeof value.status === "string" &&
    nonNegativeInteger(value.version) &&
    typeof value.idempotent_replay === "boolean";
}

function isConfiguredAssignment(value: unknown) {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, [
    "id", "businessId", "centerId", "userId", "receiveAtCenter",
    "createShipments", "status", "version", "idempotent_replay",
  ]) &&
    isUuid(value.id) && isUuid(value.businessId) && isUuid(value.centerId) &&
    isUuid(value.userId) && typeof value.receiveAtCenter === "boolean" &&
    typeof value.createShipments === "boolean" &&
    ["active", "inactive"].includes(String(value.status)) &&
    nonNegativeInteger(value.version) && typeof value.idempotent_replay === "boolean";
}

function isDeletedAssignment(value: unknown) {
  return isRecord(value) && hasExactKeys(value, [
    "id", "centerId", "userId", "deleted", "idempotent_replay",
  ]) &&
    isUuid(value.id) &&
    isUuid(value.centerId) &&
    isUuid(value.userId) &&
    value.deleted === true &&
    typeof value.idempotent_replay === "boolean";
}

function isConfiguredCenter(value: unknown) {
  return isRecord(value) && hasExactKeys(value, [
    "id", "businessId", "code", "name", "status", "isDefault", "version", "idempotent_replay",
  ]) && isUuid(value.id) && isUuid(value.businessId) &&
    typeof value.code === "string" && typeof value.name === "string" &&
    typeof value.status === "string" && typeof value.isDefault === "boolean" &&
    nonNegativeInteger(value.version) && typeof value.idempotent_replay === "boolean";
}

function normalizedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= minimum &&
      normalized.length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  return normalizedText(value, 1, maximum) ?? undefined;
}

function rpcFailure(error: RpcError, fallback: string) {
  if (error.code === "42501") {
    return ownerAccessJsonResponse(
      { error: "fulfillment_forbidden", message: "물류 설정 권한이 없습니다." },
      403,
    );
  }
  if (error.code === "P0002") {
    return ownerAccessJsonResponse(
      { error: "fulfillment_not_found", message: "물류 대상을 찾을 수 없습니다." },
      404,
    );
  }
  if (error.code === "PT409" || error.code === "55000" || error.code === "23505") {
    return ownerAccessJsonResponse(
      {
        error: "fulfillment_conflict",
        message: "설정 내용이 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      },
      409,
    );
  }
  if (error.code === "22000" || error.code === "22023" || error.code === "23514") {
    return ownerAccessJsonResponse(
      { error: "invalid_fulfillment_request", message: "입력 내용을 확인해 주세요." },
      422,
    );
  }
  return ownerAccessJsonResponse({ error: fallback }, 503);
}

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const rpc = access.userClient as unknown as RpcClient;
    const [configurationResult, staffResult, healthResult, reconciliationResult] = await Promise.all([
      rpc.rpc("get_owner_inventory_fulfillment_configuration", {}),
      rpc.rpc("get_owner_fulfillment_staff_directory", {}),
      rpc.rpc("get_inventory_operational_health", {}),
      rpc.rpc("get_owner_inventory_reconciliation_queue", { p_limit: 200, p_offset: 0 }),
    ]);

    if (configurationResult.error || staffResult.error || healthResult.error || reconciliationResult.error) {
      return ownerAccessJsonResponse({ error: "owner_fulfillment_unavailable" }, 503);
    }
    const configuration = configurationResult.data;
    if (
      !isRecord(configuration) || !hasExactKeys(configuration, ["stores", "centers", "routes", "assignments", "rollouts"]) ||
      !Array.isArray(configuration.stores) || configuration.stores.some((store) => !isStore(store)) ||
      !Array.isArray(configuration.centers) || configuration.centers.some((center) => !isCenter(center)) ||
      !Array.isArray(configuration.routes) || configuration.routes.some((route) => !isRoute(route)) ||
      !Array.isArray(configuration.assignments) || configuration.assignments.some((assignment) => !isCenterAssignment(assignment)) ||
      !Array.isArray(configuration.rollouts) || configuration.rollouts.some((rollout) => !isRolloutSetting(rollout)) ||
      !Array.isArray(staffResult.data) || staffResult.data.some((staff) => !isStaff(staff)) ||
      !isOperationalHealth(healthResult.data) || !isReconciliationQueue(reconciliationResult.data)
    ) {
      return ownerAccessJsonResponse({ error: "owner_fulfillment_unavailable" }, 503);
    }

    return ownerAccessJsonResponse({
      stores: configuration.stores,
      centers: configuration.centers,
      routes: configuration.routes,
      assignments: configuration.assignments,
      rollouts: configuration.rollouts,
      staff: staffResult.data,
      health: healthResult.data,
      reconciliationItems: reconciliationResult.data.items,
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    if (["create_center", "update_center", "archive_center"].includes(String(body.action))) {
      if (!hasOnlyKeys(body, ["action", "centerId", "code", "name", "isDefault", "postalCode", "addressLine1", "addressLine2", "contactName", "contactPhone", "expectedVersion", "idempotencyKey"]) ||
        !isUuid(body.idempotencyKey) ||
        (body.action !== "create_center" && !isUuid(body.centerId)) ||
        !nonNegativeInteger(body.expectedVersion) ||
        (body.action !== "archive_center" && (!normalizedText(body.code, 2, 80) || !normalizedText(body.name, 1, 120))) ||
        optionalText(body.postalCode, 20) === undefined ||
        optionalText(body.addressLine1, 240) === undefined ||
        optionalText(body.addressLine2, 240) === undefined ||
        optionalText(body.contactName, 80) === undefined ||
        optionalText(body.contactPhone, 40) === undefined ||
        typeof body.isDefault !== "boolean") {
        return ownerAccessJsonResponse({ error: "invalid_center_request", message: "센터 입력 내용을 확인해 주세요." }, 400);
      }
      const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
        "configure_managed_fulfillment_center",
        {
          p_action: body.action === "create_center" ? "create" : body.action === "update_center" ? "update" : "archive",
          p_center_id: body.action === "create_center" ? null : body.centerId,
          p_code: body.code,
          p_name: body.name,
          p_is_default: body.isDefault,
          p_postal_code: optionalText(body.postalCode, 20),
          p_address_line1: optionalText(body.addressLine1, 240),
          p_address_line2: optionalText(body.addressLine2, 240),
          p_contact_name: optionalText(body.contactName, 80),
          p_contact_phone: optionalText(body.contactPhone, 40),
          p_expected_version: body.expectedVersion,
          p_idempotency_key: body.idempotencyKey,
        },
      );
      if (error) return rpcFailure(error, "center_configuration_unavailable");
      if (!isConfiguredCenter(data)) return ownerAccessJsonResponse({ error: "center_configuration_unavailable" }, 503);
      return ownerAccessJsonResponse({ center: data });
    }
    if (body.action === "reconcile_item") {
      if (!hasOnlyKeys(body, [
        "action", "inventoryItemId", "expectedVersion", "reason", "idempotencyKey",
      ])) {
        return ownerAccessJsonResponse(
          { error: "invalid_fulfillment_request", message: "미조정 상품 요청을 확인해 주세요." },
          400,
        );
      }
      const reason = normalizedText(body.reason, 3, 500);
      if (!isUuid(body.inventoryItemId) || !nonNegativeInteger(body.expectedVersion) ||
        !reason || !isUuid(body.idempotencyKey)) {
        return ownerAccessJsonResponse(
          { error: "invalid_fulfillment_request", message: "미조정 상품의 경로 적용 사유를 확인해 주세요." },
          400,
        );
      }
      const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
        "reconcile_inventory_item_route",
        {
          p_inventory_item_id: body.inventoryItemId,
          p_expected_version: body.expectedVersion,
          p_idempotency_key: body.idempotencyKey,
          p_reason: reason,
        },
      );
      if (error) return rpcFailure(error, "inventory_reconciliation_unavailable");
      if (!isReconciledItem(data)) {
        return ownerAccessJsonResponse({ error: "inventory_reconciliation_unavailable" }, 503);
      }
      return ownerAccessJsonResponse({ inventoryItem: data });
    }
    if (body.action === "configure_assignment") {
      if (!hasOnlyKeys(body, [
        "action", "centerId", "userId", "status", "expectedVersion",
        "idempotencyKey",
      ]) || !isUuid(body.centerId) || !isUuid(body.userId) ||
        !["active", "inactive"].includes(String(body.status)) ||
        !nonNegativeInteger(body.expectedVersion) || !isUuid(body.idempotencyKey)) {
        return ownerAccessJsonResponse(
          { error: "invalid_fulfillment_request", message: "센터 담당자 권한을 확인해 주세요." },
          400,
        );
      }
      const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
        "configure_fulfillment_center_staff_assignment",
        {
          p_fulfillment_center_id: body.centerId,
          p_user_id: body.userId,
          p_receive_at_center: true,
          p_create_shipments: true,
          p_status: body.status,
          p_expected_version: body.expectedVersion,
          p_idempotency_key: body.idempotencyKey,
        },
      );
      if (error) return rpcFailure(error, "center_assignment_unavailable");
      if (!isConfiguredAssignment(data)) {
        return ownerAccessJsonResponse({ error: "center_assignment_unavailable" }, 503);
      }
      return ownerAccessJsonResponse({ assignment: data });
    }
    if (body.action === "delete_assignment") {
      if (!hasOnlyKeys(body, [
        "action", "centerId", "userId", "expectedVersion", "idempotencyKey",
      ]) ||
        !isUuid(body.centerId) ||
        !isUuid(body.userId) ||
        !nonNegativeInteger(body.expectedVersion) ||
        !isUuid(body.idempotencyKey)) {
        return ownerAccessJsonResponse(
          { error: "invalid_fulfillment_request", message: "삭제할 센터 배정을 확인해 주세요." },
          400,
        );
      }
      const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
        "delete_fulfillment_center_staff_assignment",
        {
          p_fulfillment_center_id: body.centerId,
          p_user_id: body.userId,
          p_expected_version: body.expectedVersion,
          p_idempotency_key: body.idempotencyKey,
        },
      );
      if (error) return rpcFailure(error, "center_assignment_delete_unavailable");
      if (!isDeletedAssignment(data)) {
        return ownerAccessJsonResponse({ error: "center_assignment_delete_unavailable" }, 503);
      }
      return ownerAccessJsonResponse({ assignment: data });
    }
    if (body.action === "configure_rollout") {
      if (!hasOnlyKeys(body, [
        "action", "businessId", "entitlementProjectionEnabled", "unifiedInventoryReadsEnabled",
        "itemSelectedShipmentsEnabled", "shippingFeeAmount", "expectedVersion", "idempotencyKey",
      ]) || !isUuid(body.businessId) || typeof body.entitlementProjectionEnabled !== "boolean" ||
        typeof body.unifiedInventoryReadsEnabled !== "boolean" || typeof body.itemSelectedShipmentsEnabled !== "boolean" ||
        !Number.isSafeInteger(body.shippingFeeAmount) || Number(body.shippingFeeAmount) < 1 || Number(body.shippingFeeAmount) > 1_000_000 ||
        !nonNegativeInteger(body.expectedVersion) || !isUuid(body.idempotencyKey)) {
        return ownerAccessJsonResponse(
          { error: "invalid_fulfillment_request", message: "단계별 전환과 배송비 설정을 확인해 주세요." },
          400,
        );
      }
      const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
        "configure_inventory_fulfillment_rollout",
        {
          p_business_id: body.businessId,
          p_entitlement_projection_enabled: body.entitlementProjectionEnabled,
          p_unified_inventory_reads_enabled: body.unifiedInventoryReadsEnabled,
          p_item_selected_shipments_enabled: body.itemSelectedShipmentsEnabled,
          p_shipping_fee_amount: body.shippingFeeAmount,
          p_expected_version: body.expectedVersion,
          p_idempotency_key: body.idempotencyKey,
        },
      );
      if (error) return rpcFailure(error, "fulfillment_rollout_unavailable");
      if (!isRecord(data) || !isUuid(data.id) || !nonNegativeInteger(data.version) ||
        typeof data.entitlement_projection_enabled !== "boolean" ||
        typeof data.unified_inventory_reads_enabled !== "boolean" ||
        typeof data.item_selected_shipments_enabled !== "boolean" ||
        !Number.isSafeInteger(data.shipping_fee_amount) || typeof data.idempotent_replay !== "boolean") {
        return ownerAccessJsonResponse({ error: "fulfillment_rollout_unavailable" }, 503);
      }
      return ownerAccessJsonResponse({ rollout: data });
    }
    if (!hasOnlyKeys(body, [
      "storeId",
      "centerId",
      "routeMode",
      "expectedVersion",
      "idempotencyKey",
      "reason",
    ])) {
      return ownerAccessJsonResponse(
        { error: "invalid_fulfillment_request", message: "입력 내용을 확인해 주세요." },
        400,
      );
    }

    const reason = optionalText(body.reason, 1_000);
    if (
      !isUuid(body.storeId) ||
      !isUuid(body.centerId) ||
      typeof body.routeMode !== "string" ||
      !ROUTE_MODES.has(body.routeMode) ||
      !nonNegativeInteger(body.expectedVersion) ||
      !isUuid(body.idempotencyKey) ||
      reason === undefined
    ) {
      return ownerAccessJsonResponse(
        { error: "invalid_fulfillment_request", message: "매장 경로 입력을 확인해 주세요." },
        400,
      );
    }

    const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
      "configure_store_fulfillment_route",
      {
        p_store_id: body.storeId,
        p_fulfillment_center_id: body.centerId,
        p_route_mode: body.routeMode,
        p_expected_version: body.expectedVersion,
        p_idempotency_key: body.idempotencyKey,
        p_reason: reason,
      },
    );
    if (error) return rpcFailure(error, "store_route_configuration_unavailable");
    if (!isConfiguredRoute(data)) {
      return ownerAccessJsonResponse({ error: "store_route_configuration_unavailable" }, 503);
    }
    return ownerAccessJsonResponse({ route: data });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
