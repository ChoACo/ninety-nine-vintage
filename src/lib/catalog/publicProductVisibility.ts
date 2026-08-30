interface AuctionVisibilityOptions {
  includeClosingWinners?: boolean;
}

function activeAuctionClause(nowIso: string, includeSaleType: boolean) {
  const saleType = includeSaleType ? "sale_type.eq.auction," : "";
  return `and(${saleType}status.eq.active,auction_feed_expires_at.gt.${nowIso},closes_at.gt.${nowIso},final_bid_id.is.null)`;
}

function closingWinnerClause(includeSaleType: boolean) {
  const saleType = includeSaleType ? "sale_type.eq.auction," : "";
  return `and(${saleType}status.eq.closed,final_bid_id.not.is.null,final_bid_amount.not.is.null,sale_completed_at.is.null)`;
}

export function buildPublicCatalogVisibilityFilter(nowIso: string) {
  return [
    "and(sale_type.eq.fixed,status.eq.active)",
    activeAuctionClause(nowIso, true),
  ].join(",");
}

export function buildAuctionCatalogVisibilityFilter(
  nowIso: string,
  { includeClosingWinners = false }: AuctionVisibilityOptions = {},
) {
  const clauses = [activeAuctionClause(nowIso, false)];
  if (includeClosingWinners) clauses.push(closingWinnerClause(false));
  return clauses.join(",");
}

export function buildPublicProductDetailVisibilityFilter(nowIso: string) {
  return [
    buildPublicCatalogVisibilityFilter(nowIso),
    closingWinnerClause(true),
  ].join(",");
}
