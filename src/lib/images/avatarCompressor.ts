export const AVATAR_MAX_DIMENSION = 256;
export const AVATAR_MAX_BYTES = 100 * 1024;

type DecodedImage = CanvasImageSource & {
  height: number;
  width: number;
  close?: () => void;
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decodeWithImageElement(file: File): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("avatar_decode_failed"));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeAvatar(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  return decodeWithImageElement(file);
}

function drawResized(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  source: DecodedImage,
  width: number,
  height: number,
) {
  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
}

async function encodeWithinLimit(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  source: DecodedImage,
  initialWidth: number,
  initialHeight: number,
): Promise<Blob> {
  let width = initialWidth;
  let height = initialHeight;
  const formats = ["image/webp", "image/jpeg"] as const;
  for (const type of formats) {
    width = initialWidth;
    height = initialHeight;
    while (width >= 1 && height >= 1) {
      drawResized(canvas, context, source, width, height);
      for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
        const blob = await canvasToBlob(canvas, type, quality);
        if (!blob || blob.type !== type) break;
        if (blob.size <= AVATAR_MAX_BYTES) return blob;
      }
      const nextWidth = Math.max(1, Math.floor(width * 0.85));
      const nextHeight = Math.max(1, Math.floor(height * 0.85));
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth;
      height = nextHeight;
    }
  }
  throw new Error("avatar_compression_limit_exceeded");
}

export async function compressAvatarImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= 0) {
    throw new Error("avatar_file_invalid");
  }
  const source = await decodeAvatar(file);
  try {
    const scale = Math.min(
      1,
      AVATAR_MAX_DIMENSION / Math.max(source.width, source.height),
    );
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("avatar_canvas_unavailable");
    const blob = await encodeWithinLimit(
      canvas,
      context,
      source,
      width,
      height,
    );
    const extension = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `avatar.${extension}`, {
      lastModified: Date.now(),
      type: blob.type,
    });
  } finally {
    source.close?.();
  }
}
