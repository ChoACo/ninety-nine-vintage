import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compressProductImageVariantsForUpload,
  getCompressedProductImageDimensions,
  getProductThumbnailDimensions,
  PRODUCT_IMAGE_COMPRESSION_TARGET_MS,
} from "../../src/lib/images/productImageCompression.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("product uploads produce bounded 720p and 360p variants", () => {
  assert.deepEqual(getCompressedProductImageDimensions(4_000, 3_000), {
    width: 960,
    height: 720,
  });
  assert.deepEqual(getProductThumbnailDimensions(4_000, 3_000), {
    width: 480,
    height: 360,
  });
  assert.deepEqual(getCompressedProductImageDimensions(600, 400), {
    width: 600,
    height: 400,
  });
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
        { width: 960, height: 720 },
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

test("uploads overlap both variants and report honest device timings to the operator", async () => {
  const [products, operatorConsole, uploadModal] = await Promise.all([
    source("src/lib/supabase/products.ts"),
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorXlsxImportModal.tsx"),
  ]);

  assert.match(
    products,
    /paths\.push\(imagePath, thumbnailPath\);[\s\S]*?Promise\.all\(\[/,
  );
  assert.match(products, /\.upload\(imagePath, imageFile,/);
  assert.match(products, /\.upload\(thumbnailPath, thumbnailFile,/);
  assert.match(products, /compressionMeasurements/);
  assert.match(products, /onCompressionMeasured\?\.\(/);
  assert.match(operatorConsole, /onCompressionMeasured\(/);
  assert.match(operatorConsole, /completedImages \+ compressedForProduct/);
  assert.match(uploadModal, /measurement\.targetMet/);
  assert.match(uploadModal, /measurement\.totalMs/);
  assert.match(uploadModal, /100ms 목표 달성/);
  assert.match(uploadModal, /100ms 목표 초과/);
  assert.match(uploadModal, /느린 기기에서 초과해도 업로드는 계속됩니다/);
  assert.doesNotMatch(uploadModal, /disabled=\{[^}]*targetMet/);
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
  assert.match(itemGallery, /45rem/);
  assert.match(itemGallery, /maxDimension=\{1280\} sizes=\{imageSizes\}/);
  assert.match(itemGallery, /maxDimension=\{480\} sizes=\{thumbnailSizes\}/);
  assert.doesNotMatch(itemGallery, /sizes="58vw"/);
});
