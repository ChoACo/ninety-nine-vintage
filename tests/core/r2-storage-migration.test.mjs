import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_DIMENSION,
  compressAvatarImage,
} from "../../src/lib/images/avatarCompressor.ts";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("R2 presigning is server-only, store-scoped, content-type-bound, and short-lived", async () => {
  const [environment, client, route, nextConfig, cors, imageLimitMigration] = await Promise.all([
    source(".env.example"),
    source("src/lib/storage/r2Client.ts"),
    source("src/app/api/storage/r2-presigned-url/route.ts"),
    source("next.config.ts"),
    source("scripts/configure-r2-cors.mjs"),
    source("supabase/migrations/20260826150000_allow_fifteen_product_images.sql"),
  ]);
  for (const name of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "NEXT_PUBLIC_R2_PUBLIC_URL",
  ]) {
    assert.match(environment, new RegExp(`^${name}=`, "m"));
  }
  assert.match(client, /import "server-only"/);
  assert.match(client, /region: "auto"/);
  assert.match(client, /\^\[0-9a-f\]\{32\}\$/);
  assert.match(client, /https:\/\/\$\{accountId\}\.r2\.cloudflarestorage\.com/);
  assert.match(route, /authenticateOperatorStoreRequest\(request, true\)/);
  assert.match(route, /p_permission: "manage_products"/);
  assert.match(route, /PRESIGNED_URL_TTL_SECONDS = 5 \* 60/);
  assert.match(route, /ContentType: contentType/);
  assert.match(route, /r2_cleanup_persisted_product_forbidden/);
  assert.match(route, /auth\.admin[\s\S]*?\.from\("products"\)/);
  assert.match(route, /\.from\("support_conversations"\)/);
  assert.match(route, /\.from\("support_messages"\)/);
  assert.match(route, /retainedReferences/);
  assert.match(nextConfig, /NEXT_PUBLIC_R2_PUBLIC_URL/);
  assert.match(cors, /AllowedMethods: \["PUT", "HEAD"\]/);
  assert.match(cors, /AllowedHeaders: \["Content-Type", "Cache-Control"\]/);
  assert.match(imageLimitMigration, /cardinality\(image_urls\) between 1 and 15/);
});

test("lossless migration copies both source buckets before verified CAS URL replacement", async () => {
  const [migration, gitignore, vercelignore] = await Promise.all([
    source("scripts/migrate-storage-to-r2.mjs"),
    source(".gitignore"),
    source(".vercelignore"),
  ]);
  assert.match(migration, /SOURCE_BUCKETS = \["product-images", "store-mall-images"\]/);
  assert.match(migration, /DRY_RUN = process\.argv\.includes\("--dry-run"\)/);
  assert.match(migration, /migration-r2-backup\.json/);
  assert.match(migration, /createHash\("sha256"\)/);
  assert.match(migration, /new PutObjectCommand/);
  assert.match(migration, /new HeadObjectCommand/);
  assert.match(migration, /hashR2Object/);
  assert.match(migration, /invalid_environment:R2_ACCOUNT_ID/);
  assert.match(migration, /invalid_environment:R2_BUCKET_NAME/);
  assert.match(migration, /response\.status === 200/);
  assert.match(migration, /sourceObjectsWillRemain: true/);
  assert.match(migration, /await writeBackup\([\s\S]*?await applyDatabasePlan/);
  assert.match(migration, /\.eq\("updated_at", change\.expectedUpdatedAt\)/);
  assert.match(migration, /product_post_update_verification_failed/);
  assert.match(migration, /store_post_update_verification_failed/);
  assert.match(migration, /\.eq\("updated_at", item\.appliedUpdatedAt\)/);
  assert.doesNotMatch(migration, /DeleteObjectCommand|\.storage\.from\([^)]*\)\.remove/);
  assert.match(gitignore, /migration-r2-backup\.json/);
  assert.match(vercelignore, /migration-r2-backup\.json/);
});

test("R2 reference repair verifies snapshots and preserves an audit backup", async () => {
  const [repair, migration, gitignore] = await Promise.all([
    source("scripts/repair-r2-url-references.mjs"),
    source("supabase/migrations/20260826192000_repair_r2_support_image_references.sql"),
    source(".gitignore"),
  ]);
  assert.match(repair, /support_conversations/);
  assert.match(repair, /support_messages/);
  assert.match(repair, /method: "HEAD"/);
  assert.match(repair, /migration-r2-reference-repair\.json/);
  assert.match(migration, /update public\.support_messages/i);
  assert.match(migration, /cdn\.ninety-nine-vintage\.store/i);
  assert.match(migration, /set product_image_url_snapshot = null/i);
  assert.match(gitignore, /migration-r2-reference-repair\.json/);
});

test("source cleanup deletes only backup-listed objects after exact R2 and Supabase verification", async () => {
  const [cleanup, gitignore] = await Promise.all([
    source("scripts/delete-migrated-supabase-storage.mjs"),
    source(".gitignore"),
  ]);
  assert.match(cleanup, /EXECUTE = process\.argv\.includes\("--execute"\)/);
  assert.match(cleanup, /backup\.verifiedObjects/);
  assert.match(cleanup, /assertExact\("r2"/);
  assert.match(cleanup, /assertExact\(`supabase_\$\{bucket\}`/);
  assert.match(cleanup, /\.storage\.from\(bucket\)\.remove\(batch\)/);
  assert.match(cleanup, /DELETE_BATCH_SIZE = 250/);
  assert.match(cleanup, /remaining\.length !== 0/);
  assert.doesNotMatch(cleanup, /storage\.objects|emptyBucket|deleteBucket/);
  assert.match(gitignore, /migration-r2-source-deletion\.json/);
});

test("avatar compression enforces 256px and 100KB for regular and extreme aspect ratios", async () => {
  assert.equal(AVATAR_MAX_DIMENSION, 256);
  assert.equal(AVATAR_MAX_BYTES, 102_400);
  const originalBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  let dimensions = { height: 500, width: 1_000 };
  let closed = false;
  const canvas = {
    height: 0,
    width: 0,
    getContext() {
      return {
        clearRect() {},
        drawImage() {},
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
      };
    },
    toBlob(callback, type) {
      callback(new Blob([new Uint8Array(90_000)], { type }));
    },
  };
  globalThis.createImageBitmap = async () => ({
    close() {
      closed = true;
    },
    ...dimensions,
  });
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return canvas;
    },
  };
  try {
    const result = await compressAvatarImage(
      new File([new Uint8Array(200_000)], "profile.png", { type: "image/png" }),
    );
    assert.equal(canvas.width, 256);
    assert.equal(canvas.height, 128);
    assert.equal(result.type, "image/webp");
    assert.ok(result.size <= AVATAR_MAX_BYTES);
    assert.equal(closed, true);

    dimensions = { height: 1, width: 1_000 };
    const panoramic = await compressAvatarImage(
      new File([new Uint8Array(200_000)], "panorama.png", { type: "image/png" }),
    );
    assert.equal(canvas.width, 256);
    assert.equal(canvas.height, 1);
    assert.ok(panoramic.size <= AVATAR_MAX_BYTES);
  } finally {
    if (originalBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originalBitmap;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
