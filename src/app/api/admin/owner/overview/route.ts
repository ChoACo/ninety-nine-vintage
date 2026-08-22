import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const DAY = 86_400_000;

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);

  const storeId = new URL(request.url).searchParams.get("storeId");
  if (storeId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(storeId)) return commerceJson({ error: "invalid_store_scope" }, 400);
  const now = new Date();
  const currentFrom = new Date(now.getTime() - 13 * DAY);
  const previousFrom = new Date(now.getTime() - 27 * DAY);
  let settlements = auth.admin.from("store_settlement_entries").select("store_id,entry_kind,amount,created_at").gte("created_at", previousFrom.toISOString());
  let auctions = auth.admin.from("products").select("store_id,status,final_bid_id").eq("sale_type", "auction").in("status", ["active", "closed"]);
  let vault = auth.admin.from("customer_inventory_items").select("origin_store_id,storage_started_at,storage_expires_at").eq("ownership_status", "active");
  let shipments = auth.admin.from("inventory_shipment_items").select("origin_store_id,inventory_shipments!inner(shipped_at)").eq("line_status", "shipped").gte("inventory_shipments.shipped_at", currentFrom.toISOString());
  if (storeId) {
    settlements = settlements.eq("store_id", storeId); auctions = auctions.eq("store_id", storeId);
    vault = vault.eq("origin_store_id", storeId); shipments = shipments.eq("origin_store_id", storeId);
  }
  const [storeResult, auditResult, settlementResult, auctionResult, vaultResult, shipmentResult, sessionResult] = await Promise.all([
    auth.admin.from("stores").select("id,name,slug,description,operator_id,is_active").order("name"),
    auth.admin.from("security_activity_logs").select("id", { count: "exact", head: true }), settlements.limit(10_000), auctions.limit(10_000), vault.limit(10_000), shipments.limit(10_000),
    auth.admin.from("security_session_records").select("id", { count: "exact", head: true }).gte("last_seen_at", new Date(now.getTime() - 300_000).toISOString()),
  ]);
  if ([storeResult, settlementResult, auctionResult, vaultResult, shipmentResult].some((result) => result.error)) return commerceJson({ error: "owner_overview_unavailable", dbConnected: false }, 503);
  const settlementRows = settlementResult.data ?? []; const auctionRows = auctionResult.data ?? []; const vaultRows = vaultResult.data ?? []; const shipmentRows = shipmentResult.data ?? [];
  const sumSales = (date: string) => settlementRows.filter((row) => row.created_at.slice(0, 10) === date && row.entry_kind === "item_sale").reduce((sum, row) => sum + Number(row.amount), 0);
  const revenue = Array.from({ length: 14 }, (_, index) => { const day = new Date(currentFrom.getTime() + index * DAY); const key = day.toISOString().slice(0, 10); return { date: key.slice(5).replace("-", "/"), amount: sumSales(key), previousAmount: sumSales(new Date(day.getTime() - 14 * DAY).toISOString().slice(0, 10)) }; });
  const recent = (createdAt: string) => Date.parse(createdAt) >= currentFrom.getTime();
  const closed = auctionRows.filter((row) => row.status === "closed");
  const vaultFlow = Array.from({ length: 14 }, (_, index) => { const key = new Date(currentFrom.getTime() + index * DAY).toISOString().slice(0, 10); return { date: key.slice(5).replace("-", "/"), stored: vaultRows.filter((row) => row.storage_started_at?.slice(0, 10) === key).length, shipped: shipmentRows.filter((row) => { const shipment = Array.isArray(row.inventory_shipments) ? row.inventory_shipments[0] : row.inventory_shipments; return shipment?.shipped_at?.slice(0, 10) === key; }).length }; });
  return commerceJson({ stores: storeResult.data ?? [], selectedStoreId: storeId, auditCount: auditResult.count ?? 0, dbConnected: true, activeSessions: sessionResult.count ?? 0,
    metrics: { gmv: settlementRows.filter((row) => row.entry_kind === "item_sale" && recent(row.created_at)).reduce((sum, row) => sum + Number(row.amount), 0), netCommission: settlementRows.filter((row) => row.entry_kind === "commission" && recent(row.created_at)).reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0), activeAuctions: auctionRows.filter((row) => row.status === "active").length, vaultItems: vaultRows.length, vaultRiskCount: vaultRows.filter((row) => row.storage_expires_at && Date.parse(row.storage_expires_at) <= now.getTime() + 3 * DAY).length },
    analytics: { revenue, auction: { sold: closed.filter((row) => row.final_bid_id).length, unsold: closed.filter((row) => !row.final_bid_id).length }, vaultFlow } });
}
