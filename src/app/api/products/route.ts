import { fetchPublishedProducts } from "@/services/products";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const limit = Number(searchParams.get("limit") ?? "24");
  const saleType = searchParams.get("saleType") === "fixed" ? "fixed" : "auction";
  const sort = ["latest", "ending", "price_asc", "price_desc"].includes(searchParams.get("sort") ?? "")
    ? (searchParams.get("sort") as "latest" | "ending" | "price_asc" | "price_desc")
    : "latest";
  try {
    return Response.json({
      products: await fetchPublishedProducts({ limit, saleType, sort, search: searchParams.get("q") ?? "" }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "products_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
