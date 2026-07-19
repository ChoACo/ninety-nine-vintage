import type { AuctionPost } from "@/src/types/auction";
import { getProductFeedDetails } from "@/src/utils/productFeedDetails";

export type CommerceProductView = {
  id: string;
  name: string;
  brand: string;
  description: string;
  size: string;
  condition: string;
  thumbnailUrl: string;
  imageUrls: readonly string[];
  saleType: AuctionPost["saleType"];
  status: AuctionPost["status"];
};

const brandedPrefix = /^\s*(?:\(?#?ninety[_\s-]*nine\)?|ninety[_\s-]*nine)\s*/iu;
const titlePrefix = /^\s*(?:name|상품명)\s*:\s*/iu;

export function cleanCommerceText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(brandedPrefix, "")
    .replace(titlePrefix, "")
    .replace(/^\s*\[[^\]\r\n]*\]\s*/u, "")
    .replace(/^\s*\(\s*#?[^)]{1,40}\)\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function descriptionWithoutLegacyHeader(description: string) {
  return description
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\(?#?ninety[_\s-]*nine\)?|name|size|상품\s*상태|price)\s*[:：]?/iu.test(line))
    .join("\n")
    .trim();
}

export function toCommerceProductView(product: AuctionPost): CommerceProductView {
  const details = getProductFeedDetails(product);
  const inferredName = cleanCommerceText(details.name) || cleanCommerceText(product.title) || "빈티지 의류";
  const brand = cleanCommerceText(inferredName.split(/\s+/u)[0]) || "NINETY-NINE";
  const description = descriptionWithoutLegacyHeader(product.description) || cleanCommerceText(product.description);

  return {
    id: product.id,
    name: inferredName,
    brand,
    description,
    size: cleanCommerceText(details.size) || "표기 없음",
    condition: cleanCommerceText(details.condition) || "상세 사진 참고",
    thumbnailUrl: product.thumbnailUrls[0] || product.imageUrls[0] || "",
    imageUrls: product.imageUrls,
    saleType: product.saleType,
    status: product.status,
  };
}
