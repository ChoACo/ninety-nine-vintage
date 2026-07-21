import { getCatalogImageUrl } from "@/lib/images";
import { fetchPublishedProduct } from "@/services/products";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return Response.json({ error: "invalid_product_id" }, { status: 400 });
  }
  try {
    const product = await fetchPublishedProduct(id);
    if (!product) {
      return Response.json({ error: "product_not_found" }, { status: 404 });
    }
    return Response.json({
      product: {
        ...product,
        imageUrls: product.imageUrls.map((image) => getCatalogImageUrl(image)),
        thumbnailUrls: product.thumbnailUrls.map((image) => getCatalogImageUrl(image, 320)),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "product_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
