/* eslint-disable @next/next/no-img-element */

import type { ImgHTMLAttributes } from "react";
import { getCatalogImageSrcSet, getCatalogImageUrl } from "@/lib/images";

interface CatalogImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  maxDimension?: number;
}

/**
 * Catalog images are already resized by Supabase Image Transformations.
 * Keep the native element so the transformed WebP URL is requested directly
 * without a second server-side image proxy.
 */
export function CatalogImage({ loading = "lazy", maxDimension = 800, sizes = "(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 20vw", src = "", srcSet, ...props }: CatalogImageProps) {
  const source = typeof src === "string" ? src : "";
  if (!source) {
    return <span aria-hidden={props.alt ? undefined : true} aria-label={props.alt || undefined} className={`block bg-surface ${props.className ?? ""}`} data-missing-image="true" role={props.alt ? "img" : undefined} style={props.style} />;
  }
  return <img {...props} alt={props.alt ?? ""} loading={loading} sizes={sizes} src={getCatalogImageUrl(source, maxDimension)} srcSet={srcSet ?? getCatalogImageSrcSet(source, maxDimension)} />;
}
