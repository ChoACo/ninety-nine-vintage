const SUPABASE_PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const SUPABASE_PUBLIC_RENDER_PATH = "/storage/v1/render/image/public/";

const CATALOG_IMAGE_MAX_EDGE = 800;
const CATALOG_IMAGE_QUALITY = 72;

function normalizedUrl(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Feed cards must never fall back to a large product image. New products use
 * the dedicated 640x360 Storage derivative. Legacy rows whose thumbnail URL
 * still points at the product image use Supabase's bounded render endpoint.
 * Unsupported external legacy URLs intentionally return an empty string so a
 * lightweight placeholder is shown until the user opens the lightbox.
 */
export function getCatalogThumbnailUrl(
  thumbnailUrl: string | null | undefined,
  productImageUrl: string | null | undefined,
): string {
  const thumbnail = normalizedUrl(thumbnailUrl);
  const productImage = normalizedUrl(productImageUrl);
  const candidate = thumbnail || productImage;

  if (thumbnail.includes("/thumbnails/")) return thumbnail;
  if (!candidate) return "";

  try {
    const rendered = new URL(candidate);
    if (rendered.pathname.includes(SUPABASE_PUBLIC_OBJECT_PATH)) {
      rendered.pathname = rendered.pathname.replace(
        SUPABASE_PUBLIC_OBJECT_PATH,
        SUPABASE_PUBLIC_RENDER_PATH,
      );
    } else if (!rendered.pathname.includes(SUPABASE_PUBLIC_RENDER_PATH)) {
      return "";
    }
    rendered.searchParams.set("width", String(CATALOG_IMAGE_MAX_EDGE));
    rendered.searchParams.set("height", String(CATALOG_IMAGE_MAX_EDGE));
    rendered.searchParams.set("resize", "contain");
    rendered.searchParams.set("quality", String(CATALOG_IMAGE_QUALITY));
    return rendered.toString();
  } catch {
    return "";
  }
}

export const CATALOG_IMAGE_POLICY = Object.freeze({
  maxEdge: CATALOG_IMAGE_MAX_EDGE,
  quality: CATALOG_IMAGE_QUALITY,
});
