import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, promises as fs } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

const CUTOFF = "2026-08-24T15:00:00.000Z";
const BACKUP_ROOT = resolve(".codex-backups", "pre-2026-08-25-closed-r2");
const MANIFEST_PATH = resolve(".codex-backups", "pre-2026-08-25-closed-r2-manifest.json");
const DELETE = process.argv.includes("--delete-from-manifest");
const VERIFY_LIVE = process.argv.includes("--verify-live");
const CONCURRENCY = 5;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
}

function r2Client() {
  const accountId = required("R2_ACCOUNT_ID");
  if (!/^[0-9a-f]{32}$/iu.test(accountId)) throw new Error("invalid_environment:R2_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });
}

function objectKey(urlValue, publicBase) {
  const url = new URL(urlValue);
  const base = new URL(publicBase);
  if (url.origin !== base.origin) return null;
  const prefix = base.pathname.replace(/\/$/u, "");
  if (!url.pathname.startsWith(`${prefix}/`)) return null;
  const encoded = url.pathname.slice(prefix.length + 1);
  const key = encoded.split("/").map(decodeURIComponent).join("/");
  if (!key || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`unsafe_object_key:${encoded}`);
  }
  return key;
}

function backupPath(key) {
  const candidate = resolve(BACKUP_ROOT, ...key.split("/"));
  if (relative(BACKUP_ROOT, candidate).startsWith(`..${sep}`) || candidate === BACKUP_ROOT) {
    throw new Error(`unsafe_backup_path:${key}`);
  }
  return candidate;
}

async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

function isNotFound(error) {
  return error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
}

async function listProducts() {
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SECRET_KEY?.trim()
    || required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("products")
    .select("id,status,created_at,image_urls,thumbnail_urls")
    .range(0, 999);
  if (error) throw new Error(`products_query_failed:${error.message}`);
  return data ?? [];
}

function urlsFor(products) {
  return new Set(products.flatMap((product) => [
    ...(Array.isArray(product.image_urls) ? product.image_urls : []),
    ...(Array.isArray(product.thumbnail_urls) ? product.thumbnail_urls : []),
  ]).filter((url) => typeof url === "string" && url.trim()));
}

async function prepare() {
  const products = await listProducts();
  const targets = products.filter((product) => product.status === "closed" && product.created_at < CUTOFF);
  if (targets.length !== 25) throw new Error(`target_product_count_changed:${targets.length}`);
  const protectedProducts = products.filter((product) => !(product.status === "closed" && product.created_at < CUTOFF));
  const targetUrls = urlsFor(targets);
  const protectedUrls = urlsFor(protectedProducts);
  const publicBase = required("NEXT_PUBLIC_R2_PUBLIC_URL").replace(/\/$/u, "");
  const keys = [...targetUrls]
    .filter((url) => !protectedUrls.has(url))
    .map((url) => objectKey(url, publicBase))
    .filter(Boolean)
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort();

  const client = r2Client();
  const bucket = required("R2_BUCKET_NAME");
  await fs.mkdir(BACKUP_ROOT, { recursive: true });
  const objects = await mapLimit(keys, CONCURRENCY, async (key) => {
    let head;
    try {
      head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (isNotFound(error)) return { key, status: "missing" };
      throw error;
    }
    const destination = backupPath(key);
    await fs.mkdir(dirname(destination), { recursive: true });
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error(`empty_object_body:${key}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(response.Body, verifier, createWriteStream(destination, { flags: "wx" }));
    if (bytes !== Number(head.ContentLength ?? -1)) throw new Error(`backup_size_mismatch:${key}`);
    return {
      key,
      status: "backed_up",
      bytes,
      sha256: hash.digest("hex"),
      contentType: head.ContentType ?? null,
      etag: head.ETag ?? null,
      localPath: relative(resolve(".codex-backups"), destination).split(sep).join("/"),
    };
  });

  const manifest = {
    version: 1,
    cutoff: CUTOFF,
    createdAt: new Date().toISOString(),
    targetProductCount: targets.length,
    protectedProductCount: protectedProducts.length,
    targetUniqueUrlCount: targetUrls.size,
    sharedUrlCount: [...targetUrls].filter((url) => protectedUrls.has(url)).length,
    deletionCandidateCount: keys.length,
    bucket,
    objects,
  };
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    mode: "prepared",
    manifest: MANIFEST_PATH,
    targetProductCount: manifest.targetProductCount,
    targetUniqueUrlCount: manifest.targetUniqueUrlCount,
    sharedUrlCount: manifest.sharedUrlCount,
    deletionCandidateCount: manifest.deletionCandidateCount,
    backedUp: objects.filter((object) => object.status === "backed_up").length,
    missing: objects.filter((object) => object.status === "missing").length,
    backedUpBytes: objects.reduce((sum, object) => sum + (object.bytes ?? 0), 0),
  }));
}

async function deleteFromManifest() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  if (manifest.cutoff !== CUTOFF || manifest.targetProductCount !== 25) {
    throw new Error("manifest_guard_failed");
  }
  const client = r2Client();
  const bucket = required("R2_BUCKET_NAME");
  if (manifest.bucket !== bucket) throw new Error("manifest_bucket_mismatch");
  const candidates = manifest.objects.filter((object) => object.status === "backed_up");
  const results = await mapLimit(candidates, CONCURRENCY, async (object) => {
    const local = resolve(".codex-backups", ...object.localPath.split("/"));
    const data = await fs.readFile(local);
    if (data.length !== object.bytes || createHash("sha256").update(data).digest("hex") !== object.sha256) {
      throw new Error(`local_backup_verification_failed:${object.key}`);
    }
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.key }));
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
      throw new Error(`r2_delete_verification_failed:${object.key}`);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    return { key: object.key, deleted: true, bytes: object.bytes };
  });
  console.log(JSON.stringify({
    mode: "deleted",
    deleted: results.length,
    deletedBytes: results.reduce((sum, object) => sum + object.bytes, 0),
    retainedShared: manifest.sharedUrlCount,
    alreadyMissing: manifest.objects.filter((object) => object.status === "missing").length,
  }));
}

async function verifyLive() {
  const products = await listProducts();
  const oldClosed = products.filter((product) => product.status === "closed" && product.created_at < CUTOFF);
  const oldPending = products.filter((product) => product.status === "pending" && product.created_at < CUTOFF);
  const newer = products.filter((product) => product.created_at >= CUTOFF);
  const urls = [...urlsFor(products)].sort();
  const checks = await mapLimit(urls, 10, async (url) => {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    return { url, status: response.status, ok: response.ok };
  });
  const failures = checks.filter((check) => !check.ok);
  if (oldClosed.length !== 0 || oldPending.length !== 3 || newer.length !== 124 || failures.length !== 0) {
    throw new Error(`live_verification_failed:${JSON.stringify({ oldClosed: oldClosed.length, oldPending: oldPending.length, newer: newer.length, failures: failures.slice(0, 10) })}`);
  }
  console.log(JSON.stringify({
    mode: "verified_live",
    products: products.length,
    oldClosed: oldClosed.length,
    oldPending: oldPending.length,
    newer: newer.length,
    uniqueImageUrls: urls.length,
    imageFailures: failures.length,
  }));
}

await (VERIFY_LIVE ? verifyLive() : DELETE ? deleteFromManifest() : prepare());
