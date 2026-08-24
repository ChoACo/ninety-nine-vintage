import {
  authenticateMemberRlsRequest,
  commerceJson,
} from "@/lib/commerce/server";
import { ACTIVE_COMMERCE_PAYMENT_MODE } from "@/lib/commerce/paymentMode";
import { getCatalogImageUrl } from "@/lib/images";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";
import { enforceCartRateLimit } from "@/lib/ratelimit/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";
import { mapPublishedProduct } from "@/services/products";

type ShippingQuote = {
  productSubtotal: number;
  shippingFee: number;
  total: number;
  chargeCount: number;
  charges: Array<{
    chargeKey: string;
    mode: "per_store" | "per_group";
    groupId: string | null;
    groupName: string | null;
    unitKind: "store" | "fulfillment_group";
    unitName: string;
    billingStoreId: string;
    billingStoreName: string;
    amount: number;
    vaultAmount?: number;
    productSubtotal: number;
    productIds: string[];
    products: Array<{ id: string; title: string; amount: number }>;
    storeIds: string[];
    storeNames: string[];
  }>;
};

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export async function GET(request: Request) {
  const auth = await authenticateMemberRlsRequest(request);
  if (!auth.ok) return auth.response;
  const { admin } = createSupabaseServerClients();
  const paymentStatusPromise = getManualTransferAccount(admin)
    .then(() => true)
    .catch((paymentError: unknown) => {
      console.error("[cart:get] manual transfer account unavailable", {
        message:
          paymentError instanceof Error
            ? paymentError.message
            : "unknown error",
      });
      return false;
    });
  const reservationResult = await auth.user.rpc("get_my_cart_reservations");
  let reservations = reservationResult.data ?? [];
  if (reservationResult.error) {
    console.error(
      "[cart:get] reservation RPC failed; using RLS table fallback",
      {
        code: reservationResult.error.code,
        message: reservationResult.error.message,
      },
    );
    const fallbackResult = await auth.user
      .from("cart_items")
      .select("product_id,created_at,reserved_until")
      .eq("member_id", auth.userId)
      .order("created_at", { ascending: false });
    if (fallbackResult.error) {
      console.error("[cart:get] RLS table fallback failed", {
        code: fallbackResult.error.code,
        message: fallbackResult.error.message,
      });
      return commerceJson({ error: "cart_unavailable" }, 503);
    }
    const serverTime = new Date().toISOString();
    reservations = (fallbackResult.data ?? []).map((item) => ({
      ...item,
      server_time: serverTime,
    }));
  }
  const paymentMode = (await paymentStatusPromise)
    ? ACTIVE_COMMERCE_PAYMENT_MODE
    : "unavailable";
  const ids = reservations.map((item) => item.product_id);
  if (ids.length === 0) {
    return commerceJson({
      items: [],
      paymentMode,
      productIds: [],
      reservations: [],
      serverTime: null,
      shippingFee: 0,
      shippingCharges: [],
      shippingAvailable: true,
    });
  }
  const { data: products, error: productError } = await admin
    .from("products")
    .select("*,stores(name,slug)")
    .in("id", ids)
    .eq("sale_type", "fixed")
    .lte("publish_at", new Date().toISOString());
  if (productError) {
    console.error("[cart:get] product relation query failed", {
      code: productError.code,
      message: productError.message,
    });
    return commerceJson({ error: "cart_unavailable" }, 503);
  }
  const activeProducts = (products ?? []).filter(
    (product) => product.status === "active",
  );
  const liveIds = activeProducts.map((product) => product.id);
  const eligibility = await Promise.all(
    liveIds.map(async (productId) => {
      const { data: canPurchase, error: eligibilityError } =
        await auth.user.rpc("can_purchase_product", {
          p_product_id: productId,
        });
      return {
        canPurchase: canPurchase === true,
        error: eligibilityError,
        productId,
      };
    }),
  );
  if (eligibility.some((result) => result.error)) {
    console.error("[cart:get] purchase eligibility query failed", {
      failures: eligibility.filter((result) => result.error).length,
    });
    return commerceJson({ error: "cart_unavailable" }, 503);
  }
  const purchasableIds = eligibility
    .filter((result) => result.canPurchase)
    .map((result) => result.productId);
  const purchasableIdSet = new Set(purchasableIds);
  const purchasableProducts = activeProducts.filter((product) =>
    purchasableIdSet.has(product.id),
  );

  const { data: orderItemRows, error: orderItemError } = await admin
    .from("commerce_order_items")
    .select("order_id, product_id")
    .in("product_id", ids);
  if (orderItemError) {
    console.error("[cart:get] pending lock item query failed", {
      code: orderItemError.code,
      message: orderItemError.message,
    });
    return commerceJson({ error: "cart_unavailable" }, 503);
  }
  const candidateOrderIds = [
    ...new Set((orderItemRows ?? []).map((item) => item.order_id)),
  ];
  const [orderRowsResult, transferRowsResult] =
    candidateOrderIds.length === 0
      ? [
          { data: [], error: null },
          { data: [], error: null },
        ]
      : await Promise.all([
          admin
            .from("commerce_orders")
            .select("id, member_id, status, payment_due_at")
            .in("id", candidateOrderIds)
            .in("status", ["awaiting_payment", "partially_paid"])
            .neq("member_id", auth.userId),
          admin
            .from("commerce_order_transfers")
            .select("order_id, status, payment_due_at")
            .in("order_id", candidateOrderIds)
            .in("status", ["awaiting_transfer", "partially_paid"]),
        ]);
  if (orderRowsResult.error || transferRowsResult.error) {
    console.error("[cart:get] pending lock ledger query failed", {
      orderCode: orderRowsResult.error?.code,
      transferCode: transferRowsResult.error?.code,
    });
    return commerceJson({ error: "cart_unavailable" }, 503);
  }
  const orderById = new Map(
    (orderRowsResult.data ?? []).map((order) => [order.id, order]),
  );
  const transferByOrderId = new Map(
    (transferRowsResult.data ?? []).map((transfer) => [
      transfer.order_id,
      transfer,
    ]),
  );
  const pendingLockByProductId = new Map<
    string,
    { kind: "buy_now_payment"; until: string | null }
  >();
  for (const item of orderItemRows ?? []) {
    const order = orderById.get(item.order_id);
    const transfer = transferByOrderId.get(item.order_id);
    if (!order || !transfer) continue;
    const dueTimestamps = [order.payment_due_at, transfer.payment_due_at]
      .flatMap((value) =>
        value && Number.isFinite(Date.parse(value)) ? [value] : [],
      )
      .sort((left, right) => Date.parse(right) - Date.parse(left));
    pendingLockByProductId.set(item.product_id, {
      kind: "buy_now_payment",
      until: dueTimestamps[0] ?? null,
    });
  }
  const lockedProducts = (products ?? []).filter(
    (product) =>
      product.status === "closed" && pendingLockByProductId.has(product.id),
  );
  const visibleProductIds = [
    ...purchasableIds,
    ...lockedProducts.map((product) => product.id),
  ];
  const visibleProductIdSet = new Set(visibleProductIds);
  if (purchasableIds.length === 0) {
    const items = lockedProducts.map(mapPublishedProduct).map((product) => ({
      ...product,
      imageUrls: product.imageUrls.map((image) => getCatalogImageUrl(image)),
      thumbnailUrls: product.thumbnailUrls.map((image) =>
        getCatalogImageUrl(image, 320),
      ),
      pendingLock: pendingLockByProductId.get(product.id) ?? null,
      reservationExpiresAt:
        reservations.find((reservation) => reservation.product_id === product.id)
          ?.reserved_until ?? null,
    }));
    return commerceJson({
      items,
      paymentMode,
      productIds: visibleProductIds,
      reservations: reservations.map((reservation) => ({
        productId: reservation.product_id,
        reservedUntil: reservation.reserved_until,
      })),
      serverTime: reservations[0]?.server_time ?? null,
      shippingFee: 0,
      shippingCharges: [],
      shippingAvailable: true,
      quoteTotal: 0,
      staleProductIds: ids.filter((id) => !visibleProductIdSet.has(id)),
    });
  }
  const shippingRegion =
    new URL(request.url).searchParams.get("shippingRegion") === "remote_area"
      ? "remote_area"
      : "regular";
  const quoteResult = await (auth.user as unknown as RpcClient).rpc(
    "quote_commerce_shipping_fee",
    { p_product_ids: purchasableIds, p_shipping_region: shippingRegion },
  );
  const quote =
    quoteResult.data && typeof quoteResult.data === "object"
      ? (quoteResult.data as ShippingQuote)
      : null;
  if (quoteResult.error || !quote) {
    console.error("[cart:get] shipping quote unavailable", {
      message: quoteResult.error?.message ?? "empty quote",
    });
  }
  const shippingFee = Number(quote?.shippingFee ?? 0);
  const chargesAreValid =
    Array.isArray(quote?.charges) &&
    quote.charges.length > 0 &&
    quote.charges.every(
      (charge) =>
        charge &&
        typeof charge.chargeKey === "string" &&
        (charge.unitKind === "store" ||
          charge.unitKind === "fulfillment_group") &&
        typeof charge.unitName === "string" &&
        Boolean(charge.unitName.trim()) &&
        typeof charge.billingStoreName === "string" &&
        Boolean(charge.billingStoreName.trim()) &&
        Number.isSafeInteger(Number(charge.amount)) &&
        Number(charge.amount) > 0 &&
        Number.isSafeInteger(Number(charge.productSubtotal)) &&
        Number(charge.productSubtotal) > 0 &&
        Array.isArray(charge.storeIds) &&
        charge.storeIds.length > 0 &&
        Array.isArray(charge.productIds) &&
        charge.productIds.length > 0 &&
        Array.isArray(charge.products) &&
        charge.products.length === charge.productIds.length,
    );
  const shippingAvailable =
    !quoteResult.error &&
    Number.isSafeInteger(shippingFee) &&
    shippingFee > 0 &&
    chargesAreValid;
  if (!shippingAvailable)
    console.error("[cart:get] invalid shipping quote shape");
  const quotedCharges =
    shippingAvailable && Array.isArray(quote?.charges) ? quote.charges : [];
  const quotedStoreIds = [
    ...new Set(quotedCharges.flatMap((charge) => charge.storeIds)),
  ];
  const [storeRows, entitlementRows] = await Promise.all([
    quotedStoreIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin.from("stores").select("id, business_id").in("id", quotedStoreIds),
    admin
      .from("shipping_fee_waiver_entitlements")
      .select("business_id")
      .eq("member_id", auth.userId)
      .eq("status", "available"),
  ]);
  const storeBusinessIds = new Map(
    (storeRows.data ?? []).map((store) => [store.id, store.business_id]),
  );
  const availableBusinessIds = new Set(
    (entitlementRows.data ?? []).map((row) => row.business_id),
  );
  const creditStateAvailable = !storeRows.error && !entitlementRows.error;
  const shippingCharges = quotedCharges.map((charge) => {
    const businessId = charge.storeIds
      .map((storeId) => storeBusinessIds.get(storeId))
      .find((value): value is string => typeof value === "string");
    return {
      ...charge,
      vaultAmount:
        creditStateAvailable &&
        businessId &&
        availableBusinessIds.has(businessId)
          ? 0
          : charge.amount,
    };
  });
  const vaultShippingFee = shippingCharges.reduce(
    (total, charge) => total + charge.vaultAmount,
    0,
  );
  const reservationByProduct = new Map(
    reservations.map((reservation) => [
      reservation.product_id,
      reservation.reserved_until,
    ]),
  );
  const items = [...purchasableProducts, ...lockedProducts]
    .map(mapPublishedProduct)
    .map((product) => ({
    ...product,
    imageUrls: product.imageUrls.map((image) => getCatalogImageUrl(image)),
    thumbnailUrls: product.thumbnailUrls.map((image) =>
      getCatalogImageUrl(image, 320),
    ),
    pendingLock: pendingLockByProductId.get(product.id) ?? null,
    reservationExpiresAt: reservationByProduct.get(product.id) ?? null,
    }));
  return commerceJson({
    items,
    paymentMode,
    productIds: visibleProductIds,
    reservations: reservations.map((reservation) => ({
      productId: reservation.product_id,
      reservedUntil: reservation.reserved_until,
    })),
    serverTime: reservations[0]?.server_time ?? null,
    shippingFee: shippingAvailable ? shippingFee : 0,
    shippingCharges,
    vaultShippingFee,
    shippingCreditBusinessIds: creditStateAvailable
      ? [...availableBusinessIds]
      : [],
    shippingAvailable,
    quoteTotal: shippingAvailable
      ? Number(quote?.total)
      : Number(quote?.productSubtotal ?? 0),
    staleProductIds: ids.filter((id) => !visibleProductIdSet.has(id)),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberRlsRequest(request, true);
  if (!auth.ok) return auth.response;
  const rateLimit = await enforceCartRateLimit(request, auth.userId);
  if (!rateLimit.ok) return rateLimit.response;
  const body = (await request.json().catch(() => null)) as {
    productId?: string;
  } | null;
  if (!body?.productId)
    return commerceJson({ error: "상품을 선택해 주세요." }, 400);

  const { data, error } = await auth.user
    .rpc("reserve_fixed_product_for_cart", {
      p_product_id: body.productId,
    })
    .single();
  if (error) {
    const status =
      error.code === "22023"
        ? 400
        : error.code === "42501"
          ? 403
          : error.code === "P0002"
            ? 404
            : ["23505", "P0001"].includes(error.code ?? "")
              ? 409
              : 503;
    return commerceJson(
      { error: error.message || "cart_update_failed" },
      status,
    );
  }
  if (!data) return commerceJson({ error: "cart_update_failed" }, 503);
  return commerceJson(
    {
      productId: data.product_id,
      reservedUntil: data.reserved_until,
      serverTime: data.server_time,
    },
    201,
  );
}

export async function DELETE(request: Request) {
  const auth = await authenticateMemberRlsRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    productId?: string;
  } | null;
  if (!body?.productId)
    return commerceJson({ error: "상품을 선택해 주세요." }, 400);
  const { data, error } = await auth.user.rpc("release_my_cart_reservation", {
    p_product_id: body.productId,
  });
  if (error) return commerceJson({ error: "cart_update_failed" }, 503);
  return commerceJson({
    removed: data,
    removedProductId: body.productId,
  });
}
