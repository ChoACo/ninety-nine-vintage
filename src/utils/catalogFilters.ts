import type { AuctionPost } from "@/src/types/auction";
import { getProductFeedDetails } from "@/src/utils/productFeedDetails";

export type CatalogSort = "latest" | "closing" | "price-desc" | "price-asc";
export type CatalogSize = "all" | "S" | "M" | "L" | "XL";

const GARMENT_SIZE_PATTERN = /(^|[^A-Z])(XXL|XL|XS|S|M|L)(?=$|[^A-Z])/g;

export function getCatalogSizeTokens(post: AuctionPost): ReadonlySet<string> {
  const normalized = (getProductFeedDetails(post).size ?? "")
    .normalize("NFKC")
    .toUpperCase();
  const sizes = new Set<string>();
  let match: RegExpExecArray | null;

  GARMENT_SIZE_PATTERN.lastIndex = 0;
  while ((match = GARMENT_SIZE_PATTERN.exec(normalized))) {
    sizes.add(match[2]);
  }
  GARMENT_SIZE_PATTERN.lastIndex = 0;
  return sizes;
}

export function matchesCatalogSize(
  post: AuctionPost,
  size: CatalogSize,
): boolean {
  return size === "all" || getCatalogSizeTokens(post).has(size);
}

export function matchesCatalogSearch(post: AuctionPost, query: string): boolean {
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
  if (!normalizedQuery) return true;

  const details = getProductFeedDetails(post);
  return [
    post.title,
    post.description,
    post.category,
    details.name,
    details.size,
    details.condition ?? "",
  ]
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .includes(normalizedQuery);
}

function validTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function sortCatalogPosts(
  posts: readonly AuctionPost[],
  sort: CatalogSort,
): AuctionPost[] {
  if (sort === "latest") return [...posts];

  return posts
    .map((post, originalIndex) => ({ post, originalIndex }))
    .sort((left, right) => {
      let difference = 0;
      if (sort === "closing") {
        difference = validTime(left.post.closesAt) - validTime(right.post.closesAt);
      } else if (sort === "price-desc") {
        difference = right.post.currentPrice - left.post.currentPrice;
      } else {
        difference = left.post.currentPrice - right.post.currentPrice;
      }

      return difference || left.originalIndex - right.originalIndex;
    })
    .map(({ post }) => post);
}
