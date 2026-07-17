export const PRODUCT_IMAGE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

const PRODUCT_IMAGE_MIME_TYPE_SET = new Set(PRODUCT_IMAGE_MIME_TYPES);

export const PRODUCT_IMAGE_FORMAT_LABEL =
  "JPG, PNG, WebP, GIF, AVIF, HEIC 또는 HEIF";

export function isSupportedProductImageMimeType(mimeType: string): boolean {
  return PRODUCT_IMAGE_MIME_TYPE_SET.has(mimeType.trim().toLowerCase());
}
