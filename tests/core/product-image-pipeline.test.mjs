import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compressProductImageVariantsForUpload,
  getCompressedProductImageDimensions,
  getProductThumbnailDimensions,
  PRODUCT_IMAGE_COMPRESSION_TARGET_MS,
} from "../../src/lib/images/productImageCompression.ts";
import {
  isSupportedProductImageMimeType,
  PRODUCT_IMAGE_FORMAT_LABEL,
  PRODUCT_IMAGE_HEIC_CONVERSION_NOTE,
  PRODUCT_IMAGE_INPUT_ACCEPT,
} from "../../src/lib/supabase/productImagePolicy.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("product uploads preserve a 2560px high-resolution source and a 360p thumbnail", () => {
  assert.deepEqual(getCompressedProductImageDimensions(4_000, 3_000), {
    width: 2560,
    height: 1920,
  });
  assert.deepEqual(getProductThumbnailDimensions(4_000, 3_000), {
    width: 480,
    height: 360,
  });
  assert.deepEqual(getCompressedProductImageDimensions(600, 400), {
    width: 600,
    height: 400,
  });
  assert.deepEqual(getCompressedProductImageDimensions(3_000, 4_000), {
    width: 1920,
    height: 2560,
  });
});

test("browser upload copy does not promise HEIC decoding without a bundled decoder", () => {
  assert.equal(isSupportedProductImageMimeType("image/heic"), false);
  assert.equal(isSupportedProductImageMimeType("image/heif"), false);
  assert.equal(PRODUCT_IMAGE_INPUT_ACCEPT.includes("image/heic"), false);
  assert.doesNotMatch(PRODUCT_IMAGE_FORMAT_LABEL, /HEIC|HEIF/);
  assert.match(PRODUCT_IMAGE_HEIC_CONVERSION_NOTE, /JPG로 변환/);
});

test("variant encoding runs concurrently and records the 100 ms budget without assuming it passes", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const canvases = [];
  let activeEncodes = 0;
  let maxConcurrentEncodes = 0;
  let bitmapClosed = false;

  globalThis.createImageBitmap = async () => ({
    close() {
      bitmapClosed = true;
    },
    height: 3_000,
    width: 4_000,
  });
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      const canvas = {
        height: 0,
        width: 0,
        getContext() {
          return {
            drawImage() {},
            fillRect() {},
            fillStyle: "",
            globalCompositeOperation: "source-over",
            imageSmoothingEnabled: false,
            imageSmoothingQuality: "low",
            restore() {},
            save() {},
          };
        },
        toBlob(callback, mimeType) {
          activeEncodes += 1;
          maxConcurrentEncodes = Math.max(maxConcurrentEncodes, activeEncodes);
          setTimeout(() => {
            activeEncodes -= 1;
            callback(new Blob([new Uint8Array(32)], { type: mimeType }));
          }, 5);
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };

  try {
    const file = new File([new Uint8Array(256)], "coat.jpg", {
      lastModified: 1,
      type: "image/jpeg",
    });
    const result = await compressProductImageVariantsForUpload(file);

    assert.equal(maxConcurrentEncodes, 2);
    assert.equal(bitmapClosed, true);
    assert.deepEqual(
      canvases.map(({ width, height }) => ({ width, height })),
      [
        { width: 2560, height: 1920 },
        { width: 480, height: 360 },
      ],
    );
    assert.equal(result.measurement.inputBytes, file.size);
    assert.equal(result.measurement.imageBytes, result.imageFile.size);
    assert.equal(result.measurement.thumbnailBytes, result.thumbnailFile.size);
    assert.equal(
      result.measurement.targetMs,
      PRODUCT_IMAGE_COMPRESSION_TARGET_MS,
    );
    assert.equal(
      result.measurement.targetMet,
      result.measurement.totalMs <= PRODUCT_IMAGE_COMPRESSION_TARGET_MS,
    );
    for (const duration of [
      result.measurement.decodeMs,
      result.measurement.encodeMs,
      result.measurement.totalMs,
    ]) {
      assert.equal(Number.isFinite(duration), true);
      assert.ok(duration >= 0);
    }
  } finally {
    if (originalCreateImageBitmap === undefined) {
      delete globalThis.createImageBitmap;
    } else {
      globalThis.createImageBitmap = originalCreateImageBitmap;
    }
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
});

test("uploads overlap both variants without adding device measurements to product registration", async () => {
  const [products, operatorConsole, uploadModal, singleRoute, bulkRoute] = await Promise.all([
    source("src/lib/supabase/products.ts"),
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorXlsxImportModal.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/app/api/admin/operator/products/bulk/route.ts"),
  ]);

  assert.match(
    products,
    /paths\.push\(imagePath, thumbnailPath\);[\s\S]*?Promise\.all\(\[/,
  );
  assert.match(products, /\.upload\(imagePath, imageFile,/);
  assert.match(products, /\.upload\(thumbnailPath, thumbnailFile,/);
  assert.match(products, /compressionMeasurements/);
  assert.match(products, /onCompressionMeasured\?\.\(/);
  assert.doesNotMatch(operatorConsole, /onCompressionMeasured|compressedForProduct|기기 실측/);
  assert.doesNotMatch(uploadModal, /measurement\.targetMet|measurement\.totalMs|100ms 목표|기기 실측/);
  assert.equal((uploadModal.match(/accept=\{PRODUCT_IMAGE_INPUT_ACCEPT\}/g) ?? []).length, 2);
  assert.match(uploadModal, /PRODUCT_IMAGE_HEIC_CONVERSION_NOTE/);
  assert.match(operatorConsole, /URL 등록은 원격 파일을 그대로 연결/);
  assert.match(operatorConsole, /2560px 고해상도 원본과 360p 미리보기/);
  assert.doesNotMatch(operatorConsole, /일괄 등록 CSV|CSV 일괄 등록 실행/);
  for (const route of [singleRoute, bulkRoute]) {
    assert.match(route, /body\??\.thumbnailUrls === undefined\s*\? imageUrls\s*:\s*images\(body\.?thumbnailUrls\)/);
    assert.match(route, /thumbnailUrls\.length !== imageUrls\.length/);
    assert.match(route, /thumbnail_urls: thumbnailUrls/);
  }
});

test("zoom and fallback images keep responsive sizing, blur, and the proxy boundary", async () => {
  const [catalogImage, detailView, itemGallery] = await Promise.all([
    source("src/components/ui/CatalogImage.tsx"),
    source("src/components/features/auction/detail/AuctionDetailView.tsx"),
    source("src/components/features/auction/detail/ItemGallery.tsx"),
  ]);

  assert.match(catalogImage, /maxDimension <= CATALOG_TRANSFORM_MAX_DIMENSION/);
  assert.match(
    catalogImage,
    /SUPABASE_RENDER_PREFIX,[\s\S]*?SUPABASE_OBJECT_PREFIX/,
  );
  assert.match(catalogImage, /data-external-catalog-image="true"/);
  assert.match(
    catalogImage,
    /referrerPolicy=\{props\.referrerPolicy \?\? "no-referrer"\}/,
  );
  assert.match(catalogImage, /url\.hostname\.endsWith\("\.supabase\.co"\)/);
  assert.match(catalogImage, /srcSet=\{nativeSrcSet\}/);
  assert.match(catalogImage, /loadedNativeSource === requestedSource/);
  assert.match(catalogImage, /filter:[\s\S]*?"blur\(12px\)"/);
  assert.match(catalogImage, /getCatalogImageSrcSet\(source, maxDimension\)/);

  assert.match(detailView, /<ItemGallery compact=\{compact\} item=\{item\} \/>/);
  assert.match(itemGallery, /const FULL_PAGE_IMAGE_SIZES/);
  assert.match(itemGallery, /const COMPACT_IMAGE_SIZES/);
  assert.match(itemGallery, /\(max-width: 767px\) calc\(100vw - 2rem\)/);
  assert.match(itemGallery, /56\.5rem/);
  assert.match(itemGallery, /44rem/);
  assert.match(itemGallery, /maxDimension=\{1280\} sizes=\{imageSizes\}/);
  assert.match(itemGallery, /maxDimension=\{480\} sizes=\{thumbnailSizes\}/);
  assert.doesNotMatch(itemGallery, /sizes="58vw"/);
});
