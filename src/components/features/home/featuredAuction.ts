export interface FeaturedAuctionSource {
  bidHistory: unknown;
  brand: string;
  currentPrice: number;
  id: string;
  imageUrls: string[];
  participantCount: number;
  status: string;
  title: string;
}

function activeBidCount(product: FeaturedAuctionSource) {
  if (!Array.isArray(product.bidHistory)) return 0;
  return product.bidHistory.filter((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const outcome = (entry as Record<string, unknown>).outcome;
    return outcome !== "cancelled" && outcome !== "unpaid_cancelled";
  }).length;
}

function latestBidTime(product: FeaturedAuctionSource) {
  if (!Array.isArray(product.bidHistory)) return Number.NEGATIVE_INFINITY;
  return product.bidHistory.reduce((latest, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return latest;
    }
    const timestamp = Date.parse(
      String((entry as Record<string, unknown>).bidAt ?? ""),
    );
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, Number.NEGATIVE_INFINITY);
}

function maxBy(
  products: FeaturedAuctionSource[],
  score: (product: FeaturedAuctionSource) => number,
) {
  return products.reduce<FeaturedAuctionSource | null>((best, product) => {
    if (!best || score(product) > score(best)) return product;
    return best;
  }, null);
}

export function selectFeaturedAuctionCandidates(
  products: FeaturedAuctionSource[],
) {
  const active = products.filter((product) => product.status === "active");
  if (active.length === 0) return [];

  const highestPrice = maxBy(active, (product) => product.currentPrice);
  const latestBid = maxBy(
    active.filter((product) => Number.isFinite(latestBidTime(product))),
    latestBidTime,
  );
  const mostBids = maxBy(
    active.filter((product) => activeBidCount(product) > 0),
    activeBidCount,
  );

  return [highestPrice, latestBid, mostBids].filter(
    (product, index, candidates): product is FeaturedAuctionSource => {
      if (!product) return false;
      return candidates.findIndex((candidate) => candidate?.id === product.id)
        === index;
    },
  );
}

export function shuffleFeaturedAuctionCandidates(
  products: FeaturedAuctionSource[],
  random: () => number = Math.random,
) {
  const shuffled = [...products];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}
