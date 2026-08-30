import type { Metadata } from "next";
import { getCatalogImageUrl } from "@/lib/images";

export const PUBLIC_SITE_ORIGIN = "https://www.ninety-nine-vintage.store";

const BRAND_ALIASES = [
  ["NIKE", "나이키"],
  ["ADIDAS", "아디다스"],
  ["PUMA", "푸마"],
  ["REEBOK", "리복"],
  ["NEW BALANCE", "뉴발란스"],
  ["CONVERSE", "컨버스"],
  ["VANS", "반스"],
  ["ASICS", "아식스"],
  ["FILA", "휠라"],
  ["CHAMPION", "챔피온"],
  ["THE NORTH FACE", "노스페이스"],
  ["PATAGONIA", "파타고니아"],
  ["CARHARTT", "칼하트"],
  ["LEVI'S", "리바이스"],
  ["POLO RALPH LAUREN", "폴로 랄프로렌"],
  ["RALPH LAUREN", "랄프로렌"],
  ["TOMMY HILFIGER", "타미힐피거"],
  ["LACOSTE", "라코스테"],
  ["BURBERRY", "버버리"],
  ["GUCCI", "구찌"],
  ["PRADA", "프라다"],
  ["CHANEL", "샤넬"],
  ["LOUIS VUITTON", "루이비통"],
  ["DIOR", "디올"],
  ["CELINE", "셀린느"],
  ["MIU MIU", "미우미우"],
  ["STUSSY", "스투시"],
  ["SUPREME", "슈프림"],
  ["ARC'TERYX", "아크테릭스"],
  ["MONTBELL", "몽벨"],
] as const;

export interface ProductSeoInput {
  id: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  canonicalPath: `/${string}`;
  imageUrls: string[];
  price: number;
  availability: "InStock" | "SoldOut";
  saleKind: "auction" | "fixed" | "sold";
  conditionGrade?: string | null;
  sizeLabel?: string | null;
  priceValidUntil?: string | null;
  storeName?: string | null;
}

function searchKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function brandAlias(value: string): readonly [string, string] | null {
  const key = searchKey(value);
  return BRAND_ALIASES.find(([english, korean]) =>
    searchKey(english) === key || searchKey(korean) === key
  ) ?? null;
}

export function buildBrandSearchLabel(value: string): string {
  const brand = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!brand) return "빈티지";
  const alias = brandAlias(brand);
  if (!alias) return brand;
  const [english, korean] = alias;
  return `${korean} ${english}`;
}

export function buildProductSearchName(title: string, brand: string): string {
  const normalizedTitle = title.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const titleKey = searchKey(normalizedTitle);
  const missingBrandTerms = buildBrandSearchLabel(brand)
    .split(/\s+/u)
    .filter((term) => !titleKey.includes(searchKey(term)));
  return [...missingBrandTerms, normalizedTitle].filter(Boolean).join(" ").trim();
}

function priceLabel(kind: ProductSeoInput["saleKind"]): string {
  if (kind === "auction") return "현재 입찰가";
  if (kind === "sold") return "판매 완료가";
  return "판매가";
}

export function buildProductSeoDescription(input: ProductSeoInput): string {
  const details = [
    buildBrandSearchLabel(input.brand),
    input.category,
    input.sizeLabel ? `사이즈 ${input.sizeLabel}` : null,
    input.conditionGrade ? `Grade ${input.conditionGrade}` : null,
    `${priceLabel(input.saleKind)} ${input.price.toLocaleString("ko-KR")}원`,
    input.description,
  ].filter((value): value is string => Boolean(value?.trim()));
  return [...new Set(details)].join(" · ").slice(0, 200);
}

export function buildProductMetadata(input: ProductSeoInput): Metadata {
  const title = `${buildProductSearchName(input.title, input.brand)} | NINETY-NINE VINTAGE`;
  const description = buildProductSeoDescription(input);
  const url = `${PUBLIC_SITE_ORIGIN}${input.canonicalPath}`;
  const images = input.imageUrls.slice(0, 4).map((image) => ({
    url: getCatalogImageUrl(image, 1_200),
    alt: buildProductSearchName(input.title, input.brand),
  }));
  return {
    title,
    description,
    alternates: {
      canonical: input.canonicalPath,
      media: { "only screen and (max-width: 1279px)": `/m${input.canonicalPath}` },
    },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url,
      siteName: "NINETY-NINE VINTAGE",
      type: "website",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: images.map((image) => image.url),
    },
  };
}

function validUntilDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export function buildProductJsonLd(input: ProductSeoInput): Record<string, unknown> {
  const name = buildProductSearchName(input.title, input.brand);
  const url = `${PUBLIC_SITE_ORIGIN}${input.canonicalPath}`;
  const priceValidUntil = validUntilDate(input.priceValidUntil);
  const additionalProperty = [
    input.sizeLabel ? { "@type": "PropertyValue", name: "사이즈", value: input.sizeLabel } : null,
    input.conditionGrade ? { "@type": "PropertyValue", name: "상태 등급", value: input.conditionGrade } : null,
  ].filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    alternateName: [input.title, buildBrandSearchLabel(input.brand)],
    description: buildProductSeoDescription(input),
    sku: input.id,
    category: input.category,
    image: input.imageUrls,
    itemCondition: "https://schema.org/UsedCondition",
    brand: { "@type": "Brand", name: buildBrandSearchLabel(input.brand) },
    ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "KRW",
      price: input.price,
      availability: `https://schema.org/${input.availability}`,
      itemCondition: "https://schema.org/UsedCondition",
      ...(priceValidUntil ? { priceValidUntil } : {}),
      ...(input.storeName
        ? { seller: { "@type": "Organization", name: input.storeName } }
        : {}),
    },
  };
}

export function serializeJsonLd(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}
