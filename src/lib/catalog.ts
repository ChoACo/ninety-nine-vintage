import type { ProductSaleType } from "@/types/auction";

export interface StoreSummary {
  id: string;
  slug: string;
  name: string;
  operator: string;
  description: string;
  accent: string;
}

export interface CatalogProduct {
  id: string;
  title: string;
  description: string;
  category: string;
  size: string;
  condition: "NEW" | "EXCELLENT" | "GOOD" | "FAIR";
  conditionGrade: "S" | "A+" | "A" | "B";
  saleType: ProductSaleType;
  price: number;
  startingPrice: number;
  bidCount: number;
  closesAt: string;
  store: StoreSummary;
  imageUrls: string[];
  storageClass: "small" | "large";
  measurements: { shoulder: number; chest: number; sleeve: number; length: number };
  inspectionNotes: string[];
}

const images = {
  leather: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=1200&q=90",
  denim: "https://images.unsplash.com/photo-1542272604-787c3835535d?w=1200&q=90",
  knit: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=1200&q=90",
  work: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=1200&q=90",
  shirt: "https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?w=1200&q=90",
  coat: "https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=1200&q=90",
};

export const DEMO_STORES: StoreSummary[] = [
  { id: "store-archive", slug: "archive-01", name: "ARCHIVE 01", operator: "JUN", description: "가죽과 밀리터리, 오래 입을수록 좋아지는 것들.", accent: "#c7b9a5" },
  { id: "store-north", slug: "north-side", name: "NORTH SIDE", operator: "MIA", description: "90년대의 데일리 웨어를 지금의 비율로.", accent: "#9fa9a2" },
  { id: "store-form", slug: "form-object", name: "FORM / OBJECT", operator: "LEO", description: "실루엣과 소재의 균형을 수집합니다.", accent: "#b8a7a1" },
];

const closesSoon = new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString();
const tomorrow = new Date(Date.now() + 1000 * 60 * 60 * 20).toISOString();

export const DEMO_PRODUCTS: CatalogProduct[] = [
  { id: "demo-leather-099", title: "90s Varsity Leather Jacket", description: "에이징이 아름다운 90s 레더 바시티 재킷", category: "OUTER", size: "L", condition: "EXCELLENT", conditionGrade: "A+", saleType: "auction", price: 125000, startingPrice: 80000, bidCount: 14, closesAt: closesSoon, store: DEMO_STORES[0], imageUrls: [images.leather, images.coat, images.shirt], storageClass: "large", measurements: { shoulder: 52, chest: 60, sleeve: 64, length: 74 }, inspectionNotes: ["가죽 표면에 자연스러운 에이징과 미세한 주름이 있습니다.", "왼쪽 소매 끝에 작은 생활 오염이 있습니다.", "안감과 지퍼는 원형 그대로입니다."] },
  { id: "demo-denim-014", title: "Made in USA Denim 501", description: "워시와 페이딩이 선명한 빈티지 데님", category: "BOTTOM", size: "32", condition: "GOOD", conditionGrade: "A", saleType: "auction", price: 69000, startingPrice: 45000, bidCount: 8, closesAt: closesSoon, store: DEMO_STORES[1], imageUrls: [images.denim, images.work], storageClass: "small", measurements: { shoulder: 0, chest: 0, sleeve: 0, length: 104 }, inspectionNotes: ["자연스러운 데님 페이딩과 수선 흔적이 있습니다.", "지퍼와 버튼은 정상 작동합니다."] },
  { id: "demo-work-023", title: "French Work Chore Coat", description: "가벼운 워크웨어 레이어로 좋은 프렌치 코트", category: "OUTER", size: "M", condition: "EXCELLENT", conditionGrade: "A", saleType: "auction", price: 98000, startingPrice: 70000, bidCount: 5, closesAt: tomorrow, store: DEMO_STORES[2], imageUrls: [images.work, images.coat], storageClass: "large", measurements: { shoulder: 48, chest: 57, sleeve: 61, length: 71 }, inspectionNotes: ["왼쪽 포켓 안쪽에 작은 사용감이 있습니다.", "원단의 힘이 잘 남아 있습니다."] },
  { id: "demo-knit-007", title: "Alpaca Blend Textured Knit", description: "부드러운 알파카 혼방 텍스처 니트", category: "TOP", size: "FREE", condition: "EXCELLENT", conditionGrade: "A+", saleType: "fixed", price: 89000, startingPrice: 89000, bidCount: 0, closesAt: "9999-12-31T23:59:59.000Z", store: DEMO_STORES[1], imageUrls: [images.knit, images.shirt], storageClass: "small", measurements: { shoulder: 55, chest: 60, sleeve: 58, length: 67 }, inspectionNotes: ["보풀과 늘어짐이 거의 없는 좋은 상태입니다."] },
  { id: "demo-shirt-031", title: "Linen Grandad Shirt", description: "여름부터 간절기까지 좋은 린넨 셔츠", category: "TOP", size: "L", condition: "GOOD", conditionGrade: "A", saleType: "fixed", price: 52000, startingPrice: 52000, bidCount: 0, closesAt: "9999-12-31T23:59:59.000Z", store: DEMO_STORES[2], imageUrls: [images.shirt, images.work], storageClass: "small", measurements: { shoulder: 50, chest: 58, sleeve: 61, length: 74 }, inspectionNotes: ["린넨 특유의 자연스러운 구김이 있습니다."] },
  { id: "demo-coat-041", title: "Wool Balmacaan Coat", description: "절제된 실루엣의 울 발마칸 코트", category: "OUTER", size: "M", condition: "EXCELLENT", conditionGrade: "A", saleType: "fixed", price: 168000, startingPrice: 168000, bidCount: 0, closesAt: "9999-12-31T23:59:59.000Z", store: DEMO_STORES[0], imageUrls: [images.coat, images.leather], storageClass: "large", measurements: { shoulder: 49, chest: 59, sleeve: 62, length: 108 }, inspectionNotes: ["드라이클리닝 완료. 안감과 단추 상태가 좋습니다."] },
];

export function getDemoProduct(id: string) { return DEMO_PRODUCTS.find((product) => product.id === id) ?? null; }
export function getDemoStore(slug: string) { return DEMO_STORES.find((store) => store.slug === slug) ?? null; }

