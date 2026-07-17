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

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

/** 파일 선택창의 MIME 문자열과 실제 파일 시그니처가 일치하는지 확인합니다. */
export async function hasSupportedProductImageSignature(
  file: File,
): Promise<boolean> {
  const mimeType = file.type.trim().toLowerCase();
  if (!isSupportedProductImageMimeType(mimeType) || file.size < 3) return false;

  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      )
    );
  }
  if (mimeType === "image/gif") {
    const signature = ascii(bytes, 0, 6);
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  }

  if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return false;
  const brands = new Set<string>();
  for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
    brands.add(ascii(bytes, offset, 4));
  }
  const expectedBrands: Record<string, readonly string[]> = {
    "image/avif": ["avif", "avis"],
    "image/heic": ["heic", "heix", "hevc", "hevx", "heis", "hevm", "mif1", "msf1"],
    "image/heif": ["heic", "heix", "hevc", "hevx", "heis", "hevm", "mif1", "msf1"],
  };
  return (expectedBrands[mimeType] ?? []).some((brand) => brands.has(brand));
}
