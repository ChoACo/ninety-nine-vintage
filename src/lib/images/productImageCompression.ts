const PRODUCT_IMAGE_MAX_WIDTH = 2560;
const PRODUCT_IMAGE_MAX_HEIGHT = 2560;
const PRODUCT_THUMBNAIL_MAX_WIDTH = 640;
const PRODUCT_THUMBNAIL_MAX_HEIGHT = 360;
const PRODUCT_IMAGE_WEBP_QUALITY = 0.9;
const PRODUCT_IMAGE_JPEG_QUALITY = 0.92;
const PRODUCT_THUMBNAIL_WEBP_QUALITY = 0.76;
const PRODUCT_THUMBNAIL_JPEG_QUALITY = 0.8;

/**
 * Product-image compression is an aspirational 100 ms client-side budget, not
 * a guaranteed wall-clock SLA. The measurement returned with every result lets
 * the operator/browser verifier report the actual device-specific duration.
 */
export const PRODUCT_IMAGE_COMPRESSION_TARGET_MS = 100;

export interface ProductImageDimensions {
  width: number;
  height: number;
}

export class ProductImageCompressionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProductImageCompressionError";
  }
}

/**
 * Fit an image inside a 2560px inspection master without cropping or
 * enlarging it. Feed surfaces request a transformed 720/800px rendition while
 * the lightbox receives this higher-resolution storage object directly.
 * Keeping this calculation independent of browser APIs makes the boundary
 * policy easy to verify and reuse.
 */
function getBoundedImageDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): ProductImageDimensions {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new ProductImageCompressionError(
      "사진의 가로·세로 크기를 확인할 수 없어요.",
    );
  }

  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function getCompressedProductImageDimensions(
  sourceWidth: number,
  sourceHeight: number,
): ProductImageDimensions {
  return getBoundedImageDimensions(
    sourceWidth,
    sourceHeight,
    PRODUCT_IMAGE_MAX_WIDTH,
    PRODUCT_IMAGE_MAX_HEIGHT,
  );
}

export function getProductThumbnailDimensions(
  sourceWidth: number,
  sourceHeight: number,
): ProductImageDimensions {
  return getBoundedImageDimensions(
    sourceWidth,
    sourceHeight,
    PRODUCT_THUMBNAIL_MAX_WIDTH,
    PRODUCT_THUMBNAIL_MAX_HEIGHT,
  );
}

interface DecodedProductImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

async function decodeWithImageBitmap(
  file: File,
): Promise<DecodedProductImage | null> {
  if (typeof createImageBitmap !== "function") return null;

  try {
    // Browser decoding applies the source EXIF orientation before dimensions
    // are calculated and pixels are drawn to the normalized upload canvas.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

async function decodeWithHtmlImage(file: File): Promise<DecodedProductImage> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new ProductImageCompressionError(
      "이 브라우저에서는 사진 압축을 실행할 수 없어요.",
    );
  }

  const objectUrl = URL.createObjectURL(file);
  const image = document.createElement("img");
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = objectUrl;
    });

    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw new ProductImageCompressionError(
      `\"${file.name}\" 사진을 읽지 못했어요. JPG, PNG 또는 WebP로 다시 저장해 주세요.`,
      { cause: error },
    );
  }
}

async function decodeProductImage(file: File): Promise<DecodedProductImage> {
  return (await decodeWithImageBitmap(file)) ?? decodeWithHtmlImage(file);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(resolve, mimeType, quality);
    } catch (error) {
      reject(error);
    }
  });
}

function buildCompressedFileName(
  fileName: string,
  extension: string,
  suffix = "",
): string {
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?\"<>|\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 100);
  return `${baseName || "product-image"}${suffix}.${extension}`;
}

interface ProductImageVariantOptions {
  maxWidth: number;
  maxHeight: number;
  webpQuality: number;
  jpegQuality: number;
  fileNameSuffix?: string;
}

async function encodeProductImageVariant(
  decoded: DecodedProductImage,
  file: File,
  options: ProductImageVariantOptions,
): Promise<File> {
  const dimensions = getBoundedImageDimensions(
    decoded.width,
    decoded.height,
    options.maxWidth,
    options.maxHeight,
  );
  if (typeof document === "undefined") {
    throw new ProductImageCompressionError(
      "이 브라우저에서는 사진 압축을 실행할 수 없어요.",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    throw new ProductImageCompressionError(
      "사진 압축 화면을 준비하지 못했어요. 브라우저를 새로고침해 주세요.",
    );
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height);

  const webpBlob = await canvasToBlob(
    canvas,
    "image/webp",
    options.webpQuality,
  ).catch(() => null);
  if (webpBlob?.size && webpBlob.type === "image/webp") {
    return new File(
      [webpBlob],
      buildCompressedFileName(file.name, "webp", options.fileNameSuffix),
      {
        type: "image/webp",
        lastModified: file.lastModified,
      },
    );
  }

  // JPEG has no alpha channel. Paint a white background behind transparent
  // pixels before using it as the compatibility fallback.
  context.save();
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, dimensions.width, dimensions.height);
  context.restore();

  const jpegBlob = await canvasToBlob(
    canvas,
    "image/jpeg",
    options.jpegQuality,
  );
  if (!jpegBlob?.size) {
    throw new ProductImageCompressionError(
      `\"${file.name}\" 사진 압축 결과를 만들지 못했어요.`,
    );
  }

  return new File(
    [jpegBlob],
    buildCompressedFileName(file.name, "jpg", options.fileNameSuffix),
    {
      type: "image/jpeg",
      lastModified: file.lastModified,
    },
  );
}

const PRODUCT_IMAGE_VARIANT_OPTIONS: ProductImageVariantOptions = {
  maxWidth: PRODUCT_IMAGE_MAX_WIDTH,
  maxHeight: PRODUCT_IMAGE_MAX_HEIGHT,
  webpQuality: PRODUCT_IMAGE_WEBP_QUALITY,
  jpegQuality: PRODUCT_IMAGE_JPEG_QUALITY,
};

const PRODUCT_THUMBNAIL_VARIANT_OPTIONS: ProductImageVariantOptions = {
  maxWidth: PRODUCT_THUMBNAIL_MAX_WIDTH,
  maxHeight: PRODUCT_THUMBNAIL_MAX_HEIGHT,
  webpQuality: PRODUCT_THUMBNAIL_WEBP_QUALITY,
  jpegQuality: PRODUCT_THUMBNAIL_JPEG_QUALITY,
  fileNameSuffix: "-thumbnail",
};

export interface CompressedProductImageVariants {
  imageFile: File;
  measurement: ProductImageCompressionMeasurement;
  thumbnailFile: File;
}

export interface ProductImageCompressionMeasurement {
  decodeMs: number;
  encodeMs: number;
  imageBytes: number;
  inputBytes: number;
  targetMet: boolean;
  targetMs: number;
  thumbnailBytes: number;
  totalMs: number;
}

export type ProductImageCompressionReporter = (
  measurement: ProductImageCompressionMeasurement,
  completed: number,
  total: number,
) => void;

function getMonotonicTime(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsedMilliseconds(startedAt: number, finishedAt: number): number {
  return Math.max(0, Number((finishedAt - startedAt).toFixed(2)));
}

/**
 * Build the inspection master and thumbnail variants from a single decoded source. This
 * keeps EXIF orientation identical and avoids decoding large phone photos
 * twice during batch registration.
 */
export async function compressProductImageVariantsForUpload(
  file: File,
): Promise<CompressedProductImageVariants> {
  const startedAt = getMonotonicTime();
  const decoded = await decodeProductImage(file);
  const decodedAt = getMonotonicTime();

  try {
    const [imageFile, thumbnailFile] = await Promise.all([
      encodeProductImageVariant(decoded, file, PRODUCT_IMAGE_VARIANT_OPTIONS),
      encodeProductImageVariant(
        decoded,
        file,
        PRODUCT_THUMBNAIL_VARIANT_OPTIONS,
      ),
    ]);
    const finishedAt = getMonotonicTime();
    const totalMs = elapsedMilliseconds(startedAt, finishedAt);
    return {
      imageFile,
      measurement: {
        decodeMs: elapsedMilliseconds(startedAt, decodedAt),
        encodeMs: elapsedMilliseconds(decodedAt, finishedAt),
        imageBytes: imageFile.size,
        inputBytes: file.size,
        targetMet: totalMs <= PRODUCT_IMAGE_COMPRESSION_TARGET_MS,
        targetMs: PRODUCT_IMAGE_COMPRESSION_TARGET_MS,
        thumbnailBytes: thumbnailFile.size,
        totalMs,
      },
      thumbnailFile,
    };
  } catch (error) {
    if (error instanceof ProductImageCompressionError) throw error;
    throw new ProductImageCompressionError(
      `\"${file.name}\" 사진의 2560px 검수본과 360p 미리보기를 만들지 못했어요. 다른 사진으로 다시 시도해 주세요.`,
      { cause: error },
    );
  } finally {
    decoded.dispose();
  }
}

/**
 * Decode, orient, resize and re-encode a product image before it reaches
 * Supabase Storage. WebP is preferred; JPEG is a safe browser fallback.
 */
export async function compressProductImageForUpload(file: File): Promise<File> {
  const decoded = await decodeProductImage(file);

  try {
    return await encodeProductImageVariant(
      decoded,
      file,
      PRODUCT_IMAGE_VARIANT_OPTIONS,
    );
  } catch (error) {
    if (error instanceof ProductImageCompressionError) throw error;
    throw new ProductImageCompressionError(
      `\"${file.name}\" 사진의 2560px 검수본을 만들지 못했어요. 다른 사진으로 다시 시도해 주세요.`,
      { cause: error },
    );
  } finally {
    decoded.dispose();
  }
}
