"use client";

/* eslint-disable @next/next/no-img-element -- Unknown external hosts must bypass Next's server-side optimizer allow-list. */
import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { getCatalogImageSrcSet, getCatalogImageUrl } from "@/lib/images";

const CATALOG_BLUR_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI1MCI+PGZpbHRlciBpZD0iYiI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMTIiLz48L2ZpbHRlcj48cmVjdIHdpZHRoPSI0MCIgaGVpZ2h0PSI1MCIgZmlsbD0iI2U3ZTNkYiIvPjxyZWN0IHdpZHRoPSI0MCIgaGVpZ2h0PSI1MCIgZmlsbD0iI2ZiZmFmNyIgZmlsdGVyPSJ1cmwoI2IpIiBvcGFjaXR5PSIuNzUiLz48L3N2Zz4=";
const CATALOG_TRANSFORM_MAX_DIMENSION = 800;
const SUPABASE_OBJECT_PREFIX = "/storage/v1/object/public/";
const SUPABASE_RENDER_PREFIX = "/storage/v1/render/image/public/";

const configuredSupabaseHostname = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();

function canUseNextImage(source: string): boolean {
  if (source.startsWith("/") && !source.startsWith("//")) return true;

  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || !url.pathname.startsWith("/storage/v1/")) {
      return false;
    }
    return (
      url.hostname.endsWith(".supabase.co") ||
      (!!configuredSupabaseHostname &&
        url.hostname === configuredSupabaseHostname)
    );
  } catch {
    return false;
  }
}

function isSafeNativeImageSource(source: string): boolean {
  try {
    const url = new URL(source, "https://catalog.invalid");
    return (
      url.protocol === "https:" ||
      url.protocol === "http:" ||
      url.protocol === "blob:" ||
      (url.protocol === "data:" && source.startsWith("data:image/"))
    );
  } catch {
    return false;
  }
}

function getNativeImageSrcSet(
  source: string,
  maxDimension: number,
  providedSrcSet: string | undefined,
): string | undefined {
  const provided = providedSrcSet?.trim();
  if (provided) return provided;

  // Supabase render URLs have real width variants and are safe to request
  // directly from the browser even when an http/custom-domain URL cannot use
  // Next's server optimizer. Other external origins keep one honest candidate
  // instead of pretending that the same full-size file has multiple widths.
  const catalogSrcSet = getCatalogImageSrcSet(source, maxDimension);
  if (catalogSrcSet) return catalogSrcSet;

  try {
    const url = new URL(source);
    return url.protocol === "https:" || url.protocol === "http:"
      ? source
      : undefined;
  } catch {
    return undefined;
  }
}

/** Restore the uploaded 720p asset for the zoom gallery instead of chaining
 * a previously generated 800px Supabase render through Next Image. */
function getRequestedImageSource(source: string, maxDimension: number): string {
  if (maxDimension <= CATALOG_TRANSFORM_MAX_DIMENSION) {
    return getCatalogImageUrl(source, maxDimension);
  }

  try {
    const url = new URL(source);
    if (!url.pathname.includes(SUPABASE_RENDER_PREFIX)) return source;
    url.pathname = url.pathname.replace(
      SUPABASE_RENDER_PREFIX,
      SUPABASE_OBJECT_PREFIX,
    );
    for (const parameter of [
      "width",
      "height",
      "resize",
      "quality",
      "format",
    ]) {
      url.searchParams.delete(parameter);
    }
    return url.toString();
  } catch {
    return source;
  }
}

interface CatalogImageProps
  extends Omit<ImageProps, "alt" | "height" | "src" | "width"> {
  alt?: string;
  height?: number;
  maxDimension?: number;
  src?: string | null;
  /** Native fallback candidates are fetched by the browser, never Next's proxy. */
  srcSet?: string;
  width?: number;
}

/**
 * Product imagery is capped by Supabase Image Transformations, then served
 * through Next Image so Cloudflare can negotiate AVIF/WebP and responsive
 * widths. Every catalog surface receives the same lightweight blur placeholder.
 */
export function CatalogImage({
  alt = "",
  blurDataURL = CATALOG_BLUR_DATA_URL,
  height,
  loading = "lazy",
  maxDimension = 800,
  placeholder = "blur",
  sizes = "(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 20vw",
  src = "",
  srcSet,
  width,
  ...props
}: CatalogImageProps) {
  const source = typeof src === "string" ? src : "";
  const requestedSource = getRequestedImageSource(source, maxDimension);
  const [loadedNativeSource, setLoadedNativeSource] = useState("");
  if (!requestedSource || !isSafeNativeImageSource(requestedSource)) {
    return (
      <span
        aria-hidden={alt ? undefined : true}
        aria-label={alt || undefined}
        className={`block bg-surface ${props.className ?? ""}`}
        data-missing-image="true"
        role={alt ? "img" : undefined}
        style={props.style}
      />
    );
  }

  if (!canUseNextImage(requestedSource)) {
    // The Next optimizer rejects unconfigured hosts at render time. A native
    // fallback keeps legacy/external catalog URLs usable without allowing the
    // server-side image proxy to fetch arbitrary origins. The low-resolution
    // background and filtered first frame make its blur-to-sharp transition
    // equivalent to the trusted next/image path.
    const nativeLoaded = loadedNativeSource === requestedSource;
    const useBlur = placeholder === "blur" && Boolean(blurDataURL);
    const nativeSrcSet = getNativeImageSrcSet(
      source,
      maxDimension,
      srcSet,
    );
    const transition = [
      props.style?.transition,
      "filter 240ms ease, opacity 240ms ease, transform 240ms ease",
    ]
      .filter(Boolean)
      .join(", ");

    return (
      <img
        alt={alt}
        className={props.className}
        crossOrigin={props.crossOrigin}
        data-external-catalog-image="true"
        decoding={props.decoding}
        fetchPriority={props.fetchPriority}
        height={height ?? maxDimension}
        loading={loading}
        onError={props.onError}
        onLoad={(event) => {
          setLoadedNativeSource(requestedSource);
          props.onLoad?.(event);
        }}
        referrerPolicy={props.referrerPolicy ?? "no-referrer"}
        sizes={sizes}
        src={requestedSource}
        srcSet={nativeSrcSet}
        style={{
          ...props.style,
          backgroundImage:
            useBlur && !nativeLoaded
              ? `url("${blurDataURL}")`
              : props.style?.backgroundImage,
          backgroundPosition: props.style?.backgroundPosition ?? "center",
          backgroundRepeat: props.style?.backgroundRepeat ?? "no-repeat",
          backgroundSize: props.style?.backgroundSize ?? "cover",
          filter:
            useBlur && !nativeLoaded ? "blur(12px)" : props.style?.filter,
          opacity:
            useBlur && !nativeLoaded ? 0.72 : props.style?.opacity,
          transform:
            useBlur && !nativeLoaded ? "scale(1.03)" : props.style?.transform,
          transition,
        }}
        width={width ?? maxDimension}
      />
    );
  }

  return (
    <Image
      {...props}
      alt={alt}
      blurDataURL={blurDataURL}
      height={height ?? maxDimension}
      loading={loading}
      placeholder={placeholder}
      sizes={sizes}
      src={requestedSource}
      width={width ?? maxDimension}
    />
  );
}
