const MAX_CATALOG_IMAGE_DIMENSION = 800;

/**
 * Catalog surfaces never need the original upload. Supabase Image
 * Transformations keep listing, feed, archive and admin thumbnails below 1MP.
 * Detail galleries intentionally continue to use the original URLs.
 */
export function getCatalogImageUrl(source: string | null | undefined, maxDimension = MAX_CATALOG_IMAGE_DIMENSION): string {
  if (!source) return "";
  try {
    const url = new URL(source);
    const objectPrefix = "/storage/v1/object/public/";
    const renderPrefix = "/storage/v1/render/image/public/";
    if (!url.pathname.includes(objectPrefix) && !url.pathname.includes(renderPrefix)) return source;
    url.pathname = url.pathname.replace(objectPrefix, renderPrefix);
    const dimension = Math.min(Math.max(Math.floor(maxDimension), 240), MAX_CATALOG_IMAGE_DIMENSION);
    url.searchParams.set("width", String(dimension));
    url.searchParams.set("height", String(dimension));
    url.searchParams.set("resize", "contain");
    url.searchParams.set("quality", "72");
    url.searchParams.set("format", "webp");
    return url.toString();
  } catch {
    return source;
  }
}

export function getCatalogImageSrcSet(source: string | null | undefined, maxDimension = MAX_CATALOG_IMAGE_DIMENSION): string | undefined {
  if (!source) return undefined;
  const dimensions = [320, 480, MAX_CATALOG_IMAGE_DIMENSION].filter((dimension, index, values) => dimension <= maxDimension && values.indexOf(dimension) === index);
  if (dimensions.length < 2) return undefined;
  try {
    const url = new URL(source);
    if (!url.pathname.includes("/storage/v1/object/public/") && !url.pathname.includes("/storage/v1/render/image/public/")) return undefined;
  } catch {
    return undefined;
  }
  return dimensions.map((dimension) => `${getCatalogImageUrl(source, dimension)} ${dimension}w`).join(", ");
}
