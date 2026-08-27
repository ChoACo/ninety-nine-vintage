import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  promises as fs,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

const DRY_RUN = process.argv.includes("--dry-run");
const OVERWRITE_BACKUP = process.argv.includes("--overwrite-backup");
const BACKUP_PATH = resolve("migration-r2-backup.json");
const SOURCE_BUCKETS = ["product-images", "store-mall-images"];
const PAGE_SIZE = 1_000;
const COPY_CONCURRENCY = 4;

function required(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`missing_environment:${names.join("|")}`);
}

function r2AccountId() {
  const value = required("R2_ACCOUNT_ID");
  if (!/^[0-9a-f]{32}$/iu.test(value)) {
    throw new Error("invalid_environment:R2_ACCOUNT_ID");
  }
  return value;
}

function r2BucketName() {
  const value = required("R2_BUCKET_NAME");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(value)) {
    throw new Error("invalid_environment:R2_BUCKET_NAME");
  }
  return value;
}

function publicBaseUrl() {
  const url = new URL(required("NEXT_PUBLIC_R2_PUBLIC_URL"));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("invalid_environment:NEXT_PUBLIC_R2_PUBLIC_URL");
  }
  return url.toString().replace(/\/$/u, "");
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function publicObjectUrl(key) {
  return `${publicBaseUrl()}/${encodeKey(key)}`;
}

function storageObjectUrl(supabaseUrl, bucket, key) {
  return `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeKey(key)}`;
}

function normalContentType(value) {
  return String(value ?? "application/octet-stream")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function isNotFound(error) {
  return error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound";
}

async function listBucketObjects(supabase, bucket) {
  const objects = [];
  const prefixes = [""];
  while (prefixes.length > 0) {
    const prefix = prefixes.shift();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`storage_list_failed:${bucket}:${prefix}:${error.message}`);
      for (const item of data ?? []) {
        const key = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) {
          objects.push({ bucket, key, listedSize: Number(item.metadata?.size ?? -1) });
        } else {
          prefixes.push(key);
        }
      }
      if ((data?.length ?? 0) < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  return objects;
}

async function downloadSource({ bucket, key }, targetPath, supabaseUrl, secret) {
  const response = await fetch(storageObjectUrl(supabaseUrl, bucket, key), {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    throw new Error(`source_download_failed:${bucket}:${key}:${response.status}`);
  }
  const hash = createHash("sha256");
  const hashingStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    hashingStream,
    createWriteStream(targetPath, { flags: "wx" }),
  );
  const stat = await fs.stat(targetPath);
  return {
    bytes: stat.size,
    cacheControl: response.headers.get("cache-control") ?? undefined,
    contentDisposition: response.headers.get("content-disposition") ?? undefined,
    contentType: normalContentType(response.headers.get("content-type")),
    sha256: hash.digest("hex"),
  };
}

async function hashR2Object(s3, bucketName, key) {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  if (!response.Body) throw new Error(`r2_get_empty:${key}`);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.Body) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    hash.update(buffer);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function verifyPublicHead(key, expectedBytes, expectedContentType) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(publicObjectUrl(key), {
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
    });
    lastStatus = response.status;
    const length = Number(response.headers.get("content-length"));
    const type = normalContentType(response.headers.get("content-type"));
    if (response.status === 200 && length === expectedBytes && type === expectedContentType) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * (attempt + 1)));
  }
  throw new Error(`public_head_verification_failed:${key}:${lastStatus}`);
}

async function copyAndVerifyObject(object, context) {
  const tempPath = join(context.tempDirectory, randomUUID());
  try {
    const source = await downloadSource(
      object,
      tempPath,
      context.supabaseUrl,
      context.supabaseSecret,
    );
    if (object.listedSize >= 0 && object.listedSize !== source.bytes) {
      throw new Error(`source_size_changed:${object.bucket}:${object.key}`);
    }

    let existingHead = null;
    try {
      existingHead = await context.s3.send(
        new HeadObjectCommand({ Bucket: context.bucketName, Key: object.key }),
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (existingHead) {
      const existing = await hashR2Object(context.s3, context.bucketName, object.key);
      if (
        existing.bytes !== source.bytes ||
        existing.sha256 !== source.sha256 ||
        normalContentType(existingHead.ContentType) !== source.contentType
      ) {
        throw new Error(`r2_key_collision:${object.bucket}:${object.key}`);
      }
    } else {
      await context.s3.send(
        new PutObjectCommand({
          Bucket: context.bucketName,
          Key: object.key,
          Body: createReadStream(tempPath),
          ContentLength: source.bytes,
          ContentType: source.contentType,
          CacheControl: source.cacheControl,
          ContentDisposition: source.contentDisposition,
          Metadata: {
            "source-bucket": object.bucket,
            "source-sha256": source.sha256,
          },
        }),
      );
    }

    const head = await context.s3.send(
      new HeadObjectCommand({ Bucket: context.bucketName, Key: object.key }),
    );
    const r2 = await hashR2Object(context.s3, context.bucketName, object.key);
    if (
      Number(head.ContentLength) !== source.bytes ||
      normalContentType(head.ContentType) !== source.contentType ||
      r2.bytes !== source.bytes ||
      r2.sha256 !== source.sha256
    ) {
      throw new Error(`r2_byte_verification_failed:${object.bucket}:${object.key}`);
    }
    await verifyPublicHead(object.key, source.bytes, source.contentType);
    return { ...object, ...source, publicUrl: publicObjectUrl(object.key) };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function mapConcurrent(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(values.length, Math.max(1, concurrency)) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await worker(values[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function readAllRows(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await queryFactory(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

function sourceKeyFromUrl(value, supabaseOrigin, bucket) {
  if (typeof value !== "string" || !value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== supabaseOrigin) return null;
  const prefix = `/storage/v1/object/public/${bucket}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

function replaceUrl(value, supabaseOrigin, bucket, verifiedKeys) {
  const key = sourceKeyFromUrl(value, supabaseOrigin, bucket);
  if (!key) return { changed: false, value };
  if (verifiedKeys && !verifiedKeys.has(key)) {
    throw new Error(`database_reference_not_verified:${bucket}:${key}`);
  }
  return { changed: true, value: publicObjectUrl(key) };
}

function replaceUrlArray(values, supabaseOrigin, bucket, verifiedKeys) {
  let changed = false;
  const next = (values ?? []).map((value) => {
    const result = replaceUrl(value, supabaseOrigin, bucket, verifiedKeys);
    changed ||= result.changed;
    return result.value;
  });
  return { changed, value: next };
}

async function buildDatabasePlan(supabase, supabaseOrigin, verifiedByBucket) {
  const products = await readAllRows((from, to) =>
    supabase
      .from("products")
      .select("id,image_urls,thumbnail_urls,updated_at")
      .order("id")
      .range(from, to),
  );
  const stores = await readAllRows((from, to) =>
    supabase
      .from("stores")
      .select("id,mall_image,logo_url,banner_url,updated_at")
      .order("id")
      .range(from, to),
  );

  const productChanges = products.flatMap((row) => {
    const imageUrls = replaceUrlArray(
      row.image_urls,
      supabaseOrigin,
      "product-images",
      verifiedByBucket?.get("product-images"),
    );
    const thumbnailUrls = replaceUrlArray(
      row.thumbnail_urls,
      supabaseOrigin,
      "product-images",
      verifiedByBucket?.get("product-images"),
    );
    if (!imageUrls.changed && !thumbnailUrls.changed) return [];
    return [{
      id: row.id,
      expectedUpdatedAt: row.updated_at,
      before: { image_urls: row.image_urls, thumbnail_urls: row.thumbnail_urls },
      after: { image_urls: imageUrls.value, thumbnail_urls: thumbnailUrls.value },
    }];
  });
  const storeChanges = stores.flatMap((row) => {
    const after = {};
    let changed = false;
    for (const field of ["mall_image", "logo_url", "banner_url"]) {
      const result = replaceUrl(
        row[field],
        supabaseOrigin,
        "store-mall-images",
        verifiedByBucket?.get("store-mall-images"),
      );
      after[field] = result.value;
      changed ||= result.changed;
    }
    if (!changed) return [];
    return [{
      id: row.id,
      expectedUpdatedAt: row.updated_at,
      before: {
        mall_image: row.mall_image,
        logo_url: row.logo_url,
        banner_url: row.banner_url,
      },
      after,
    }];
  });
  return { productChanges, storeChanges };
}

function countChangedUrls(plan) {
  let count = 0;
  for (const change of plan.productChanges) {
    count += change.before.image_urls.filter(
      (value, index) => value !== change.after.image_urls[index],
    ).length;
    count += change.before.thumbnail_urls.filter(
      (value, index) => value !== change.after.thumbnail_urls[index],
    ).length;
  }
  for (const change of plan.storeChanges) {
    for (const field of ["mall_image", "logo_url", "banner_url"]) {
      if (change.before[field] !== change.after[field]) count += 1;
    }
  }
  return count;
}

async function writeBackup(payload) {
  if (existsSync(BACKUP_PATH) && !OVERWRITE_BACKUP) {
    throw new Error(`backup_exists:${basename(BACKUP_PATH)} (rename it or pass --overwrite-backup)`);
  }
  await fs.writeFile(BACKUP_PATH, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    flag: OVERWRITE_BACKUP ? "w" : "wx",
  });
}

async function applyDatabasePlan(supabase, plan) {
  const applied = [];
  try {
    for (const change of plan.productChanges) {
      const { data, error } = await supabase
        .from("products")
        .update(change.after)
        .eq("id", change.id)
        .eq("updated_at", change.expectedUpdatedAt)
        .select("id,updated_at,image_urls,thumbnail_urls")
        .maybeSingle();
      if (error || !data) throw new Error(`product_cas_update_failed:${change.id}:${error?.message ?? "stale"}`);
      applied.push({
        table: "products",
        change,
        appliedUpdatedAt: data.updated_at,
      });
      if (
        JSON.stringify(data.image_urls) !== JSON.stringify(change.after.image_urls) ||
        JSON.stringify(data.thumbnail_urls) !== JSON.stringify(change.after.thumbnail_urls)
      ) {
        throw new Error(`product_post_update_verification_failed:${change.id}`);
      }
    }
    for (const change of plan.storeChanges) {
      const { data, error } = await supabase
        .from("stores")
        .update(change.after)
        .eq("id", change.id)
        .eq("updated_at", change.expectedUpdatedAt)
        .select("id,updated_at,mall_image,logo_url,banner_url")
        .maybeSingle();
      if (error || !data) throw new Error(`store_cas_update_failed:${change.id}:${error?.message ?? "stale"}`);
      applied.push({
        table: "stores",
        change,
        appliedUpdatedAt: data.updated_at,
      });
      if (["mall_image", "logo_url", "banner_url"].some(
        (field) => data[field] !== change.after[field],
      )) {
        throw new Error(`store_post_update_verification_failed:${change.id}`);
      }
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const item of [...applied].reverse()) {
      const { data: rolledBack, error: rollbackError } = await supabase
        .from(item.table)
        .update(item.change.before)
        .eq("id", item.change.id)
        .eq("updated_at", item.appliedUpdatedAt)
        .select("id")
        .maybeSingle();
      if (rollbackError || !rolledBack) {
        rollbackFailures.push(
          `${item.table}:${item.change.id}:${rollbackError?.message ?? "stale"}`,
        );
      }
    }
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures.map((message) => new Error(message))],
        "database_update_failed_and_rollback_incomplete",
      );
    }
    throw error;
  }
}

async function main() {
  const supabaseUrl = required("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/u, "");
  const supabaseSecret = required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const inventories = await Promise.all(
    SOURCE_BUCKETS.map((bucket) => listBucketObjects(supabase, bucket)),
  );
  const objects = inventories.flat();
  const seenKeys = new Map();
  for (const object of objects) {
    const previous = seenKeys.get(object.key);
    if (previous && previous !== object.bucket) {
      throw new Error(`cross_bucket_key_collision:${previous}:${object.bucket}:${object.key}`);
    }
    seenKeys.set(object.key, object.bucket);
  }

  const dryRunPlan = await buildDatabasePlan(
    supabase,
    new URL(supabaseUrl).origin,
    null,
  );
  console.log(JSON.stringify({
    mode: DRY_RUN ? "dry-run" : "execute",
    objectsByBucket: Object.fromEntries(
      SOURCE_BUCKETS.map((bucket) => [bucket, objects.filter((item) => item.bucket === bucket).length]),
    ),
    productRowsToUpdate: dryRunPlan.productChanges.length,
    storeRowsToUpdate: dryRunPlan.storeChanges.length,
    urlsToReplace: countChangedUrls(dryRunPlan),
    sourceObjectsWillRemain: true,
  }, null, 2));
  if (DRY_RUN) return;

  const accountId = r2AccountId();
  const bucketName = r2BucketName();
  required("NEXT_PUBLIC_R2_PUBLIC_URL");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });
  const tempDirectory = await fs.mkdtemp(join(tmpdir(), "ninety-nine-r2-"));
  let verified;
  try {
    verified = await mapConcurrent(objects, COPY_CONCURRENCY, async (object, index) => {
      const result = await copyAndVerifyObject(object, {
        bucketName,
        s3,
        supabaseSecret,
        supabaseUrl,
        tempDirectory,
      });
      console.log(`[${index + 1}/${objects.length}] verified ${object.bucket}/${object.key}`);
      return result;
    });
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }

  const verifiedByBucket = new Map(
    SOURCE_BUCKETS.map((bucket) => [
      bucket,
      new Set(verified.filter((item) => item.bucket === bucket).map((item) => item.key)),
    ]),
  );
  const verifiedPlan = await buildDatabasePlan(
    supabase,
    new URL(supabaseUrl).origin,
    verifiedByBucket,
  );
  await writeBackup({
    createdAt: new Date().toISOString(),
    sourceSupabaseOrigin: new URL(supabaseUrl).origin,
    targetR2PublicUrl: publicBaseUrl(),
    sourceBuckets: SOURCE_BUCKETS,
    targetBucket: bucketName,
    sourceObjectsRetained: true,
    verifiedObjects: verified,
    products: verifiedPlan.productChanges,
    stores: verifiedPlan.storeChanges,
  });
  await applyDatabasePlan(supabase, verifiedPlan);
  console.log(JSON.stringify({
    status: "complete",
    backup: BACKUP_PATH,
    verifiedObjects: verified.length,
    updatedProductRows: verifiedPlan.productChanges.length,
    updatedStoreRows: verifiedPlan.storeChanges.length,
    updatedUrls: countChangedUrls(verifiedPlan),
    sourceObjectsDeleted: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
