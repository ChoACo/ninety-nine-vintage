import type { AuctionPost } from "@/src/types/auction";
import { getProductFeedDetails } from "@/src/utils/productFeedDetails";

export type CatalogSort = "latest" | "closing" | "price-desc" | "price-asc";
export type CatalogSize = "all" | "S" | "M" | "L" | "XL";
export type CatalogGender = "all" | "남성" | "여성" | "공용";
export type CatalogCategory =
  | "all"
  | "아우터"
  | "셔츠"
  | "티셔츠"
  | "니트"
  | "팬츠"
  | "데님"
  | "스커트"
  | "원피스"
  | "기타";

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

function catalogText(post: AuctionPost): string {
  const details = getProductFeedDetails(post);
  return [post.title, post.description, post.category, details.name, details.size ?? ""]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR");
}

export function getCatalogGender(post: AuctionPost): Exclude<CatalogGender, "all"> {
  const text = catalogText(post);
  if (/(여성|여자|woman|women|ladies|걸즈)/i.test(text)) return "여성";
  if (/(남성|남자|man|men|보이즈)/i.test(text)) return "남성";
  return "공용";
}

export function getCatalogCategory(post: AuctionPost): Exclude<CatalogCategory, "all"> {
  const text = catalogText(post);
  if (/(자켓|재킷|코트|점퍼|패딩|블루종|아우터|파카|베스트)/i.test(text)) return "아우터";
  if (/(셔츠|shirt|blouse)/i.test(text)) return "셔츠";
  if (/(티셔츠|반팔|긴팔|tee|t-shirt|후드|맨투맨)/i.test(text)) return "티셔츠";
  if (/(니트|스웨터|가디건|knit|sweater)/i.test(text)) return "니트";
  if (/(데님|청바지|진|denim|jean)/i.test(text)) return "데님";
  if (/(팬츠|바지|슬랙스|트라우저|pants|trouser)/i.test(text)) return "팬츠";
  if (/(스커트|치마|skirt)/i.test(text)) return "스커트";
  if (/(원피스|드레스|dress)/i.test(text)) return "원피스";
  return "기타";
}

export function getCatalogBrand(post: AuctionPost): string {
  const structuredBrand = post.brand?.normalize("NFKC").trim();
  if (structuredBrand) return structuredBrand;
  const details = getProductFeedDetails(post);
  const firstToken = details.name
    .replace(/^\[[^\]]+\]\s*/u, "")
    .trim()
    .split(/\s+/u)[0]
    ?.replace(/[^\p{L}\p{N}&.-]/gu, "");
  return firstToken || "기타";
}

export function matchesCatalogGender(post: AuctionPost, gender: CatalogGender): boolean {
  return gender === "all" || getCatalogGender(post) === gender;
}

export function matchesCatalogCategory(post: AuctionPost, category: CatalogCategory): boolean {
  return category === "all" || getCatalogCategory(post) === category;
}

export function matchesCatalogBrand(post: AuctionPost, brand: string): boolean {
  return brand === "all" || getCatalogBrand(post) === brand;
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
