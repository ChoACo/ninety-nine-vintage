import { createClient } from "@supabase/supabase-js";
import { existsSync, promises as fs } from "node:fs";
import { resolve } from "node:path";

if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

const EXECUTE = process.argv.includes("--execute");
const OVERWRITE_BACKUP = process.argv.includes("--overwrite-backup");
const BACKUP_PATH = resolve("migration-r2-reference-repair.json");
const PAGE_SIZE = 1_000;
const TABLES = ["support_conversations", "support_messages"];

function required(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`missing_environment:${names.join("|")}`);
}

function publicBaseUrl() {
  const url = new URL(required("NEXT_PUBLIC_R2_PUBLIC_URL"));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("invalid_environment:NEXT_PUBLIC_R2_PUBLIC_URL");
  }
  return url.toString().replace(/\/$/u, "");
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function sourceKey(value, supabaseOrigin) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    const prefix = "/storage/v1/object/public/product-images/";
    if (url.origin !== supabaseOrigin || !url.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

async function readRows(supabase, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("id,product_image_url_snapshot")
      .not("product_image_url_snapshot", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`reference_read_failed:${table}:${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

async function inspectReference(table, row, supabaseOrigin, r2BaseUrl) {
  const key = sourceKey(row.product_image_url_snapshot, supabaseOrigin);
  if (!key) return null;
  const target = `${r2BaseUrl}/${encodeKey(key)}`;
  const head = await fetch(target, { method: "HEAD", cache: "no-store" }).catch(() => null);
  return {
    table,
    id: row.id,
    before: row.product_image_url_snapshot,
    after: head?.status === 200 ? target : null,
    key,
    r2HeadStatus: head?.status ?? 0,
  };
}

async function main() {
  const supabaseUrl = required("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/u, "");
  const supabaseSecret = required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const rowsByTable = await Promise.all(TABLES.map((table) => readRows(supabase, table)));
  const candidates = rowsByTable.flatMap((rows, index) =>
    rows.map((row) => ({ table: TABLES[index], row })),
  );
  const repairs = (await Promise.all(candidates.map(({ table, row }) =>
    inspectReference(table, row, new URL(supabaseUrl).origin, publicBaseUrl()),
  ))).filter(Boolean);

  console.log(JSON.stringify({
    mode: EXECUTE ? "execute" : "dry-run",
    referencesToRepair: repairs.length,
    verifiedR2Replacements: repairs.filter((item) => item.after).length,
    irrecoverableBrokenSnapshotsToClear: repairs.filter((item) => !item.after).length,
  }, null, 2));
  if (!EXECUTE || repairs.length === 0) return;
  if (existsSync(BACKUP_PATH) && !OVERWRITE_BACKUP) {
    throw new Error("backup_exists:migration-r2-reference-repair.json");
  }
  await fs.writeFile(BACKUP_PATH, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    sourceSupabaseOrigin: new URL(supabaseUrl).origin,
    targetR2PublicUrl: publicBaseUrl(),
    repairs,
  }, null, 2)}\n`, { encoding: "utf8", flag: OVERWRITE_BACKUP ? "w" : "wx" });

  for (const repair of repairs) {
    const { data, error } = await supabase
      .from(repair.table)
      .update({ product_image_url_snapshot: repair.after })
      .eq("id", repair.id)
      .eq("product_image_url_snapshot", repair.before)
      .select("id,product_image_url_snapshot")
      .maybeSingle();
    if (error || !data || data.product_image_url_snapshot !== repair.after) {
      throw new Error(`reference_cas_update_failed:${repair.table}:${repair.id}:${error?.message ?? "stale"}`);
    }
  }
  console.log(JSON.stringify({
    status: "complete",
    backup: BACKUP_PATH,
    repaired: repairs.filter((item) => item.after).length,
    clearedBrokenSnapshots: repairs.filter((item) => !item.after).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
