import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compressProductImageForUpload,
  compressProductImageVariantsForUpload,
  getCompressedProductImageDimensions,
  getProductThumbnailDimensions,
  ProductImageCompressionError,
} from "../src/lib/images/productImageCompression.ts";

const rootUrl = new URL("../", import.meta.url);

test("fits product images inside 1280x720 without cropping or enlargement", () => {
  assert.deepEqual(getCompressedProductImageDimensions(1920, 1080), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(getCompressedProductImageDimensions(4032, 3024), {
    width: 960,
    height: 720,
  });
  assert.deepEqual(getCompressedProductImageDimensions(3024, 4032), {
    width: 540,
    height: 720,
  });
  assert.deepEqual(getCompressedProductImageDimensions(640, 480), {
    width: 640,
    height: 480,
  });
});

test("fits preview thumbnails inside 640x360 without cropping or enlargement", () => {
  assert.deepEqual(getProductThumbnailDimensions(1920, 1080), {
    width: 640,
    height: 360,
  });
  assert.deepEqual(getProductThumbnailDimensions(4032, 3024), {
    width: 480,
    height: 360,
  });
  assert.deepEqual(getProductThumbnailDimensions(3024, 4032), {
    width: 270,
    height: 360,
  });
  assert.deepEqual(getProductThumbnailDimensions(320, 240), {
    width: 320,
    height: 240,
  });
});

test("rejects invalid image dimensions with a user-safe error", () => {
  assert.throws(
    () => getCompressedProductImageDimensions(0, 720),
    ProductImageCompressionError,
  );
  assert.throws(
    () => getCompressedProductImageDimensions(Number.NaN, 720),
    ProductImageCompressionError,
  );
});

test("fails safely when browser image decoding APIs are unavailable", async () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", {
    type: "image/jpeg",
  });

  await assert.rejects(
    compressProductImageForUpload(file),
    (error) =>
      error instanceof ProductImageCompressionError &&
      /브라우저에서는 사진 압축/.test(error.message),
  );
});

test("uses oriented browser decoding and emits a bounded WebP file", async () => {
  const previousBitmap = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  let bitmapOptions;
  let bitmapClosed = false;
  let drawArguments;
  const fakeContext = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage(...arguments_) {
      drawArguments = arguments_;
    },
    save() {},
    restore() {},
    fillRect() {},
    globalCompositeOperation: "source-over",
    fillStyle: "#000000",
  };
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => fakeContext,
    toBlob: (callback, mimeType, quality) => {
      assert.equal(mimeType, "image/webp");
      assert.equal(quality, 0.82);
      callback(new Blob([new Uint8Array([1, 2, 3])], { type: mimeType }));
    },
  };
  const fakeBitmap = {
    width: 4032,
    height: 3024,
    close: () => {
      bitmapClosed = true;
    },
  };

  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async (_file, options) => {
      bitmapOptions = options;
      return fakeBitmap;
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (elementName) => {
        assert.equal(elementName, "canvas");
        return fakeCanvas;
      },
    },
  });

  try {
    const sourceFile = new File([new Uint8Array([1])], "listing photo.png", {
      type: "image/png",
      lastModified: 1234,
    });
    const compressed = await compressProductImageForUpload(sourceFile);

    assert.deepEqual(bitmapOptions, { imageOrientation: "from-image" });
    assert.equal(fakeCanvas.width, 960);
    assert.equal(fakeCanvas.height, 720);
    assert.deepEqual(drawArguments?.slice(1), [0, 0, 960, 720]);
    assert.equal(fakeContext.imageSmoothingEnabled, true);
    assert.equal(fakeContext.imageSmoothingQuality, "high");
    assert.equal(compressed.name, "listing photo.webp");
    assert.equal(compressed.type, "image/webp");
    assert.equal(compressed.lastModified, 1234);
    assert.equal(bitmapClosed, true);
  } finally {
    if (previousBitmap) {
      Object.defineProperty(globalThis, "createImageBitmap", previousBitmap);
    } else {
      delete globalThis.createImageBitmap;
    }
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      delete globalThis.document;
    }
  }
});

test("decodes once and emits ordered 720p and 360p WebP variants", async () => {
  const previousBitmap = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  let decodeCount = 0;
  let closeCount = 0;
  const renderedVariants = [];
  const fakeBitmap = {
    width: 1920,
    height: 1080,
    close: () => {
      closeCount += 1;
    },
  };

  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => {
      decodeCount += 1;
      return fakeBitmap;
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            imageSmoothingEnabled: false,
            imageSmoothingQuality: "low",
            drawImage() {},
            save() {},
            restore() {},
            fillRect() {},
            globalCompositeOperation: "source-over",
            fillStyle: "#000000",
          }),
          toBlob: (callback, mimeType, quality) => {
            renderedVariants.push({
              width: canvas.width,
              height: canvas.height,
              mimeType,
              quality,
            });
            callback(new Blob([new Uint8Array([1])], { type: mimeType }));
          },
        };
        return canvas;
      },
    },
  });

  try {
    const sourceFile = new File([new Uint8Array([1])], "auction.png", {
      type: "image/png",
      lastModified: 5678,
    });
    const variants = await compressProductImageVariantsForUpload(sourceFile);

    assert.equal(decodeCount, 1);
    assert.equal(closeCount, 1);
    assert.deepEqual(renderedVariants, [
      {
        width: 1280,
        height: 720,
        mimeType: "image/webp",
        quality: 0.82,
      },
      {
        width: 640,
        height: 360,
        mimeType: "image/webp",
        quality: 0.76,
      },
    ]);
    assert.equal(variants.imageFile.name, "auction.webp");
    assert.equal(variants.imageFile.type, "image/webp");
    assert.equal(variants.thumbnailFile.name, "auction-thumbnail.webp");
    assert.equal(variants.thumbnailFile.type, "image/webp");
  } finally {
    if (previousBitmap) {
      Object.defineProperty(globalThis, "createImageBitmap", previousBitmap);
    } else {
      delete globalThis.createImageBitmap;
    }
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      delete globalThis.document;
    }
  }
});

test("uploads and cleans up both Storage image variants", async () => {
  const source = await readFile(
    new URL("src/lib/supabase/products.ts", rootUrl),
    "utf8",
  );
  const migration = await readFile(
    new URL(
      "supabase/migrations/20260718062000_add_product_thumbnail_variants.sql",
      rootUrl,
    ),
    "utf8",
  );
  const gallery = await readFile(
    new URL("src/components/feed/PhotoGallery.tsx", rootUrl),
    "utf8",
  );
  const galleryModal = await readFile(
    new URL("src/components/feed/PhotoGalleryModal.tsx", rootUrl),
    "utf8",
  );

  assert.match(source, /compressProductImageVariantsForUpload\(file\)/);
  assert.match(source, /\.upload\(imagePath, imageFile,/);
  assert.match(source, /\.upload\(thumbnailPath, thumbnailFile,/);
  assert.match(source, /thumbnail_urls: thumbnailUrls/);
  assert.match(migration, /add column if not exists thumbnail_urls text\[\]/);
  assert.match(
    migration,
    /v_product\.image_urls \|\| v_product\.thumbnail_urls/,
  );
  assert.match(
    gallery,
    /getCatalogThumbnailUrl\([\s\S]*thumbnailImages\?\.\[index\],[\s\S]*image/,
  );
  assert.doesNotMatch(gallery, /thumbnailImages\?\.\[index\] \|\| image/);
  assert.match(gallery, /images=\{cleanImages\}/);
  assert.match(gallery, /thumbnailImages=\{cleanThumbnails\}/);
  assert.match(galleryModal, /src=\{thumbnailImages\?\.\[index\] \|\| image\}/);
  assert.match(galleryModal, /loading="lazy"[\s\S]*?decoding="async"/);
});
