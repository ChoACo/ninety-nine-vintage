/* eslint-disable @next/next/no-img-element */

import type { ImgHTMLAttributes } from "react";
import { getCatalogImageUrl } from "@/lib/images";

interface CatalogImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  maxDimension?: number;
}

/**
 * Catalog images are already resized by Supabase Image Transformations.
 * Keep the native element so the transformed WebP URL is requested directly
 * without a second server-side image proxy.
 */
export function CatalogImage({ maxDimension = 800, src = "", ...props }: CatalogImageProps) {
  const source = typeof src === "string" ? src : "";
  return <img {...props} alt={props.alt ?? ""} src={getCatalogImageUrl(source, maxDimension)} />;
}
